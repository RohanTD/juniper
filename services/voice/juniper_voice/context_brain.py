"""Context Brain — two tiers of memory (docs/PLAN.md, "context_brain.py").

* **Experiential tier** — app-level JSON store on disk (path from env):
  grandchildren, hobbies, an upcoming beach trip, and **negative constraints**
  as first-class records ("don't mention her late husband").  FHIR has no good
  home for these.
* **Clinical/longitudinal tier** — read from FHIR via medplum.py (prior
  Juniper notes); compiled deterministically, no LLM.

Negative constraints are hard prohibitions, not prompt flavour: the compassion
filter enforces them independently rather than trusting the Companion to have
honoured them.

Post-call write-back updates the experiential tier from the transcript.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from .llm.provider import LLMProvider, extract_json
from .preferences import PreferencesStore

logger = logging.getLogger("juniper.context_brain")

WRITE_BACK_TAG = "context_brain.write_back"


@dataclass(frozen=True)
class ExperientialRecord:
    memories: tuple[str, ...] = ()
    negative_constraints: tuple[str, ...] = ()


class ContextBrain:
    def __init__(
        self,
        store_path: str | os.PathLike[str],
        preferences: PreferencesStore | None = None,
    ):
        self._path = Path(store_path)
        self._lock = threading.Lock()
        self._preferences = preferences

    # -- storage ------------------------------------------------------------
    def _load_all(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        with open(self._path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def _save_all(self, data: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
        os.replace(tmp, self._path)

    def record(self, patient_id: str) -> ExperientialRecord:
        with self._lock:
            raw = self._load_all().get(patient_id, {})
        return ExperientialRecord(
            memories=tuple(raw.get("memories", [])),
            negative_constraints=tuple(raw.get("negative_constraints", [])),
        )

    def add_memory(self, patient_id: str, memory: str) -> None:
        memory = memory.strip()
        if not memory:
            return
        with self._lock:
            data = self._load_all()
            entry = data.setdefault(patient_id, {"memories": [], "negative_constraints": []})
            if memory not in entry.setdefault("memories", []):
                entry["memories"].append(memory)
            self._save_all(data)

    def add_negative_constraint(self, patient_id: str, constraint: str) -> None:
        constraint = constraint.strip()
        if not constraint:
            return
        with self._lock:
            data = self._load_all()
            entry = data.setdefault(patient_id, {"memories": [], "negative_constraints": []})
            if constraint not in entry.setdefault("negative_constraints", []):
                entry["negative_constraints"].append(constraint)
            self._save_all(data)

    # -- prompt surfaces ----------------------------------------------------
    def negative_constraints(self, patient_id: str) -> tuple[str, ...]:
        """First-class negative constraints, unioned with the preference
        store's topicsToAvoid (docs/CONTRACTS.md §1: topicsToAvoid entries
        become negative constraints in the experiential tier)."""
        constraints = list(self.record(patient_id).negative_constraints)
        if self._preferences is not None:
            for topic in self._preferences.get(patient_id).topicsToAvoid:
                if topic not in constraints:
                    constraints.append(topic)
        return tuple(constraints)

    def digest(self, patient_id: str) -> str:
        """The experiential digest carried in the Companion's prompt — what
        makes the call feel like a relationship rather than a survey."""
        record = self.record(patient_id)
        lines: list[str] = []
        if record.memories:
            lines.append("Things you know about this patient from past calls:")
            lines.extend(f"- {memory}" for memory in record.memories)
        constraints = self.negative_constraints(patient_id)
        if constraints:
            lines.append("Topics you must NEVER bring up or mention (hard prohibitions):")
            lines.extend(f"- {constraint}" for constraint in constraints)
        return "\n".join(lines) if lines else "(no prior-call memories yet)"

    # -- clinical / longitudinal tier ---------------------------------------
    @staticmethod
    def clinical_digest(prior_notes: Sequence[dict[str, Any]]) -> str:
        """Deterministic digest of prior Juniper notes (fetched via
        medplum.py) for follow-up continuity; feeds the 4M advisory."""
        if not prior_notes:
            return ""
        lines = ["Prior Juniper check-in notes (most recent first):"]
        for note in prior_notes:
            date = note.get("date", "unknown date")
            title = ""
            content = note.get("content") or []
            if content:
                title = content[0].get("attachment", {}).get("title", "")
            lines.append(f"- {date}: {title or 'Juniper note'}")
        return "\n".join(lines)

    # -- post-call write-back -----------------------------------------------
    async def write_back(
        self,
        patient_id: str,
        transcript_text: str,
        *,
        provider: LLMProvider,
        model: str,
    ) -> tuple[str, ...]:
        """Extract new experiential memories from the full transcript and
        append them to the store.  Best-effort: a failure here must never sink
        the documentation pass."""
        system = (
            "You maintain the experiential memory of an elderly-care phone companion. "
            "From the call transcript, extract at most 5 short, durable, personal facts "
            "worth remembering for future calls (family names, hobbies, upcoming events, "
            "preferences). Exclude clinical findings — those live in the chart. "
            'Respond with STRICT JSON: {"memories": ["..."], "negative_constraints": ["..."]} '
            "where negative_constraints lists topics the patient asked not to discuss."
        )
        try:
            response = await provider.complete(
                tag=WRITE_BACK_TAG,
                model=model,
                system=system,
                messages=[{"role": "user", "content": transcript_text}],
                max_tokens=1024,
            )
            parsed = extract_json(response.text) or {}
        except Exception:  # noqa: BLE001 - best effort by design
            logger.exception("context brain write-back failed for %s", patient_id)
            return ()
        added: list[str] = []
        for memory in parsed.get("memories", []) or []:
            if isinstance(memory, str):
                self.add_memory(patient_id, memory)
                added.append(memory)
        for constraint in parsed.get("negative_constraints", []) or []:
            if isinstance(constraint, str):
                self.add_negative_constraint(patient_id, constraint)
        return tuple(added)
