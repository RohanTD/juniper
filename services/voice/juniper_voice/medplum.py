"""Medplum FHIR access — broad pre-call reads, narrow post-call writes.

Reads are broad: everything in docs/PLAN.md's read table is fetched once
pre-call and compiled into a single token-budgeted **EHR brief** held for the
whole conversation.  No FHIR round trips happen mid-call — they would land
directly on the latency path.

Writes are narrow: ``Encounter`` -> ``Binary``+``DocumentReference`` (note) ->
``Binary``+``DocumentReference`` (transcript) -> ``Binary``+
``DocumentReference`` (family summary, consent-gated) -> escalation ``Task``s.
Resource shapes follow docs/PLAN.md's FHIR write contract exactly (Device
author, docStatus preliminary, relatesTo transforms, category codings from
the terminology package).
"""

from __future__ import annotations

import base64
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Protocol, Sequence

import httpx

from .terminology import Terminology


class MedplumError(RuntimeError):
    pass


class ConsentError(MedplumError):
    """The pre-call consent gate refused to proceed."""


class FHIRStore(Protocol):
    """The surface this module needs — implemented by MedplumClient and by
    the in-memory test stub."""

    async def search(self, resource_type: str, params: Mapping[str, str]) -> list[dict[str, Any]]: ...
    async def create(self, resource: Mapping[str, Any]) -> dict[str, Any]: ...
    async def transaction(self, bundle: Mapping[str, Any]) -> dict[str, Any]: ...
    async def read(self, resource_type: str, resource_id: str) -> dict[str, Any]: ...


class MedplumClient:
    """httpx client speaking plain FHIR REST with OAuth2 client-credentials."""

    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        http: httpx.AsyncClient | None = None,
    ):
        self._base = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http or httpx.AsyncClient(timeout=20.0)
        self._token: str | None = None
        self._token_expires_at = 0.0

    async def close(self) -> None:
        await self._http.aclose()

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 30:
            return self._token
        response = await self._http.post(
            f"{self._base}/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        if response.status_code != 200:
            raise MedplumError(f"token request failed: {response.status_code} {response.text}")
        payload = response.json()
        self._token = payload["access_token"]
        self._token_expires_at = time.time() + float(payload.get("expires_in", 3600))
        return self._token

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        token = await self._access_token()
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"
        headers.setdefault("Content-Type", "application/fhir+json")
        # rstrip: a transaction Bundle posts to the bare .../fhir/R4 root
        # (path=""), which must not carry a trailing slash.
        url = f"{self._base}/fhir/R4/{path}".rstrip("/")
        response = await self._http.request(method, url, headers=headers, **kwargs)
        if response.status_code >= 400:
            raise MedplumError(
                f"{method} {path} failed: {response.status_code} {response.text}"
            )
        return response

    async def search(self, resource_type: str, params: Mapping[str, str]) -> list[dict[str, Any]]:
        response = await self._request("GET", resource_type, params=dict(params))
        bundle = response.json()
        return [
            entry["resource"]
            for entry in bundle.get("entry", [])
            if "resource" in entry
        ]

    async def create(self, resource: Mapping[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", resource["resourceType"], json=dict(resource))
        return response.json()

    async def transaction(self, bundle: Mapping[str, Any]) -> dict[str, Any]:
        """Submit a FHIR transaction Bundle.

        Hosted Medplum does NOT support PUT-to-create with a client-assigned
        id ("update-as-create") — verified live: PUT to a brand-new,
        never-used id 404s. A transaction Bundle with urn:uuid fullUrls is
        the actual supported way to pre-wire circular references (e.g. a
        Binary's securityContext pointing at its not-yet-created owning
        DocumentReference): Medplum resolves urn:uuid refs atomically,
        including inside Attachment.url even though that field is a plain
        string rather than a typed Reference (confirmed live).
        """
        response = await self._request("POST", "", json=dict(bundle))
        return response.json()

    async def read(self, resource_type: str, resource_id: str) -> dict[str, Any]:
        response = await self._request("GET", f"{resource_type}/{resource_id}")
        return response.json()


# ---------------------------------------------------------------------------
# Consent gate
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ConsentStatus:
    ai_calling: bool = False
    recording: bool = False
    family_sharing: bool = False
    resource_id: str | None = None

    @property
    def may_dial(self) -> bool:
        # docs/CONTRACTS.md §3: refuse to dial unless the Consent grants
        # ai-calling AND call-recording; family-sharing gates only the
        # family summary generation.
        return self.ai_calling and self.recording


def _collect_provision_codes(provision: Mapping[str, Any], system: str) -> set[str]:
    codes: set[str] = set()
    for concept in provision.get("code", []) or []:
        for coding in concept.get("coding", []) or []:
            if coding.get("system") == system and coding.get("code"):
                codes.add(coding["code"])
    for nested in provision.get("provision", []) or []:
        codes |= _collect_provision_codes(nested, system)
    return codes


async def verify_consent(
    store: FHIRStore, patient_id: str, terminology: Terminology
) -> ConsentStatus:
    consents = await store.search(
        "Consent", {"patient": f"Patient/{patient_id}", "status": "active"}
    )
    system = terminology.consent_provision_system
    granted: set[str] = set()
    resource_id: str | None = None
    for consent in consents:
        if consent.get("status") != "active":
            continue
        provision = consent.get("provision") or {}
        codes = _collect_provision_codes(provision, system)
        if codes:
            granted |= codes
            resource_id = consent.get("id", resource_id)
    return ConsentStatus(
        ai_calling=terminology.consent_provision("aiCalling").code in granted,
        recording=terminology.consent_provision("recording").code in granted,
        family_sharing=terminology.consent_provision("familySharing").code in granted,
        resource_id=resource_id,
    )


def require_dialing_consent(consent: ConsentStatus, patient_id: str) -> None:
    if not consent.may_dial:
        raise ConsentError(
            f"refusing to dial Patient/{patient_id}: Consent must actively grant "
            "ai-calling and call-recording"
        )


# ---------------------------------------------------------------------------
# EHR brief — broad read, compiled once, token-budgeted
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EHRBrief:
    text: str
    patient_id: str
    patient_name: str
    preferred_name: str | None
    language: str | None
    phone: str | None
    consent: ConsentStatus
    care_team_refs: tuple[str, ...]
    prior_notes: tuple[dict[str, Any], ...]
    token_estimate: int


def estimate_tokens(text: str) -> int:
    # A deliberately cheap heuristic (~4 chars/token) — the budget exists to
    # bound prompt growth, not to bill precisely.
    return (len(text) + 3) // 4


def _human_name(name: Mapping[str, Any]) -> str:
    if name.get("text"):
        return name["text"]
    given = " ".join(name.get("given", []) or [])
    return f"{given} {name.get('family', '')}".strip()


def _coding_display(concept: Mapping[str, Any] | None) -> str:
    if not concept:
        return ""
    if concept.get("text"):
        return concept["text"]
    for coding in concept.get("coding", []) or []:
        if coding.get("display"):
            return coding["display"]
        if coding.get("code"):
            return coding["code"]
    return ""


def _medication_display(resource: Mapping[str, Any]) -> str:
    return _coding_display(resource.get("medicationCodeableConcept")) or "medication"


def _unit(quantity: Mapping[str, Any]) -> str:
    """UCUM annotation-only units (`{score}`, `{beats}/min`) are machine
    syntax, not something to read out in a prompt."""
    unit = str(quantity.get("unit") or "")
    return "" if unit.startswith("{") and unit.endswith("}") else unit


def _quantity_text(quantity: Mapping[str, Any]) -> str:
    value = quantity.get("value")
    if value is None:
        return ""
    return f"{value} {_unit(quantity)}".strip()


def _observation_value(resource: Mapping[str, Any]) -> str:
    """Render an Observation's value.

    Component observations must be handled explicitly: blood pressure — the
    single most relevant vital for this population — carries its systolic and
    diastolic readings in ``component[]`` and has no top-level value at all, so
    a valueQuantity-only reader silently renders a bare "Blood pressure" label
    with no numbers behind it.
    """
    quantity = resource.get("valueQuantity") or {}
    if quantity:
        text = _quantity_text(quantity)
        return f" {text}" if text else ""
    if resource.get("valueString"):
        return f" {resource['valueString']}"
    concept = _coding_display(resource.get("valueCodeableConcept"))
    if concept:
        return f" {concept}"

    parts: list[str] = []
    for component in resource.get("component", []) or []:
        label = _coding_display(component.get("code"))
        text = _quantity_text(component.get("valueQuantity") or {})
        if not text:
            text = _coding_display(component.get("valueCodeableConcept"))
        if not text:
            continue
        # "Systolic blood pressure" under a "Blood pressure" heading is noise;
        # keep the distinguishing word only.
        short = label.replace("blood pressure", "").replace("Blood pressure", "").strip()
        parts.append(f"{short} {text}".strip() if short else text)
    if parts:
        return " " + "/".join(parts) if len(parts) == 2 else " " + ", ".join(parts)
    return ""


@dataclass
class _Section:
    priority: int  # lower = kept longer under budget pressure
    title: str
    lines: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ChartSnapshot:
    """One broad pre-call read of the chart — the single source both the
    compiled brief and the chart-index documents are derived from, so the two
    can never disagree about what was read."""

    patient: dict[str, Any]
    conditions: list[dict[str, Any]]
    med_statements: list[dict[str, Any]]
    med_requests: list[dict[str, Any]]
    allergies: list[dict[str, Any]]
    observations: list[dict[str, Any]]
    encounters: list[dict[str, Any]]
    appointments: list[dict[str, Any]]
    care_plans: list[dict[str, Any]]
    goals: list[dict[str, Any]]
    care_teams: list[dict[str, Any]]
    prior_notes: list[dict[str, Any]]
    # Captured BEFORE the reads start. Capturing it after would silently and
    # permanently lose any chart change that lands during the read window —
    # the classic watermark race.
    read_started_at: str


async def fetch_chart_snapshot(
    store: FHIRStore,
    patient_id: str,
    terminology: Terminology,
    *,
    today_iso: str | None = None,
    now_iso: str | None = None,
) -> ChartSnapshot:
    from datetime import datetime, timezone

    read_started_at = now_iso or datetime.now(timezone.utc).isoformat()
    patient_ref = f"Patient/{patient_id}"

    patient = await store.read("Patient", patient_id)

    # Recency-filter aggressively: bounded counts, most-recent-first sorts.
    conditions = await store.search("Condition", {"patient": patient_ref, "_count": "25"})
    med_statements = await store.search(
        "MedicationStatement", {"patient": patient_ref, "_count": "25"}
    )
    med_requests = await store.search(
        "MedicationRequest", {"patient": patient_ref, "_count": "25", "status": "active"}
    )
    allergies = await store.search("AllergyIntolerance", {"patient": patient_ref})
    observations = await store.search(
        "Observation", {"patient": patient_ref, "_sort": "-date", "_count": "30"}
    )
    encounters = await store.search(
        "Encounter", {"patient": patient_ref, "_sort": "-date", "_count": "10"}
    )
    appointment_params = {"patient": patient_ref, "_count": "10"}
    if today_iso:
        appointment_params["date"] = f"ge{today_iso}"
    appointments = await store.search("Appointment", appointment_params)
    care_plans = await store.search("CarePlan", {"patient": patient_ref, "_count": "10"})
    goals = await store.search("Goal", {"patient": patient_ref, "_count": "10"})
    care_teams = await store.search("CareTeam", {"patient": patient_ref})
    prior_notes = await store.search(
        "DocumentReference",
        {
            "patient": patient_ref,
            "category": terminology.note_category("note").code,
            "_sort": "-date",
            "_count": "3",
        },
    )
    return ChartSnapshot(
        patient=patient,
        conditions=conditions,
        med_statements=med_statements,
        med_requests=med_requests,
        allergies=allergies,
        observations=observations,
        encounters=encounters,
        appointments=appointments,
        care_plans=care_plans,
        goals=goals,
        care_teams=care_teams,
        prior_notes=prior_notes,
        read_started_at=read_started_at,
    )


@dataclass(frozen=True)
class PatientContext:
    brief: EHRBrief
    snapshot: ChartSnapshot


async def compile_patient_context(
    store: FHIRStore,
    patient_id: str,
    terminology: Terminology,
    *,
    token_budget: int = 2500,
    enforce_consent: bool = True,
    today_iso: str | None = None,
    now_iso: str | None = None,
) -> PatientContext:
    """The pre-call read: consent gate, one chart snapshot, one compiled brief.

    The consent gate runs here so nothing downstream can dial without it — and
    it runs fresh on every call, never from any cached or indexed state.
    """
    consent = await verify_consent(store, patient_id, terminology)
    if enforce_consent:
        require_dialing_consent(consent, patient_id)
    snapshot = await fetch_chart_snapshot(
        store, patient_id, terminology, today_iso=today_iso, now_iso=now_iso
    )
    brief = _compile_brief_from_snapshot(snapshot, consent, patient_id, token_budget)
    return PatientContext(brief=brief, snapshot=snapshot)


async def compile_ehr_brief(
    store: FHIRStore,
    patient_id: str,
    terminology: Terminology,
    *,
    token_budget: int = 2500,
    enforce_consent: bool = True,
    today_iso: str | None = None,
) -> EHRBrief:
    """Fetch the full read table once and compile — don't concatenate — into a
    compact digest sized to sit in context for the whole call."""
    context = await compile_patient_context(
        store,
        patient_id,
        terminology,
        token_budget=token_budget,
        enforce_consent=enforce_consent,
        today_iso=today_iso,
    )
    return context.brief


def _compile_brief_from_snapshot(
    snapshot: ChartSnapshot,
    consent: ConsentStatus,
    patient_id: str,
    token_budget: int,
) -> EHRBrief:
    patient = snapshot.patient
    conditions = snapshot.conditions
    med_statements = snapshot.med_statements
    med_requests = snapshot.med_requests
    allergies = snapshot.allergies
    observations = snapshot.observations
    encounters = snapshot.encounters
    appointments = snapshot.appointments
    care_plans = snapshot.care_plans
    goals = snapshot.goals
    care_teams = snapshot.care_teams
    prior_notes = snapshot.prior_notes

    # -- identity ----------------------------------------------------------
    names = patient.get("name", []) or []
    legal = next((n for n in names if n.get("use") != "nickname"), {})
    nickname = next((n for n in names if n.get("use") == "nickname"), None)
    patient_name = _human_name(legal) if legal else patient_id
    preferred = _human_name(nickname) if nickname else None
    phone = next(
        (t.get("value") for t in patient.get("telecom", []) or [] if t.get("system") == "phone"),
        None,
    )
    language = None
    for communication in patient.get("communication", []) or []:
        language = _coding_display(communication.get("language")) or language

    care_team_refs: list[str] = []
    for team in care_teams:
        for participant in team.get("participant", []) or []:
            ref = (participant.get("member") or {}).get("reference")
            if ref:
                care_team_refs.append(ref)

    # -- sections (priority: lower number survives budget pressure longer) --
    sections: list[_Section] = []

    identity = _Section(0, "Patient")
    identity.lines.append(
        f"{patient_name}"
        + (f' (goes by "{preferred}")' if preferred else "")
        + (f", born {patient['birthDate']}" if patient.get("birthDate") else "")
        + (f", speaks {language}" if language else "")
    )
    sections.append(identity)

    meds = _Section(1, "Medications")
    seen_meds: set[str] = set()
    for resource in list(med_statements) + list(med_requests):
        display = _medication_display(resource)
        dosage = ""
        dosages = resource.get("dosage") or resource.get("dosageInstruction") or []
        if dosages and dosages[0].get("text"):
            dosage = f" — {dosages[0]['text']}"
        if display not in seen_meds:
            seen_meds.add(display)
            meds.lines.append(f"{display}{dosage}")
    sections.append(meds)

    cond = _Section(1, "Conditions")
    for resource in conditions:
        display = _coding_display(resource.get("code"))
        if display:
            cond.lines.append(display)
    sections.append(cond)

    allergy = _Section(1, "Allergies")
    for resource in allergies:
        display = _coding_display(resource.get("code"))
        if display:
            allergy.lines.append(display)
    sections.append(allergy)

    recent = _Section(1, "Recent encounters")
    for resource in encounters:
        period = resource.get("period", {}) or {}
        when = (period.get("start") or "")[:10]
        klass = (resource.get("class") or {}).get("code", "")
        what = _coding_display((resource.get("type") or [{}])[0]) if resource.get("type") else ""
        reason = ""
        if resource.get("reasonCode"):
            reason = _coding_display(resource["reasonCode"][0])
        label = ", ".join(part for part in [what or klass, reason] if part)
        recent.lines.append(f"{when}: {label or 'encounter'}")
    sections.append(recent)

    upcoming = _Section(1, "Upcoming appointments")
    for resource in appointments:
        when = (resource.get("start") or "")[:16].replace("T", " ")
        what = _coding_display(resource.get("appointmentType")) or _coding_display(
            (resource.get("serviceType") or [{}])[0] if resource.get("serviceType") else None
        )
        description = resource.get("description") or what or "appointment"
        upcoming.lines.append(f"{when}: {description}")
    sections.append(upcoming)

    goals_section = _Section(2, "Care goals")
    for resource in goals:
        display = _coding_display(resource.get("description"))
        if display:
            goals_section.lines.append(display)
    for resource in care_plans:
        if resource.get("title"):
            goals_section.lines.append(f"Care plan: {resource['title']}")
    sections.append(goals_section)

    obs = _Section(3, "Recent observations")
    for resource in observations:
        display = _coding_display(resource.get("code"))
        rendered = _observation_value(resource)
        when = (resource.get("effectiveDateTime") or "")[:10]
        if display:
            obs.lines.append(f"{when}: {display}{rendered}".strip())
    sections.append(obs)

    notes_section = _Section(2, "Prior Juniper notes")
    for resource in prior_notes:
        when = (resource.get("date") or "")[:10]
        title = ""
        if resource.get("content"):
            title = resource["content"][0].get("attachment", {}).get("title", "")
        notes_section.lines.append(f"{when}: {title or 'Juniper note'}")
    sections.append(notes_section)

    text = _assemble_within_budget(sections, token_budget)

    return EHRBrief(
        text=text,
        patient_id=patient_id,
        patient_name=patient_name,
        preferred_name=preferred,
        language=language,
        phone=phone,
        consent=consent,
        care_team_refs=tuple(care_team_refs),
        prior_notes=tuple(prior_notes),
        token_estimate=estimate_tokens(text),
    )


def _assemble_within_budget(sections: Sequence[_Section], token_budget: int) -> str:
    """Compile sections, trimming line tails from the lowest-priority
    sections first until the estimate fits the budget."""

    def render(secs: Sequence[_Section]) -> str:
        parts: list[str] = []
        for section in secs:
            if not section.lines:
                continue
            parts.append(f"## {section.title}")
            parts.extend(f"- {line}" for line in section.lines)
        return "\n".join(parts)

    working = [_Section(s.priority, s.title, list(s.lines)) for s in sections]
    text = render(working)
    while estimate_tokens(text) > token_budget:
        # Drop one line from the tail of the lowest-priority non-empty section.
        candidates = [s for s in working if s.lines]
        if not candidates:
            break
        victim = max(candidates, key=lambda s: (s.priority, len(s.lines)))
        if victim.priority == 0 and len(candidates) == 1:
            # Never trim identity below one line; hard-truncate instead.
            text = text[: token_budget * 4]
            break
        victim.lines.pop()
        text = render(working)
    return text


# ---------------------------------------------------------------------------
# Chart documents + core header — the moss-mode projection of the snapshot
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChartDocument:
    """One chart fact as a retrieval document: a compiled line, not raw FHIR."""

    id: str
    text: str
    metadata: dict[str, str]
    # meta.lastUpdated when present; "" means unknown, which the delta
    # reconciler treats as always-changed (safe: an extra upsert, never a miss).
    last_updated: str = ""


def _doc(resource: Mapping[str, Any], domain: str, text: str, **extra: str) -> ChartDocument:
    rtype = str(resource.get("resourceType", "resource")).lower()
    rid = str(resource.get("id") or abs(hash(text)))
    metadata = {"domain": domain, **{k: v for k, v in extra.items() if v}}
    return ChartDocument(
        id=f"{rtype}-{rid}",
        text=text,
        metadata=metadata,
        last_updated=str((resource.get("meta") or {}).get("lastUpdated") or ""),
    )


def extract_chart_documents(snapshot: ChartSnapshot) -> list[ChartDocument]:
    """One resource → one document. The text lines reuse the same rendering
    the brief uses, so a fact reads identically whichever path carries it."""
    docs: list[ChartDocument] = []

    for resource in snapshot.conditions:
        display = _coding_display(resource.get("code"))
        if display:
            onset = (resource.get("onsetDateTime") or "")[:10]
            docs.append(_doc(resource, "condition", display, date=onset))

    for resource in list(snapshot.med_statements) + list(snapshot.med_requests):
        display = _medication_display(resource)
        dosage = ""
        dosages = resource.get("dosage") or resource.get("dosageInstruction") or []
        if dosages and dosages[0].get("text"):
            dosage = f" — {dosages[0]['text']}"
        authored = (resource.get("authoredOn") or "")[:10]
        status = str(resource.get("status") or "")
        docs.append(
            _doc(resource, "medication", f"{display}{dosage}", date=authored, status=status)
        )

    for resource in snapshot.allergies:
        display = _coding_display(resource.get("code"))
        if display:
            docs.append(_doc(resource, "allergy", f"Allergy: {display}"))

    for resource in snapshot.observations:
        display = _coding_display(resource.get("code"))
        if not display:
            continue
        when = (resource.get("effectiveDateTime") or "")[:10]
        docs.append(
            _doc(resource, "observation", f"{display}{_observation_value(resource)}", date=when)
        )

    for resource in snapshot.encounters:
        period = resource.get("period", {}) or {}
        when = (period.get("start") or "")[:10]
        klass = (resource.get("class") or {}).get("code", "")
        what = _coding_display((resource.get("type") or [{}])[0]) if resource.get("type") else ""
        reason = ""
        if resource.get("reasonCode"):
            reason = _coding_display(resource["reasonCode"][0])
        label = ", ".join(part for part in [what or klass, reason] if part)
        docs.append(_doc(resource, "encounter", label or "encounter", date=when))

    for resource in snapshot.appointments:
        when = (resource.get("start") or "")[:16].replace("T", " ")
        description = resource.get("description") or "appointment"
        docs.append(_doc(resource, "appointment", f"Upcoming: {description}", date=when[:10]))

    for resource in snapshot.goals:
        display = _coding_display(resource.get("description"))
        if display:
            docs.append(_doc(resource, "goal", f"Care goal: {display}"))
    for resource in snapshot.care_plans:
        if resource.get("title"):
            docs.append(_doc(resource, "goal", f"Care plan: {resource['title']}"))

    for resource in snapshot.prior_notes:
        when = (resource.get("date") or "")[:10]
        title = ""
        if resource.get("content"):
            title = resource["content"][0].get("attachment", {}).get("title", "")
        docs.append(_doc(resource, "note", f"Prior note: {title or 'Juniper note'}", date=when))

    return docs


def compile_core_header(brief: EHRBrief, snapshot: ChartSnapshot) -> str:
    """The always-pinned core: identity, allergies, active medication NAMES.

    Deliberately small and deterministic — this is the context that must never
    be retrieval-gated (docs/MOSS_PLAN.md). Negative constraints are pinned
    separately by the controller; consent is a code gate, not context.
    """
    lines: list[str] = ["## Patient"]
    identity = brief.patient_name
    if brief.preferred_name:
        identity += f' (goes by "{brief.preferred_name}")'
    birth = snapshot.patient.get("birthDate")
    if birth:
        identity += f", born {birth}"
    if brief.language:
        identity += f", speaks {brief.language}"
    lines.append(f"- {identity}")

    allergy_names = [
        _coding_display(r.get("code")) for r in snapshot.allergies if _coding_display(r.get("code"))
    ]
    lines.append("## Allergies")
    if allergy_names:
        lines.extend(f"- {name}" for name in allergy_names)
    else:
        lines.append("- none recorded")

    seen: set[str] = set()
    med_names: list[str] = []
    for resource in list(snapshot.med_statements) + list(snapshot.med_requests):
        display = _medication_display(resource)
        if display and display not in seen:
            seen.add(display)
            med_names.append(display)
    lines.append("## Active medications (names)")
    if med_names:
        lines.extend(f"- {name}" for name in med_names)
    else:
        lines.append("- none recorded")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Post-call writes — the narrow write surface
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PostCallWriteResult:
    encounter_id: str
    note_id: str
    note_binary_id: str
    transcript_id: str
    transcript_binary_id: str
    family_summary_id: str | None
    family_summary_binary_id: str | None
    task_ids: tuple[str, ...]


def _binary_resource(text: str, content_type: str, owner_doc_ref: str) -> dict[str, Any]:
    """A Binary always carries securityContext -> its owning DocumentReference.

    ``owner_doc_ref`` is a full reference string ("DocumentReference/<id>" or
    a "urn:uuid:..." placeholder resolved within the same transaction Bundle)
    rather than a bare id, since the owning DocumentReference is written in
    the same atomic transaction and may not have a real id yet.

    Medplum cannot scope Binary reads by criteria in an AccessPolicy — Binary
    access is governed by securityContext inheritance plus presigned attachment
    URLs.  The caregiver AccessPolicy grants NO Binary access; family-summary
    content reaches caregivers only via the presigned content.attachment.url.
    Pointing securityContext at the Patient (or leaving it unset) would expose
    the clinical-note and raw-transcript binaries to any caregiver with
    patient-compartment visibility — a severe leak under that access model.
    """
    return {
        "resourceType": "Binary",
        "contentType": content_type,
        "securityContext": {"reference": owner_doc_ref},
        "data": base64.b64encode(text.encode("utf-8")).decode("ascii"),
    }


def _document_reference(
    *,
    terminology: Terminology,
    category_key: str,
    patient_id: str,
    encounter_ref: str,
    binary_ref: str,
    title: str,
    date_iso: str,
    period_start: str,
    period_end: str,
    device_ref: str,
    organization_ref: str | None,
    relates_to_ref: str | None = None,
) -> dict[str, Any]:
    """docs/PLAN.md FHIR write contract, verbatim shape.

    ``encounter_ref``/``binary_ref``/``relates_to_ref`` are full reference
    strings (real "Type/id" or "urn:uuid:..." placeholders resolved within
    the same transaction Bundle) rather than bare ids.

    author is a Device, never a Practitioner — AI-generated text must not be
    attributed to a human clinician.  docStatus sits at 'preliminary';
    clinician review is what flips it to 'final'.
    """
    resource: dict[str, Any] = {
        "resourceType": "DocumentReference",
        "status": "current",
        "docStatus": terminology.doc_status_initial,
        "type": terminology.note_type.as_codeable_concept(),
        "category": [terminology.note_category(category_key).as_codeable_concept()],
        "subject": {"reference": f"Patient/{patient_id}"},
        "date": date_iso,
        "author": [{"reference": device_ref}],
        "context": {
            "encounter": [{"reference": encounter_ref}],
            "period": {"start": period_start, "end": period_end},
        },
        "content": [
            {
                "attachment": {
                    "contentType": terminology.document_content_type,
                    "url": binary_ref,
                    "title": title,
                }
            }
        ],
    }
    if organization_ref:
        resource["custodian"] = {"reference": organization_ref}
    if relates_to_ref:
        # The note/family summary is derived from the raw conversation;
        # relatesTo(transforms) is what keeps every clinical claim auditable.
        resource["relatesTo"] = [
            {
                "code": terminology.relates_to_transcript_code,
                "target": {"reference": relates_to_ref},
            }
        ]
    return resource


async def write_post_call(
    store: FHIRStore,
    terminology: Terminology,
    *,
    patient_id: str,
    note_text: str,
    transcript_text: str,
    family_summary_text: str | None,
    call_start_iso: str,
    call_end_iso: str,
    device_ref: str,
    organization_ref: str | None,
    escalation_tasks: Iterable[Mapping[str, Any]] = (),
    date_label: str | None = None,
) -> PostCallWriteResult:
    """Perform the contracted write sequence as a single FHIR transaction.

    Order (docs/PLAN.md): Encounter (the anchor) -> Binary+DocumentReference
    for the clinical note -> the pair for the raw transcript -> the pair for
    the family summary (only when generated), all in one transaction Bundle
    -> escalation Tasks, written afterward once the real Encounter id exists.

    Every cross-reference (Binary.securityContext -> its owning
    DocumentReference, DocumentReference.content.attachment.url -> its
    Binary, relatesTo -> the transcript) is a "urn:uuid:..." placeholder that
    Medplum resolves atomically within the transaction. A prior version
    pre-allocated client-assigned ids and wrote each resource with PUT
    ("update-as-create") — hosted Medplum does not support that (verified
    live: PUT-to-create on a brand-new id 404s), so every post-call write was
    silently failing regardless of how the call itself went.
    """
    date_label = date_label or call_end_iso[:10]

    encounter_ref = f"urn:uuid:{uuid.uuid4()}"
    note_binary_ref = f"urn:uuid:{uuid.uuid4()}"
    note_doc_ref = f"urn:uuid:{uuid.uuid4()}"
    transcript_binary_ref = f"urn:uuid:{uuid.uuid4()}"
    transcript_doc_ref = f"urn:uuid:{uuid.uuid4()}"
    family_binary_ref = f"urn:uuid:{uuid.uuid4()}"
    family_doc_ref = f"urn:uuid:{uuid.uuid4()}"

    entries: list[dict[str, Any]] = []

    def add(full_url: str, resource: dict[str, Any]) -> None:
        entries.append(
            {
                "fullUrl": full_url,
                "resource": resource,
                "request": {"method": "POST", "url": resource["resourceType"]},
            }
        )

    add(
        encounter_ref,
        {
            "resourceType": "Encounter",
            "status": "finished",
            "class": terminology.encounter_class.as_fhir(),
            "subject": {"reference": f"Patient/{patient_id}"},
            "period": {"start": call_start_iso, "end": call_end_iso},
            "reasonCode": [terminology.encounter_reason("fourMCheckIn").as_codeable_concept()],
        },
    )

    add(
        note_binary_ref,
        _binary_resource(note_text, terminology.document_content_type, note_doc_ref),
    )
    add(
        note_doc_ref,
        _document_reference(
            terminology=terminology,
            category_key="note",
            patient_id=patient_id,
            encounter_ref=encounter_ref,
            binary_ref=note_binary_ref,
            title=f"Juniper 4M check-in — {date_label}",
            date_iso=call_end_iso,
            period_start=call_start_iso,
            period_end=call_end_iso,
            device_ref=device_ref,
            organization_ref=organization_ref,
            relates_to_ref=transcript_doc_ref,
        ),
    )

    add(
        transcript_binary_ref,
        _binary_resource(transcript_text, terminology.document_content_type, transcript_doc_ref),
    )
    add(
        transcript_doc_ref,
        _document_reference(
            terminology=terminology,
            category_key="transcript",
            patient_id=patient_id,
            encounter_ref=encounter_ref,
            binary_ref=transcript_binary_ref,
            title=f"Juniper conversation transcript — {date_label}",
            date_iso=call_end_iso,
            period_start=call_start_iso,
            period_end=call_end_iso,
            device_ref=device_ref,
            organization_ref=organization_ref,
        ),
    )

    if family_summary_text is not None:
        add(
            family_binary_ref,
            _binary_resource(
                family_summary_text, terminology.document_content_type, family_doc_ref
            ),
        )
        add(
            family_doc_ref,
            _document_reference(
                terminology=terminology,
                category_key="familySummary",
                patient_id=patient_id,
                encounter_ref=encounter_ref,
                binary_ref=family_binary_ref,
                title=f"Juniper family summary — {date_label}",
                date_iso=call_end_iso,
                period_start=call_start_iso,
                period_end=call_end_iso,
                device_ref=device_ref,
                organization_ref=organization_ref,
                relates_to_ref=transcript_doc_ref,
            ),
        )

    response = await store.transaction(
        {"resourceType": "Bundle", "type": "transaction", "entry": entries}
    )

    resolved: dict[str, dict[str, Any]] = {}
    for sent, received in zip(entries, response.get("entry", [])):
        resource = received.get("resource")
        if resource is None:
            raise MedplumError(
                f"transaction entry for {sent['fullUrl']} has no resource in the response"
            )
        resolved[sent["fullUrl"]] = resource

    encounter_id = resolved[encounter_ref]["id"]
    note_doc = resolved[note_doc_ref]
    note_binary = resolved[note_binary_ref]
    transcript_doc = resolved[transcript_doc_ref]
    transcript_binary = resolved[transcript_binary_ref]
    family_doc_id = resolved[family_doc_ref]["id"] if family_summary_text is not None else None
    family_binary_id = (
        resolved[family_binary_ref]["id"] if family_summary_text is not None else None
    )

    task_ids: list[str] = []
    for task in escalation_tasks:
        task = dict(task)
        task["encounter"] = {"reference": f"Encounter/{encounter_id}"}
        created = await store.create(task)
        task_ids.append(created["id"])

    return PostCallWriteResult(
        encounter_id=encounter_id,
        note_id=note_doc["id"],
        note_binary_id=note_binary["id"],
        transcript_id=transcript_doc["id"],
        transcript_binary_id=transcript_binary["id"],
        family_summary_id=family_doc_id,
        family_summary_binary_id=family_binary_id,
        task_ids=tuple(task_ids),
    )
