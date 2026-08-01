"""Moss-backed retrieval — the only module that imports ``moss``.

Implements docs/MOSS_PLAN.md: two durable per-patient indexes (chart +
memories) hydrated at call start, one ephemeral per-call session, all queried
locally per turn. Everything here fails SOFT: any Moss error degrades a turn
to core-header + transcript-window context, and a hydration failure degrades
the whole call to brief mode. No safety property may ever depend on this
module — the urgency filter, consent gate, escalation path and documentation
pass have no Moss dependency.

Two hard rules enforced here rather than by convention:

- ``push_index`` is NEVER called on the call session. The raw transcript has
  exactly one durable home (Medplum); a second verbatim copy would be a
  parallel record needing lockstep retention and deletion.
- ``purge_patient`` must be durable: if index deletion fails, the intent is
  recorded and retried before this patient's indexes are ever touched again.
  Durable PHI storage is only defensible with a working deletion path.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Mapping, Protocol, Sequence

logger = logging.getLogger("juniper.retrieval")

try:  # The SDK is a hard dependency of moss mode, not of the service.
    import moss as _moss
except ImportError:  # pragma: no cover - exercised only without the extra
    _moss = None

# Turn numbers are stored zero-padded because Moss metadata comparisons are
# string-typed; lexicographic order must match numeric order.
_TURN_PAD = 6


async def _call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Invoke an SDK method that may be sync or async — the moss SDK's async
    surface has shifted between minor versions, and this seam must not."""
    result = fn(*args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


# ---------------------------------------------------------------------------
# Result shapes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RetrievedDoc:
    source: str  # "chart" | "memories" | "session"
    id: str
    text: str
    score: float = 0.0
    metadata: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievedContext:
    chart: tuple[RetrievedDoc, ...] = ()
    memories: tuple[RetrievedDoc, ...] = ()
    session: tuple[RetrievedDoc, ...] = ()
    degraded: bool = False  # True when any surface failed/timed out this turn

    @property
    def empty(self) -> bool:
        return not (self.chart or self.memories or self.session)

    def render(self) -> str:
        """Labeled context block for the Companion prompt. Retrieved text is
        reference material — the Companion's prompt says so explicitly, since
        transcript chunks contain patient-authored language."""
        blocks: list[str] = []
        if self.chart:
            blocks.append("From her chart:")
            blocks.extend(_bullet(doc) for doc in self.chart)
        if self.memories:
            blocks.append("From past conversations:")
            blocks.extend(_bullet(doc) for doc in self.memories)
        if self.session:
            blocks.append("Earlier in this call:")
            blocks.extend(_bullet(doc) for doc in self.session)
        return "\n".join(blocks)


def _bullet(doc: RetrievedDoc) -> str:
    date = doc.metadata.get("date", "")
    return f"- ({date}) {doc.text}" if date else f"- {doc.text}"


# ---------------------------------------------------------------------------
# Protocol — what the controller and post-call pass depend on
# ---------------------------------------------------------------------------

class PatientRetrieval(Protocol):
    async def ensure_ready(self) -> bool: ...
    async def retrieve(
        self, utterance: str, *, advisory_domain: str | None = None,
        advisory_hook: str | None = None, window_start_turn: int | None = None,
    ) -> RetrievedContext: ...
    async def append_turn(
        self, *, turn: int, patient_text: str, companion_text: str,
        phase: str, urgent: bool,
    ) -> None: ...
    async def append_finding(self, domain: str, findings: Mapping) -> None: ...
    async def probe_domain(self, domain: str) -> tuple[RetrievedDoc, ...]: ...
    async def project_memories(self, docs: Sequence[Mapping[str, Any]]) -> None: ...
    async def close(self) -> None: ...


# ---------------------------------------------------------------------------
# Durable retrieval state: chart watermarks + pending purges
# ---------------------------------------------------------------------------

class RetrievalStateStore:
    """Tiny JSON store for the non-FHIR state this module owns: the per-patient
    chart watermark, the per-patient call counter (periodic full rebuild), and
    the pending-purge ledger. Lives next to the other app-level stores."""

    def __init__(self, path: str | os.PathLike[str]):
        self._path = str(path)
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any]:
        try:
            with open(self._path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save(self, data: dict[str, Any]) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        tmp = f"{self._path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, self._path)

    def watermark(self, patient_id: str) -> str | None:
        with self._lock:
            return self._load().get("watermarks", {}).get(patient_id)

    def set_watermark(self, patient_id: str, iso: str) -> None:
        with self._lock:
            data = self._load()
            data.setdefault("watermarks", {})[patient_id] = iso
            self._save(data)

    def bump_call_count(self, patient_id: str) -> int:
        with self._lock:
            data = self._load()
            counts = data.setdefault("call_counts", {})
            counts[patient_id] = counts.get(patient_id, 0) + 1
            self._save(data)
            return counts[patient_id]

    def call_count(self, patient_id: str) -> int:
        with self._lock:
            return self._load().get("call_counts", {}).get(patient_id, 0)

    def reset_call_count(self, patient_id: str) -> None:
        with self._lock:
            data = self._load()
            data.setdefault("call_counts", {})[patient_id] = 0
            self._save(data)

    # -- pending purges ------------------------------------------------------
    def record_pending_purge(self, patient_id: str) -> None:
        with self._lock:
            data = self._load()
            pending = data.setdefault("pending_purges", [])
            if patient_id not in pending:
                pending.append(patient_id)
            self._save(data)

    def clear_pending_purge(self, patient_id: str) -> None:
        with self._lock:
            data = self._load()
            data["pending_purges"] = [
                p for p in data.get("pending_purges", []) if p != patient_id
            ]
            # A purged patient's watermark and counter are stale by definition.
            data.get("watermarks", {}).pop(patient_id, None)
            data.get("call_counts", {}).pop(patient_id, None)
            self._save(data)

    def purge_pending(self, patient_id: str) -> bool:
        with self._lock:
            return patient_id in self._load().get("pending_purges", [])

    def pending_purges(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._load().get("pending_purges", []))


# ---------------------------------------------------------------------------
# The real implementation
# ---------------------------------------------------------------------------

ChartSupplier = Callable[[], Awaitable[tuple[list[Any], str]]]
"""Returns (all chart documents, read-start watermark ISO). The watermark is
captured BEFORE the FHIR read starts — capturing it after would silently lose
any chart change that lands during the read window, forever."""

MemorySupplier = Callable[[], Sequence[Mapping[str, Any]]]

# 4M domain -> the chart-document domains that inform it, for slow-loop probes.
DOMAIN_PROBE_MAP: dict[str, tuple[str, ...]] = {
    "medication": ("medication", "allergy"),
    "mobility": ("observation", "condition", "encounter", "goal"),
    "mentation": ("observation", "condition", "note"),
    "what-matters": ("goal", "note", "appointment"),
}
DOMAIN_PROBE_QUERY: dict[str, str] = {
    "medication": "medications, prescriptions, pharmacy, adherence, doses",
    "mobility": "walking, falls, balance, stairs, physical activity, mobility aids",
    "mentation": "mood, memory, confusion, sleep, depression, cognition",
    "what-matters": "goals, what matters to the patient, family, independence",
}


class MossRetrieval:
    """Per-call retrieval facade over two durable indexes and one session."""

    def __init__(
        self,
        *,
        project_id: str,
        project_key: str,
        patient_id: str,
        call_id: str,
        chart_supplier: ChartSupplier,
        memory_supplier: MemorySupplier,
        state: RetrievalStateStore,
        model_id: str = "moss-mediumlm",
        index_prefix: str = "juniper",
        query_timeout: float = 0.15,
        hydrate_timeout: float = 2.0,
        top_k_chart: int = 4,
        top_k_memories: int = 3,
        top_k_session: int = 3,
        alpha: float = 0.7,
        full_rebuild_every: int = 20,
        client: Any | None = None,
    ):
        if _moss is None and client is None:
            raise RuntimeError(
                "moss SDK is not installed; install the service with the moss "
                "dependency or run with JUNIPER_CONTEXT_MODE=brief"
            )
        self._client = client or _moss.MossClient(project_id, project_key)
        self.patient_id = patient_id
        self.call_id = call_id
        self._chart_supplier = chart_supplier
        self._memory_supplier = memory_supplier
        self._state = state
        self._model_id = model_id
        self._prefix = index_prefix
        self._query_timeout = query_timeout
        self._hydrate_timeout = hydrate_timeout
        self._top_k = {"chart": top_k_chart, "memories": top_k_memories, "session": top_k_session}
        self._alpha = alpha
        self._full_rebuild_every = full_rebuild_every
        self._session: Any | None = None
        self._chart_loaded = False
        self._memories_loaded = False
        self._background: set[asyncio.Task] = set()

    # -- names --------------------------------------------------------------
    @property
    def chart_index(self) -> str:
        return f"{self._prefix}-chart-{self.patient_id}"

    @property
    def memories_index(self) -> str:
        return f"{self._prefix}-memories-{self.patient_id}"

    @property
    def session_name(self) -> str:
        return f"{self._prefix}-call-{self.call_id}"

    # -- lifecycle -----------------------------------------------------------
    async def ensure_ready(self) -> bool:
        """Hydrate the durable indexes and open the call session.

        Returns False (→ the call proceeds in brief mode) rather than raising:
        a patient still gets their call on any failure here. A pending purge
        also returns False — no new PHI indexes are built for a patient whose
        deletion is owed, and the purge is retried first.
        """
        if self._state.purge_pending(self.patient_id):
            logger.warning(
                "purge pending for %s — retrying purge and refusing moss mode",
                self.patient_id,
            )
            await self.purge_patient()
            return False
        try:
            self._chart_loaded = await self._hydrate_chart()
            if not self._chart_loaded:
                return False
            self._memories_loaded = await self._hydrate_memories()
            self._session = await asyncio.wait_for(
                _call(self._client.session, self.session_name, self._model_id),
                timeout=self._hydrate_timeout,
            )
        except Exception:  # noqa: BLE001 - hydration must fail soft
            logger.exception("moss hydration failed; falling back to brief mode")
            return False
        self._state.bump_call_count(self.patient_id)
        return True

    async def _hydrate_chart(self) -> bool:
        try:
            await asyncio.wait_for(
                _call(self._client.load_index, self.chart_index),
                timeout=self._hydrate_timeout,
            )
        except Exception:  # noqa: BLE001 - missing index or network failure
            # First call for this patient (or post-purge): build in the
            # background and let THIS call run in brief mode — a heavy chart
            # can take longer to embed than pre-dial allows.
            logger.info(
                "chart index %s not loadable; scheduling background build",
                self.chart_index,
            )
            self._spawn(self._build_chart_index(), name="chart_build")
            return False
        # Delta reconciliation: upsert only what changed since the watermark.
        try:
            docs, new_watermark = await self._chart_supplier()
            watermark = self._state.watermark(self.patient_id)
            changed = [
                d for d in docs
                if watermark is None or (d.last_updated or "") > watermark or not d.last_updated
            ]
            if changed:
                await _call(
                    self._client.add_docs,
                    self.chart_index,
                    [_to_moss_doc(d) for d in changed],
                    _mutation_options(upsert=True),
                )
            self._state.set_watermark(self.patient_id, new_watermark)
        except Exception:  # noqa: BLE001
            # A stale index is one call's worth of chart drift — log and carry
            # on; never a reason to degrade the call.
            logger.exception("chart delta reconciliation failed; index may be stale")
        return True

    async def _build_chart_index(self) -> None:
        try:
            docs, watermark = await self._chart_supplier()
            await _call(
                self._client.create_index,
                self.chart_index,
                [_to_moss_doc(d) for d in docs],
                self._model_id,
            )
            self._state.set_watermark(self.patient_id, watermark)
            self._state.reset_call_count(self.patient_id)
            logger.info("chart index %s built (%d docs)", self.chart_index, len(docs))
        except Exception:  # noqa: BLE001
            logger.exception("background chart build failed for %s", self.chart_index)

    async def _hydrate_memories(self) -> bool:
        try:
            await asyncio.wait_for(
                _call(self._client.load_index, self.memories_index),
                timeout=self._hydrate_timeout,
            )
            return True
        except Exception:  # noqa: BLE001
            # No memories yet (first ever call) — valid state, not a failure.
            logger.info("memories index %s not loadable; no memories yet", self.memories_index)
            return False

    async def close(self) -> None:
        """End-of-call cleanup. The session is DISCARDED — never pushed."""
        for task in list(self._background):
            if not task.done():
                task.cancel()
        self._session = None
        for name in (self.chart_index, self.memories_index):
            try:
                unload = getattr(self._client, "unload_index", None)
                if unload is not None:
                    await _call(unload, name)
            except Exception:  # noqa: BLE001
                pass

    def _spawn(self, coro: Awaitable[None], name: str) -> None:
        task = asyncio.create_task(coro, name=f"{self.call_id}:{name}")
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    # -- per-turn ------------------------------------------------------------
    async def retrieve(
        self,
        utterance: str,
        *,
        advisory_domain: str | None = None,
        advisory_hook: str | None = None,
        window_start_turn: int | None = None,
    ) -> RetrievedContext:
        """Three local queries, each individually timed out and fail-soft.

        The chart query is the utterance plus the standing advisory's hook when
        one is active, so an advisory like "pursue medication — she mentioned a
        new pharmacy" pulls pharmacy-adjacent facts. The session query excludes
        the turns already visible in the transcript window."""
        chart_query = utterance if not advisory_hook else f"{utterance}\n{advisory_hook}"
        session_filter = None
        if window_start_turn is not None and window_start_turn > 0:
            session_filter = {
                "field": "turn",
                "condition": {"$lt": _pad_turn(window_start_turn)},
            }

        chart, memories, session = await asyncio.gather(
            self._query_index(self.chart_index, chart_query, "chart", enabled=self._chart_loaded),
            self._query_index(
                self.memories_index, utterance, "memories", enabled=self._memories_loaded
            ),
            self._query_session(utterance, session_filter),
        )
        degraded = any(r is None for r in (chart, memories, session))
        return RetrievedContext(
            chart=chart or (),
            memories=memories or (),
            session=session or (),
            degraded=degraded,
        )

    async def _query_index(
        self,
        index: str,
        query: str,
        source: str,
        *,
        enabled: bool = True,
        filter: Mapping[str, Any] | None = None,
        top_k: int | None = None,
        alpha: float | None = None,
    ) -> tuple[RetrievedDoc, ...] | None:
        if not enabled or not query.strip():
            return ()
        try:
            result = await asyncio.wait_for(
                _call(
                    self._client.query,
                    index,
                    query,
                    _query_options(
                        top_k=top_k or self._top_k[source if source in self._top_k else "chart"],
                        alpha=self._alpha if alpha is None else alpha,
                        filter=filter,
                    ),
                ),
                timeout=self._query_timeout,
            )
            return tuple(_from_moss_doc(doc, source) for doc in result.docs)
        except Exception:  # noqa: BLE001 - a missed retrieval is a thinner turn
            logger.warning("%s query failed/timed out; degrading this turn", source)
            return None

    async def _query_session(
        self, query: str, filter: Mapping[str, Any] | None
    ) -> tuple[RetrievedDoc, ...] | None:
        if self._session is None or not query.strip():
            return ()
        try:
            result = await asyncio.wait_for(
                _call(
                    self._session.query,
                    query,
                    _query_options(top_k=self._top_k["session"], alpha=self._alpha, filter=filter),
                ),
                timeout=self._query_timeout,
            )
            return tuple(_from_moss_doc(doc, "session") for doc in result.docs)
        except Exception:  # noqa: BLE001
            logger.warning("session query failed/timed out; degrading this turn")
            return None

    # -- session writes (always off the critical path) -----------------------
    async def append_turn(
        self, *, turn: int, patient_text: str, companion_text: str, phase: str, urgent: bool
    ) -> None:
        if self._session is None:
            return
        try:
            doc = _document(
                id=f"turn-{_pad_turn(turn)}",
                text=f"patient: {patient_text}\ncompanion: {companion_text}",
                metadata={
                    "type": "turn",
                    "turn": _pad_turn(turn),
                    "phase": phase,
                    "urgent": "true" if urgent else "false",
                },
            )
            await _call(self._session.add_docs, [doc])
        except Exception:  # noqa: BLE001 - session writes must never sink a call
            logger.warning("session append_turn failed for turn %d", turn)

    async def append_finding(self, domain: str, findings: Mapping) -> None:
        if self._session is None:
            return
        try:
            doc = _document(
                id=f"finding-{domain}",
                text=f"4M finding for {domain}: {json.dumps(dict(findings), default=str)}",
                metadata={"type": "finding", "domain": domain},
            )
            await _call(self._session.add_docs, [doc], _mutation_options(upsert=True))
        except Exception:  # noqa: BLE001
            logger.warning("session append_finding failed for %s", domain)

    # -- slow-loop probes ----------------------------------------------------
    async def probe_domain(self, domain: str) -> tuple[RetrievedDoc, ...]:
        """Domain-targeted retrieval for the 4M agent and the Closer."""
        probe_query = DOMAIN_PROBE_QUERY.get(domain, domain)
        doc_domains = DOMAIN_PROBE_MAP.get(domain, (domain,))
        chart_filter = {"field": "domain", "condition": {"$in": list(doc_domains)}}
        chart, memories = await asyncio.gather(
            self._query_index(
                self.chart_index, probe_query, "chart",
                enabled=self._chart_loaded, filter=chart_filter, top_k=4,
            ),
            self._query_index(
                self.memories_index, probe_query, "memories",
                enabled=self._memories_loaded, top_k=2,
            ),
        )
        return tuple(chart or ()) + tuple(memories or ())

    # -- post-call projection ------------------------------------------------
    async def project_memories(self, docs: Sequence[Mapping[str, Any]]) -> None:
        """Upsert new memories/chunks into the durable memories index (creating
        it on first use), and schedule the periodic full chart rebuild."""
        moss_docs = [
            _document(id=d["id"], text=d["text"], metadata=dict(d.get("metadata", {})))
            for d in docs
            if d.get("text")
        ]
        if moss_docs:
            try:
                if self._memories_loaded:
                    await _call(
                        self._client.add_docs,
                        self.memories_index,
                        moss_docs,
                        _mutation_options(upsert=True),
                    )
                else:
                    await _call(
                        self._client.create_index, self.memories_index, moss_docs, self._model_id
                    )
                    self._memories_loaded = True
            except Exception:  # noqa: BLE001
                # The store of record (context brain JSON) already has the
                # memories; re-projection recovers this on any later call.
                logger.exception("memories projection failed; will re-project later")

        # Periodic full rebuild: delta upserts never remove documents whose
        # FHIR resources were deleted, so every Nth call the chart index is
        # rebuilt from scratch off the call path. (The counter is bumped once
        # per call in ensure_ready; here it is only read.)
        if (
            self._full_rebuild_every > 0
            and self._state.call_count(self.patient_id) >= self._full_rebuild_every
        ):
            await self._rebuild_chart()

    async def _rebuild_chart(self) -> None:
        try:
            docs, watermark = await self._chart_supplier()
            try:
                await _call(self._client.delete_index, self.chart_index)
            except Exception:  # noqa: BLE001 - absent index is fine
                pass
            await _call(
                self._client.create_index,
                self.chart_index,
                [_to_moss_doc(d) for d in docs],
                self._model_id,
            )
            self._state.set_watermark(self.patient_id, watermark)
            self._state.reset_call_count(self.patient_id)
            logger.info("chart index %s fully rebuilt (%d docs)", self.chart_index, len(docs))
        except Exception:  # noqa: BLE001
            logger.exception("periodic chart rebuild failed for %s", self.chart_index)

    # -- purge ---------------------------------------------------------------
    async def purge_patient(self) -> bool:
        """Delete both durable indexes. Durable-by-intent: failure records a
        pending purge that blocks moss mode for this patient and is retried."""
        self._state.record_pending_purge(self.patient_id)
        ok = True
        for name in (self.chart_index, self.memories_index):
            try:
                await _call(self._client.delete_index, name)
            except Exception as exc:  # noqa: BLE001
                if _is_not_found(exc):
                    continue
                logger.exception("purge: delete_index(%s) failed", name)
                ok = False
        if ok:
            self._state.clear_pending_purge(self.patient_id)
            logger.info("purged moss indexes for patient %s", self.patient_id)
        return ok


def _is_not_found(exc: Exception) -> bool:
    text = str(exc).lower()
    return "not found" in text or "does not exist" in text or "404" in text


# ---------------------------------------------------------------------------
# moss type adapters (kept in one place; the SDK's option classes are opaque)
# ---------------------------------------------------------------------------

def _document(*, id: str, text: str, metadata: Mapping[str, str]) -> Any:
    return _moss.DocumentInfo(id=id, text=text, metadata=dict(metadata))


def _to_moss_doc(chart_doc: Any) -> Any:
    return _document(id=chart_doc.id, text=chart_doc.text, metadata=chart_doc.metadata)


def _from_moss_doc(doc: Any, source: str) -> RetrievedDoc:
    return RetrievedDoc(
        source=source,
        id=getattr(doc, "id", ""),
        text=getattr(doc, "text", ""),
        score=float(getattr(doc, "score", 0.0) or 0.0),
        metadata=dict(getattr(doc, "metadata", None) or {}),
    )


def _query_options(
    *, top_k: int, alpha: float, filter: Mapping[str, Any] | None = None
) -> Any:
    kwargs: dict[str, Any] = {"top_k": top_k, "alpha": alpha}
    if filter is not None:
        kwargs["filter"] = dict(filter)
    return _moss.QueryOptions(**kwargs)


def _mutation_options(*, upsert: bool) -> Any:
    return _moss.MutationOptions(upsert=upsert)


def _pad_turn(turn: int) -> str:
    return str(turn).zfill(_TURN_PAD)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# FakeRetrieval — deterministic test double, mirrors FakeProvider
# ---------------------------------------------------------------------------

class FakeRetrieval:
    """Scripted retrieval for tests. Records every interaction; can be told to
    fail or hang. NEVER exposes push_index — the fake enforces the invariant
    at the type level."""

    def __init__(
        self,
        *,
        context: RetrievedContext | None = None,
        contexts_by_query: Mapping[str, RetrievedContext] | None = None,
        probe_results: Mapping[str, tuple[RetrievedDoc, ...]] | None = None,
        ready: bool = True,
        fail_retrieve: bool = False,
        hang_retrieve: bool = False,
    ):
        self.context = context or RetrievedContext()
        self.contexts_by_query = dict(contexts_by_query or {})
        self.probe_results = dict(probe_results or {})
        self.ready = ready
        self.fail_retrieve = fail_retrieve
        self.hang_retrieve = hang_retrieve
        self.retrieve_calls: list[dict[str, Any]] = []
        self.appended_turns: list[dict[str, Any]] = []
        self.appended_findings: list[tuple[str, Mapping]] = []
        self.probe_calls: list[str] = []
        self.projected: list[Mapping[str, Any]] = []
        self.closed = False
        self.purged = False

    async def ensure_ready(self) -> bool:
        return self.ready

    async def retrieve(
        self, utterance: str, *, advisory_domain: str | None = None,
        advisory_hook: str | None = None, window_start_turn: int | None = None,
    ) -> RetrievedContext:
        self.retrieve_calls.append(
            {
                "utterance": utterance,
                "advisory_domain": advisory_domain,
                "advisory_hook": advisory_hook,
                "window_start_turn": window_start_turn,
            }
        )
        if self.hang_retrieve:
            await asyncio.sleep(3600)
        if self.fail_retrieve:
            raise RuntimeError("scripted retrieval failure")
        for needle, context in self.contexts_by_query.items():
            if needle in utterance:
                return context
        return self.context

    async def append_turn(self, **kwargs: Any) -> None:
        self.appended_turns.append(dict(kwargs))

    async def append_finding(self, domain: str, findings: Mapping) -> None:
        self.appended_findings.append((domain, dict(findings)))

    async def probe_domain(self, domain: str) -> tuple[RetrievedDoc, ...]:
        self.probe_calls.append(domain)
        return self.probe_results.get(domain, ())

    async def project_memories(self, docs: Sequence[Mapping[str, Any]]) -> None:
        self.projected.extend(docs)

    async def close(self) -> None:
        self.closed = True

    async def purge_patient(self) -> bool:
        self.purged = True
        return True
