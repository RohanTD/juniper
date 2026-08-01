#!/usr/bin/env python
"""Generate family guidance for a patient from the notes already on file.

Guidance is normally written at the end of a call, by ``run_post_call``. That
leaves two situations with no guidance at all and no way to get any:

* **An existing patient.** Someone with a year of check-ins behind them gets
  nothing until their *next* call — the dashboard card sits empty despite the
  evidence being right there.
* **Development and demo.** Seeing the feature at all required placing a real
  call, which is a slow and expensive way to look at a card.

This runs the same generation path as the post-call pass — same consent gate,
same filters, same document — without a call.

Usage (from services/voice, with .env loaded):

    ../../.venv/bin/python scripts/backfill_guidance.py <patient-id> [...]
    ../../.venv/bin/python scripts/backfill_guidance.py --all

``--all`` covers every patient who has at least one Juniper note.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

from juniper_voice.config import Settings
from juniper_voice.context_brain import ContextBrain
from juniper_voice.guidance import GUIDANCE_WINDOW, generate_guidance
from juniper_voice.llm.provider import AnthropicProvider
from juniper_voice.medplum import (
    MedplumClient,
    read_recent_note_texts,
    verify_consent,
    write_family_guidance,
)
from juniper_voice.preferences import PreferencesStore
from juniper_voice.terminology import get_terminology

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill-guidance")


async def patients_with_notes(store: MedplumClient, terminology) -> list[str]:
    """Every patient who has at least one Juniper note."""
    category = terminology.note_category("note")
    documents = await store.search(
        "DocumentReference",
        {"category": f"{category.system}|{category.code}", "_count": "200"},
    )
    seen: list[str] = []
    for document in documents:
        reference = (document.get("subject") or {}).get("reference", "")
        if reference.startswith("Patient/"):
            patient_id = reference.split("/", 1)[1]
            if patient_id not in seen:
                seen.append(patient_id)
    return seen


async def backfill(patient_id: str, *, store, settings, terminology, provider, brain) -> bool:
    consent = await verify_consent(store, patient_id, terminology)
    if not consent.family_sharing:
        # Consent-gated AT GENERATION, exactly as the post-call path is: a
        # document produced and then withheld has still been written down.
        logger.info("  skip  %s — no family-sharing consent", patient_id)
        return False

    notes = await read_recent_note_texts(store, terminology, patient_id, limit=GUIDANCE_WINDOW)
    if not notes:
        logger.info("  skip  %s — no Juniper notes to draw on", patient_id)
        return False

    guidance = await generate_guidance(
        provider,
        findings=notes,
        terminology=terminology,
        model=settings.roster.documentation,
        family_sharing_consent=True,
        interests=brain.interests(patient_id),
    )
    for reason in guidance.rejected:
        # Visible to us, never to the family — a model drifting toward clinical
        # advice should be something we can see happening.
        logger.info("  drop  %s — %s", patient_id, reason)

    await write_family_guidance(
        store,
        terminology,
        patient_id=patient_id,
        guidance_json=json.dumps(guidance.as_dict()),
        date_iso=datetime.now(timezone.utc).isoformat(),
        device_ref=settings.device_ref,
        organization_ref=settings.organization_ref,
    )
    logger.info(
        "  ok    %s — %d suggestion(s) from %d call(s)%s",
        patient_id,
        len(guidance.suggestions),
        guidance.calls_considered,
        f" [{guidance.unavailable_reason}]" if guidance.unavailable_reason else "",
    )
    return True


async def main(argv: list[str]) -> int:
    settings = Settings.from_env()
    if not (settings.medplum_base_url and settings.medplum_client_id):
        logger.error("MEDPLUM_BASE_URL and MEDPLUM_CLIENT_ID are required")
        return 1
    if not settings.anthropic_api_key:
        logger.error("ANTHROPIC_API_KEY is required — guidance is generated, not templated")
        return 1

    terminology = get_terminology()
    store = MedplumClient(
        settings.medplum_base_url,
        settings.medplum_client_id,
        settings.medplum_client_secret or "",
    )
    provider = AnthropicProvider(api_key=settings.anthropic_api_key)
    brain = ContextBrain(
        settings.context_brain_path,
        preferences=PreferencesStore(settings.preferences_path),
    )

    try:
        if "--all" in argv:
            targets = await patients_with_notes(store, terminology)
            logger.info("Found %d patient(s) with Juniper notes", len(targets))
        else:
            targets = [arg for arg in argv if not arg.startswith("-")]
        if not targets:
            logger.error("usage: backfill_guidance.py <patient-id> [...] | --all")
            return 1

        written = 0
        for patient_id in targets:
            try:
                if await backfill(
                    patient_id,
                    store=store,
                    settings=settings,
                    terminology=terminology,
                    provider=provider,
                    brain=brain,
                ):
                    written += 1
            except Exception:  # noqa: BLE001 - one patient must not sink the run
                logger.exception("  FAIL  %s", patient_id)
        logger.info("Wrote guidance for %d of %d patient(s)", written, len(targets))
        return 0
    finally:
        await store.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
