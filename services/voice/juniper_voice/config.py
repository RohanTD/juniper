"""Service settings from the environment (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from dotenv import load_dotenv

from .llm.provider import ModelRoster


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _origins(raw: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    """Comma-separated origin list.  An explicitly empty value disables CORS
    entirely rather than silently falling back to the dev defaults — a
    deployment that means "no browsers" must be able to say so."""
    if raw is None:
        return default
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    # Auth for our own HTTP surface (Deepgram think endpoint + preferences API)
    api_token: str | None = None
    # Upstream credentials
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    deepgram_api_key: str | None = None
    twilio_auth_token: str | None = None
    # Needed to redirect a live call (leaving the pre-written voicemail via
    # the Calls API), so this is now read by the app, not just used to
    # configure the number's webhook by hand.
    twilio_account_sid: str | None = None
    # Public host (scheme-less), used to build TwiML/Deepgram callback URLs
    public_host: str = "localhost:8000"
    # Medplum
    medplum_base_url: str | None = None
    medplum_client_id: str | None = None
    medplum_client_secret: str | None = None
    # Stores
    preferences_path: str = "data/preferences.json"
    context_brain_path: str = "data/context_brain.json"
    # Family-side alert acknowledgements. NOT the escalation Task's status —
    # that belongs to the care team; see acknowledgements.py.
    alert_acknowledgements_path: str = "data/alert_acknowledgements.json"
    # FHIR attribution. Medplum assigns its own UUID on create — these must be
    # the actual Device/Organization ids from the target project (printed by
    # medplum/scripts/apply.sh), never the identifier slug. An unset value
    # defaults to an obviously-fake placeholder rather than a plausible-looking
    # one, so a misconfigured deployment fails loudly instead of silently
    # writing DocumentReference.author/.custodian at a resource that doesn't
    # exist in this project.
    device_ref: str = "Device/UNSET-run-medplum-scripts-apply.sh"
    organization_ref: str | None = "Organization/UNSET-run-medplum-scripts-apply.sh"
    # Budgets
    ehr_brief_token_budget: int = 2500
    # Turn-loop composition. Defaults preserve docs/PLAN.md's contracted
    # three-call turn; setting either to false collapses toward a single LLM
    # call per turn. See ControllerSettings for the measured tradeoff.
    urgency_filter_enabled: bool = True
    compassion_filter_enabled: bool = True
    # Context mode (docs/MOSS_PLAN.md):
    #   "brief"  = compiled EHR brief + digest (the tested fallback, default)
    #   "shadow" = retrieval runs, is measured and logged, and reaches NO
    #              prompt; prompts stay byte-identical to brief mode. This is
    #              what Phase A ("logging only") requires.
    #   "moss"   = retrieval injected, pinned core header replaces the bulk brief.
    context_mode: str = "brief"
    moss_project_id: str | None = None
    moss_project_key: str | None = None
    moss_model: str = "moss-mediumlm"
    moss_index_prefix: str = "juniper"
    moss_query_timeout: float = 0.15
    moss_hydrate_timeout: float = 2.0
    moss_top_k_chart: int = 4
    moss_top_k_memories: int = 3
    moss_top_k_session: int = 3
    moss_alpha: float = 0.7
    moss_full_rebuild_every: int = 20
    retrieval_state_path: str = "data/retrieval_state.json"
    # Models
    roster: ModelRoster = field(default_factory=ModelRoster)
    # Deepgram voice/listen models.
    #
    # listen: Flux is Deepgram's model built FOR voice agents — it is the only
    # one exposing end-of-turn tuning, and "let them finish; don't cut them
    # off" is not something a prompt can do (the Companion never sees pauses
    # at all: transcript.render() drops timing entirely). nova-3 has no such
    # control. Verified against the live socket: the Settings message accepts
    # version="v2" + flux-general-en + numeric EOT params.
    #
    # speak: pitch is a TTS property, not something a prompt can change, so
    # this is the only place "a natural adult pitch, moderate to low; never
    # raise pitch to sound bright" can actually be honoured.
    deepgram_listen_model: str = "flux-general-en"
    deepgram_speak_model: str = "aura-2-phoebe-en"
    # Higher than Deepgram's 0.7 default: require MORE confidence that the
    # speaker is done before ending the turn, so a slower speaker gathering
    # their thought is not cut off mid-sentence.
    deepgram_eot_threshold: float = 0.85
    # Longer than the 5000ms default, for the same reason.
    deepgram_eot_timeout_ms: int = 8000
    # Browser origins allowed to call the app-level store routes.
    #
    # The family app runs as a WEB dashboard, so its calls to this service are
    # cross-origin (Expo web on :8081 -> this service on :8000) and a browser
    # blocks them outright without CORS headers. The failure is silent from the
    # service's side — the request never arrives — and looks to the user like
    # "call settings won't load" with a healthy server sitting right there.
    #
    # An explicit list, never "*": these routes authenticate with a bearer
    # token rather than a cookie, so this is not a CSRF surface, but a
    # wildcard would still let any page a caregiver visits enumerate the API
    # using a token it managed to obtain. Defaults cover Expo's dev ports only;
    # a deployment sets JUNIPER_CORS_ORIGINS to its real origins.
    cors_origins: tuple[str, ...] = (
        "http://localhost:8081",
        "http://localhost:8082",
        "http://localhost:19006",
    )
    #: Origin *pattern*, for development only.
    #:
    #: A fixed port list does not survive contact with Expo. It picks a free
    #: port (8081, then 8082, then upward when one is taken), it serves the
    #: same app on ``localhost`` AND on the machine's LAN address so a phone
    #: can reach it, and either of those is a different Origin. The result was
    #: a browser that blocked the request before it left, surfacing in the app
    #: as "we could not reach the Juniper service" — indistinguishable from the
    #: service being down, and it sent debugging after the wrong thing twice.
    #:
    #: So development matches loopback and RFC1918 private ranges on any port.
    #: This is deliberately permissive and deliberately *dev-only*: the routes
    #: carry a bearer token rather than a cookie, so a matching origin still
    #: proves nothing and grants nothing, and the service binds to 127.0.0.1 by
    #: default. A deployment sets JUNIPER_CORS_ORIGINS to its real origins and
    #: JUNIPER_CORS_ORIGIN_REGEX="" to switch this off.
    cors_origin_regex: str | None = (
        r"http://(localhost|127\.0\.0\.1|\[::1\]"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?"
    )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        if env is None:
            load_dotenv()
            env = os.environ
        default = cls()
        return cls(
            api_token=env.get("JUNIPER_API_TOKEN"),
            anthropic_api_key=env.get("ANTHROPIC_API_KEY"),
            groq_api_key=env.get("GROQ_API_KEY"),
            deepgram_api_key=env.get("DEEPGRAM_API_KEY"),
            twilio_auth_token=env.get("TWILIO_AUTH_TOKEN"),
            twilio_account_sid=env.get("TWILIO_ACCOUNT_SID"),
            public_host=env.get("JUNIPER_PUBLIC_HOST", default.public_host),
            medplum_base_url=env.get("MEDPLUM_BASE_URL"),
            medplum_client_id=env.get("MEDPLUM_CLIENT_ID"),
            medplum_client_secret=env.get("MEDPLUM_CLIENT_SECRET"),
            preferences_path=env.get("JUNIPER_PREFERENCES_PATH", default.preferences_path),
            context_brain_path=env.get("JUNIPER_CONTEXT_BRAIN_PATH", default.context_brain_path),
            alert_acknowledgements_path=env.get(
                "JUNIPER_ALERT_ACKNOWLEDGEMENTS_PATH", default.alert_acknowledgements_path
            ),
            device_ref=env.get("JUNIPER_DEVICE_REFERENCE", default.device_ref),
            organization_ref=env.get("JUNIPER_ORGANIZATION_REFERENCE", default.organization_ref),
            ehr_brief_token_budget=int(
                env.get("JUNIPER_EHR_BRIEF_TOKEN_BUDGET", default.ehr_brief_token_budget)
            ),
            urgency_filter_enabled=_flag(
                env, "JUNIPER_URGENCY_FILTER", default.urgency_filter_enabled
            ),
            compassion_filter_enabled=_flag(
                env, "JUNIPER_COMPASSION_FILTER", default.compassion_filter_enabled
            ),
            context_mode=env.get("JUNIPER_CONTEXT_MODE", default.context_mode),
            moss_project_id=env.get("MOSS_PROJECT_ID"),
            moss_project_key=env.get("MOSS_PROJECT_KEY"),
            moss_model=env.get("JUNIPER_MOSS_MODEL", default.moss_model),
            moss_index_prefix=env.get("JUNIPER_MOSS_INDEX_PREFIX", default.moss_index_prefix),
            moss_query_timeout=float(
                env.get("JUNIPER_MOSS_QUERY_TIMEOUT", default.moss_query_timeout)
            ),
            moss_hydrate_timeout=float(
                env.get("JUNIPER_MOSS_HYDRATE_TIMEOUT", default.moss_hydrate_timeout)
            ),
            moss_full_rebuild_every=int(
                env.get("JUNIPER_MOSS_FULL_REBUILD_EVERY", default.moss_full_rebuild_every)
            ),
            # Phase A gates are literally "alpha tuning" and "top_k" — they
            # must be runnable without a code edit and redeploy.
            moss_alpha=float(env.get("JUNIPER_MOSS_ALPHA", default.moss_alpha)),
            moss_top_k_chart=int(env.get("JUNIPER_MOSS_TOP_K_CHART", default.moss_top_k_chart)),
            moss_top_k_memories=int(
                env.get("JUNIPER_MOSS_TOP_K_MEMORIES", default.moss_top_k_memories)
            ),
            moss_top_k_session=int(
                env.get("JUNIPER_MOSS_TOP_K_SESSION", default.moss_top_k_session)
            ),
            retrieval_state_path=env.get(
                "JUNIPER_RETRIEVAL_STATE_PATH", default.retrieval_state_path
            ),
            roster=ModelRoster.from_env(env),
            deepgram_listen_model=env.get(
                "JUNIPER_DEEPGRAM_LISTEN_MODEL", default.deepgram_listen_model
            ),
            cors_origins=_origins(env.get("JUNIPER_CORS_ORIGINS"), default.cors_origins),
            cors_origin_regex=(
                env["JUNIPER_CORS_ORIGIN_REGEX"] or None
                if "JUNIPER_CORS_ORIGIN_REGEX" in env
                else default.cors_origin_regex
            ),
            deepgram_speak_model=env.get(
                "JUNIPER_DEEPGRAM_SPEAK_MODEL", default.deepgram_speak_model
            ),
            deepgram_eot_threshold=float(
                env.get("JUNIPER_DEEPGRAM_EOT_THRESHOLD", default.deepgram_eot_threshold)
            ),
            deepgram_eot_timeout_ms=int(
                env.get("JUNIPER_DEEPGRAM_EOT_TIMEOUT_MS", default.deepgram_eot_timeout_ms)
            ),
        )
