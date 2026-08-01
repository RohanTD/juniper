"""FastAPI app factory — Twilio plumbing, Deepgram bridge, preferences API.

Surfaces:
- ``POST /twilio/voice`` — Twilio voice webhook returning TwiML
  ``<Connect><Stream>`` pointed at our ``/media`` WebSocket.
- ``WS /media`` — one persistent audio task per call bridging Twilio media
  frames <-> a Deepgram Voice Agent WebSocket session whose ``think`` stage
  calls back into this same service over HTTP (llm_endpoint.py).
- ``GET/PUT /patients/{patientId}/preferences`` — docs/CONTRACTS.md §1.
- ``POST /v1/chat/completions`` — mounted from llm_endpoint.py.
- ``GET /healthz``.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any, Mapping

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

from . import llm_endpoint
from .config import Settings
from .context_brain import ContextBrain
from .controller import ConversationController, Phase
from .documentation import run_post_call
from .escalation import EscalationSink
from .llm.provider import AnthropicProvider, LLMProvider
from .llm_endpoint import require_bearer
from .medplum import MedplumClient, compile_core_header, compile_patient_context
from .preferences import Preferences, PreferencesStore
from .session import CallRegistry
from .terminology import Terminology, get_terminology

logger = logging.getLogger("juniper.app")

DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse"


# ---------------------------------------------------------------------------
# Twilio signature validation (hand-rolled HMAC-SHA1; avoids the twilio pkg)
# ---------------------------------------------------------------------------

def validate_twilio_signature(
    url: str, params: Mapping[str, str], signature: str, auth_token: str
) -> bool:
    payload = url + "".join(key + params[key] for key in sorted(params))
    digest = hmac.new(
        auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1
    ).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# Deepgram Voice Agent settings (docs/DEEPGRAM_INTEGRATION.md)
# ---------------------------------------------------------------------------

def build_deepgram_settings(settings: Settings, call_id: str) -> dict[str, Any]:
    headers = {}
    if settings.api_token:
        headers["authorization"] = f"Bearer {settings.api_token}"
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "mulaw", "sample_rate": 8000},
            "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"},
        },
        "agent": {
            "listen": {
                "provider": {"type": "deepgram", "model": settings.deepgram_listen_model}
            },
            "think": {
                # "open_ai" designates any OpenAI-compatible endpoint — our
                # FastAPI service is the gateway; the model name is cosmetic.
                "provider": {"type": "open_ai", "model": "juniper-companion", "temperature": 0.7},
                "endpoint": {
                    "url": f"https://{settings.public_host}/v1/chat/completions?call={call_id}",
                    "headers": headers,
                },
            },
            "speak": {
                "provider": {"type": "deepgram", "model": settings.deepgram_speak_model}
            },
        },
    }


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app(
    *,
    settings: Settings | None = None,
    provider: LLMProvider | None = None,
    medplum: Any | None = None,
    registry: CallRegistry | None = None,
    preferences: PreferencesStore | None = None,
    context_brain: ContextBrain | None = None,
    terminology: Terminology | None = None,
    escalation_notifier: Any | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    provider = provider or AnthropicProvider(api_key=settings.anthropic_api_key)
    if medplum is None and settings.medplum_base_url:
        medplum = MedplumClient(
            settings.medplum_base_url,
            settings.medplum_client_id or "",
            settings.medplum_client_secret or "",
        )
    preferences = preferences or PreferencesStore(settings.preferences_path)
    context_brain = context_brain or ContextBrain(
        settings.context_brain_path, preferences=preferences
    )
    terminology = terminology or get_terminology()
    registry = registry or CallRegistry()

    app = FastAPI(title="juniper-voice")
    app.state.settings = settings
    app.state.provider = provider
    app.state.medplum = medplum
    app.state.registry = registry
    app.state.preferences = preferences
    app.state.context_brain = context_brain
    app.state.terminology = terminology
    app.state.post_call_tasks = set()

    app.include_router(llm_endpoint.router)

    # -- health ------------------------------------------------------------
    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    # -- preferences API (docs/CONTRACTS.md §1) ------------------------------
    async def authorize_preferences(patient_id: str, request: Request) -> None:
        """Authorize a preferences call for ONE patient.

        Two callers, two mechanisms:

        - The **service token** (onboarding, internal tooling) is a shared
          secret with no patient scope. It is trusted for any patient.
        - A **Medplum user token** (the family app, signed in as a caregiver)
          is scoped by asking Medplum whether that user may read this Patient.
          The caregiver AccessPolicy already restricts that to the patient
          they are bound to, so entitlement stays derived from CareTeam
          membership rather than duplicated here — the same principle the
          access model rests on everywhere else.

        This distinction matters: without it, handing the service token to a
        caregiver-facing app would make it a master key, since the route is
        keyed only on a path parameter. Any caregiver could read or rewrite
        any patient's call windows and topics-to-avoid by editing the URL.
        """
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header[:7].lower() == "bearer " else ""
        if not token:
            raise HTTPException(status_code=401, detail="missing bearer token")
        if settings.api_token and hmac.compare_digest(token, settings.api_token):
            return  # trusted service credential
        if not settings.medplum_base_url:
            raise HTTPException(status_code=401, detail="invalid bearer token")
        # Delegate the entitlement question to Medplum, as that user.
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{settings.medplum_base_url.rstrip('/')}/fhir/R4/Patient/{patient_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError:
            raise HTTPException(status_code=503, detail="could not verify authorization")
        if response.status_code == 200:
            return
        if response.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="not authorized for this patient")
        raise HTTPException(status_code=403, detail="not authorized for this patient")

    @app.get("/patients/{patient_id}/preferences")
    async def get_preferences(patient_id: str, request: Request):
        await authorize_preferences(patient_id, request)
        return JSONResponse(preferences.get(patient_id).model_dump(exclude_none=True))

    @app.put("/patients/{patient_id}/preferences")
    async def put_preferences(patient_id: str, request: Request):
        await authorize_preferences(patient_id, request)
        body = await request.json()
        try:
            stored = preferences.put(patient_id, Preferences.model_validate(body))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        return JSONResponse(stored.model_dump(exclude_none=True))

    # -- moss purge (docs/MOSS_PLAN.md: consent revocation / offboarding) ----
    @app.post("/patients/{patient_id}/purge")
    async def purge_patient(patient_id: str, request: Request):
        """Delete this patient's durable Moss indexes. The operational hook for
        consent revocation and offboarding — durable PHI storage is only
        defensible with a working deletion path. Durable-by-intent: a failed
        deletion is recorded and retried before the patient's indexes are ever
        touched again, and the pending record itself blocks moss mode."""
        # Fail CLOSED: this deletes PHI indexes keyed only on a path
        # parameter. require_bearer is a no-op when no token is configured
        # (fine for a local dev preferences read; not for this).
        if not settings.api_token:
            raise HTTPException(
                status_code=503,
                detail="JUNIPER_API_TOKEN must be configured to use the purge endpoint",
            )
        require_bearer(request, settings.api_token)
        if settings.context_mode not in ("moss", "shadow") or not (
            settings.moss_project_id and settings.moss_project_key
        ):
            # No durable indexes can exist without moss mode ever having run;
            # still record the intent so a later moss enablement honours it.
            from .retrieval import RetrievalStateStore

            RetrievalStateStore(settings.retrieval_state_path).record_purge(
                patient_id, completed=False
            )
            return JSONResponse({"purged": False, "pending": True, "reason": "moss not active"})
        retrieval = _make_retrieval(call_id=f"purge-{patient_id}", patient_id=patient_id)
        if retrieval is None:
            raise HTTPException(status_code=503, detail="moss unavailable")
        purged = await retrieval.purge_patient()
        return JSONResponse({"purged": purged, "pending": not purged})

    # -- call preparation ----------------------------------------------------
    def _make_retrieval(call_id: str, patient_id: str):
        """Build the per-call MossRetrieval, or None when moss mode is off or
        unconfigured. Import is local so brief mode never touches the SDK."""
        if settings.context_mode not in ("moss", "shadow"):
            return None
        if not (settings.moss_project_id and settings.moss_project_key):
            logger.error(
                "JUNIPER_CONTEXT_MODE=%s but MOSS_PROJECT_ID/KEY unset; brief mode",
                settings.context_mode,
            )
            return None
        from .medplum import extract_chart_documents, fetch_chart_snapshot
        from .retrieval import MossRetrieval, RetrievalStateStore

        state = RetrievalStateStore(settings.retrieval_state_path)

        async def chart_supplier(since: str | None = None):
            # depth="index": the retrieval index has no token budget, so it
            # must NOT inherit the brief's recency caps — otherwise it carries
            # less history than the brief it replaces. `since` pushes the
            # delta server-side so the reconciliation read is near-empty on a
            # steady chart rather than a second full scan.
            snapshot = await fetch_chart_snapshot(
                medplum, patient_id, terminology, depth="index", since=since
            )
            return extract_chart_documents(snapshot), snapshot.read_started_at

        return MossRetrieval(
            project_id=settings.moss_project_id,
            project_key=settings.moss_project_key,
            patient_id=patient_id,
            call_id=call_id,
            chart_supplier=chart_supplier,
            memory_supplier=lambda: context_brain.memory_documents(patient_id),
            state=state,
            model_id=settings.moss_model,
            index_prefix=settings.moss_index_prefix,
            query_timeout=settings.moss_query_timeout,
            hydrate_timeout=settings.moss_hydrate_timeout,
            top_k_chart=settings.moss_top_k_chart,
            top_k_memories=settings.moss_top_k_memories,
            top_k_session=settings.moss_top_k_session,
            alpha=settings.moss_alpha,
            full_rebuild_every=settings.moss_full_rebuild_every,
        )

    async def prepare_call(call_id: str, patient_id: str) -> ConversationController:
        """Pre-call: consent gate (refuses to dial without ai-calling AND
        call-recording), then ONE chart read compiled into the brief (and, in
        moss mode, the core header + hydrated indexes) — all held for the
        whole conversation so no FHIR round trip ever lands on the per-turn
        latency path."""
        if medplum is None:
            raise RuntimeError("Medplum is not configured; cannot prepare a call")
        patient_context = await compile_patient_context(
            medplum,
            patient_id,
            terminology,
            token_budget=settings.ehr_brief_token_budget,
        )
        brief = patient_context.brief

        shadow = settings.context_mode == "shadow"
        retrieval = _make_retrieval(call_id, patient_id)
        core_header: str | None = None
        if retrieval is not None:
            if await retrieval.ensure_ready():
                core_header = compile_core_header(brief, patient_context.snapshot)
            else:
                # Hydration failed (or a purge is pending): the patient still
                # gets their call, with today's compiled-brief context.
                logger.warning("moss hydration unavailable for %s; brief mode", call_id)
                retrieval = None

        controller = ConversationController(
            call_id=call_id,
            patient_id=patient_id,
            provider=provider,
            roster=settings.roster,
            terminology=terminology,
            brief=brief,
            # The digest stays PINNED even in moss mode. Memories are not in
            # the core header, so dropping it meant a degraded turn lost the
            # relationship context entirely ("granddaughter Maya started
            # college") — not "a slightly thinner version of today", but a
            # total loss of the thing the product exists for. Retrieval adds
            # verbatim recall on top of it; it does not replace it.
            digest=context_brain.digest(patient_id),
            negative_constraints=context_brain.negative_constraints(patient_id),
            preferences=preferences,
            escalation=EscalationSink(notifier=escalation_notifier),
            retrieval=retrieval,
            core_header=core_header,
            shadow_retrieval=shadow,
        )
        registry.register(call_id, controller)
        return controller

    app.state.prepare_call = prepare_call

    async def finish_call(call_id: str) -> None:
        # Captured here, before any post-call LLM work runs, so the
        # Encounter/DocumentReference period reflects the actual hangup time
        # rather than whenever note generation happens to finish.
        call_end_iso = datetime.now(timezone.utc).isoformat()
        controller = registry.pop(call_id)
        if controller is None:
            return
        try:
            await run_post_call(
                controller=controller,
                provider=provider,
                roster=settings.roster,
                medplum=medplum,
                terminology=terminology,
                device_ref=settings.device_ref,
                organization_ref=settings.organization_ref,
                context_brain=context_brain,
                call_end_iso=call_end_iso,
            )
        except Exception:  # noqa: BLE001
            logger.exception("post-call pass failed for %s", call_id)
        finally:
            # The call session is DISCARDED, never pushed — the raw transcript
            # has exactly one durable home, and it is Medplum.
            if controller.retrieval is not None:
                try:
                    await controller.retrieval.close()
                except Exception:  # noqa: BLE001
                    logger.exception("retrieval close failed for %s", call_id)

    app.state.finish_call = finish_call

    def _spawn_post_call(call_id: str) -> None:
        task = asyncio.create_task(finish_call(call_id), name=f"post_call:{call_id}")
        app.state.post_call_tasks.add(task)
        task.add_done_callback(app.state.post_call_tasks.discard)

    # -- Twilio voice webhook ------------------------------------------------
    @app.post("/twilio/voice")
    async def twilio_voice(request: Request):
        form = await request.form()
        params = {key: str(value) for key, value in form.items()}
        if settings.twilio_auth_token:
            signature = request.headers.get("x-twilio-signature", "")
            if not validate_twilio_signature(
                str(request.url), params, signature, settings.twilio_auth_token
            ):
                raise HTTPException(status_code=403, detail="bad Twilio signature")
        call_sid = params.get("CallSid", "unknown-call")
        patient_id = request.query_params.get("patientId")
        if patient_id and registry.get(call_sid) is None:
            try:
                await prepare_call(call_sid, patient_id)
            except Exception:  # noqa: BLE001 - includes ConsentError
                logger.exception("pre-call preparation refused/failed for %s", call_sid)
                return Response(
                    content='<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
                    media_type="application/xml",
                )
        stream_url = f"wss://{settings.public_host}/media?call={call_sid}"
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<Response><Connect><Stream url="{stream_url}"/></Connect></Response>'
        )
        return Response(content=twiml, media_type="application/xml")

    # -- Twilio <-> Deepgram media bridge ------------------------------------
    @app.websocket("/media")
    async def media(websocket: WebSocket):
        await websocket.accept()
        try:
            import websockets as ws_client
        except ImportError:  # pragma: no cover
            await websocket.close(code=1011)
            return
        if not settings.deepgram_api_key:
            logger.error("DEEPGRAM_API_KEY not configured; closing media socket")
            await websocket.close(code=1011)
            return

        # Twilio's <Stream url="..."> does NOT forward query strings to the WS
        # upgrade request, so `?call=<sid>` never arrives here (verified
        # against a live call — every real connection saw a bare "/media").
        # The `start` event's payload carries the real CallSid directly, so
        # wait for it before opening Deepgram (its callback URL needs the
        # call id embedded from the first byte).
        call_id = "unknown-call"
        stream_sid: str | None = None
        try:
            async with asyncio.timeout(10):
                while stream_sid is None:
                    raw = await websocket.receive_text()
                    message = json.loads(raw)
                    if message.get("event") == "start":
                        stream_sid = message["start"]["streamSid"]
                        call_id = message["start"].get("callSid", call_id)
                    elif message.get("event") == "stop":
                        await websocket.close()
                        return
        except (TimeoutError, WebSocketDisconnect):
            logger.error("no Twilio 'start' event received; closing media socket")
            await websocket.close(code=1011)
            return

        try:
            async with ws_client.connect(
                DEEPGRAM_AGENT_URL,
                additional_headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            ) as deepgram:
                await deepgram.send(json.dumps(build_deepgram_settings(settings, call_id)))

                async def pump_twilio_to_deepgram() -> None:
                    nonlocal stream_sid
                    while True:
                        raw = await websocket.receive_text()
                        message = json.loads(raw)
                        event = message.get("event")
                        if event == "media":
                            audio = base64.b64decode(message["media"]["payload"])
                            await deepgram.send(audio)
                        elif event == "stop":
                            return

                async def pump_deepgram_to_twilio() -> None:
                    async for frame in deepgram:
                        if isinstance(frame, bytes):
                            if stream_sid is None:
                                continue
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "event": "media",
                                        "streamSid": stream_sid,
                                        "media": {
                                            "payload": base64.b64encode(frame).decode("ascii")
                                        },
                                    }
                                )
                            )
                            continue
                        try:
                            event = json.loads(frame)
                        except (TypeError, json.JSONDecodeError):
                            continue
                        event_type = event.get("type")
                        if event_type == "UserStartedSpeaking" and stream_sid is not None:
                            # Barge-in: flush Twilio's audio buffer immediately.
                            await websocket.send_text(
                                json.dumps({"event": "clear", "streamSid": stream_sid})
                            )
                        elif event_type == "Error":
                            logger.error("Deepgram agent error: %s", event)

                pumps = [
                    asyncio.create_task(pump_twilio_to_deepgram()),
                    asyncio.create_task(pump_deepgram_to_twilio()),
                ]
                try:
                    done, pending = await asyncio.wait(
                        pumps, return_when=asyncio.FIRST_COMPLETED
                    )
                    for task in pending:
                        task.cancel()
                    for task in done:
                        exc = task.exception()
                        if exc is not None and not isinstance(exc, WebSocketDisconnect):
                            raise exc
                finally:
                    for task in pumps:
                        if not task.done():
                            task.cancel()
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("media bridge failed for %s", call_id)
        finally:
            controller = registry.get(call_id)
            if controller is not None:
                controller.phase = Phase.DONE
            # The patient never waits on note generation: the post-call pass
            # runs asynchronously after hangup.
            _spawn_post_call(call_id)
            try:
                await websocket.close()
            except RuntimeError:
                pass

    return app
