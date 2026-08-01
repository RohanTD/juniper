"""Typed access to packages/terminology/terminology.json.

Every Juniper code, CodeSystem URL and category slug lives in that one JSON
file, consumed by the Python voice service and the TS apps alike.  Nothing in
this service hardcodes a code string — everything routes through this module.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

ENV_PATH = "JUNIPER_TERMINOLOGY_PATH"
_RELATIVE_TO_REPO_ROOT = Path("packages") / "terminology" / "terminology.json"


class TerminologyError(RuntimeError):
    """The terminology file could not be located or is malformed."""


@dataclass(frozen=True)
class Coding:
    system: str
    code: str
    display: str

    def as_fhir(self) -> dict[str, str]:
        return {"system": self.system, "code": self.code, "display": self.display}

    def as_codeable_concept(self) -> dict[str, Any]:
        return {"coding": [self.as_fhir()]}


def _find_terminology_file(explicit: str | os.PathLike[str] | None = None) -> Path:
    if explicit is not None:
        path = Path(explicit)
        if path.is_file():
            return path
        raise TerminologyError(f"terminology file not found at {path}")

    env = os.environ.get(ENV_PATH)
    if env:
        path = Path(env)
        if path.is_file():
            return path
        raise TerminologyError(f"{ENV_PATH}={env} does not point at a file")

    # Resolve relative to the repo root by walking up from this module
    # (services/voice/juniper_voice/terminology.py -> repo root).
    for parent in Path(__file__).resolve().parents:
        candidate = parent / _RELATIVE_TO_REPO_ROOT
        if candidate.is_file():
            return candidate
    raise TerminologyError(
        "could not locate packages/terminology/terminology.json; "
        f"set {ENV_PATH} explicitly"
    )


class Terminology:
    """Typed accessors mirroring the TS @juniper/terminology package."""

    def __init__(self, raw: Mapping[str, Any]):
        self._raw = raw

    # -- code systems -------------------------------------------------------
    def _system_coding(self, system_key: str, code_key: str) -> Coding:
        try:
            system = self._raw["codeSystems"][system_key]
            entry = system["codes"][code_key]
            return Coding(system=system["url"], code=entry["code"], display=entry["display"])
        except KeyError as exc:  # pragma: no cover - config error
            raise TerminologyError(f"missing terminology entry {system_key}.{code_key}") from exc

    def note_category(self, key: str) -> Coding:
        """key is one of: note, transcript, familySummary, familyGuidance."""
        return self._system_coding("noteCategory", key)

    def fourm_domain(self, key: str) -> Coding:
        """key is one of: whatMatters, medication, mentation, mobility."""
        return self._system_coding("fourMDomain", key)

    def fourm_domains(self) -> dict[str, Coding]:
        """Mapping of domain *code* (e.g. 'what-matters') -> Coding."""
        system = self._raw["codeSystems"]["fourMDomain"]
        return {
            entry["code"]: Coding(system=system["url"], code=entry["code"], display=entry["display"])
            for entry in system["codes"].values()
        }

    def task_category(self, key: str = "escalation") -> Coding:
        return self._system_coding("taskCategory", key)

    def consent_provision(self, key: str) -> Coding:
        """key is one of: aiCalling, recording, familySharing."""
        return self._system_coding("consentProvision", key)

    @property
    def consent_provision_system(self) -> str:
        return self._raw["codeSystems"]["consentProvision"]["url"]

    def encounter_reason(self, key: str = "fourMCheckIn") -> Coding:
        return self._system_coding("encounterReason", key)

    # -- external codes -----------------------------------------------------
    def _external(self, key: str) -> Coding:
        entry = self._raw["external"][key]
        return Coding(system=entry["system"], code=entry["code"], display=entry["display"])

    @property
    def note_type(self) -> Coding:
        return self._external("noteType")

    @property
    def encounter_class(self) -> Coding:
        return self._external("encounterClass")

    @property
    def consent_scope(self) -> Coding:
        return self._external("consentScope")

    @property
    def consent_policy_uri(self) -> str:
        return self._raw["external"]["consentPolicy"]["uri"]

    # -- identifiers --------------------------------------------------------
    @property
    def device_identifier(self) -> tuple[str, str]:
        entry = self._raw["identifiers"]["device"]
        return entry["system"], entry["value"]

    @property
    def organization_identifier(self) -> tuple[str, str]:
        entry = self._raw["identifiers"]["organization"]
        return entry["system"], entry["value"]

    # -- document constants -------------------------------------------------
    @property
    def relates_to_transcript_code(self) -> str:
        return self._raw["documents"]["relatesToTranscript"]

    @property
    def doc_status_initial(self) -> str:
        return self._raw["documents"]["docStatus"]["initial"]

    @property
    def doc_status_reviewed(self) -> str:
        return self._raw["documents"]["docStatus"]["reviewed"]

    @property
    def document_content_type(self) -> str:
        return self._raw["documents"]["contentType"]


def load_terminology(path: str | os.PathLike[str] | None = None) -> Terminology:
    file = _find_terminology_file(path)
    with open(file, "r", encoding="utf-8") as fh:
        return Terminology(json.load(fh))


@lru_cache(maxsize=1)
def get_terminology() -> Terminology:
    """Process-wide default instance (honours JUNIPER_TERMINOLOGY_PATH)."""
    return load_terminology()
