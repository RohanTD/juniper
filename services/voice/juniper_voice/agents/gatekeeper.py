"""The Gatekeeper — identity and consent gate the call, before any
conversational agent engages.

Voicemail, a confused patient, and a family member answering are all common
and get explicit handling paths.  The FHIR Consent gate ran before dialing
(medplum.py); this stage verifies *who answered* and confirms recording
verbally before the Companion proper engages.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

from ..llm.provider import LLMProvider, extract_json

logger = logging.getLogger("juniper.gatekeeper")

TAG = "gatekeeper"

_SYSTEM = """You handle the very first moments of an automated wellbeing call to an elderly patient
named {patient_name}{preferred}. Decide who answered and produce the next thing to say.

Outcomes (choose exactly one):
- "patient_confirmed": the patient themselves answered and seems oriented; your reply should
  greet them by name, remind them this call is recorded, confirm that's okay, and lead into
  the visit.
- "voicemail": an answering machine or voicemail greeting; your reply is a brief, warm
  message saying Juniper called to check in and will try again — leave NO health details.
- "family_member": someone else (spouse, child, aide) answered; your reply should kindly
  ask whether {patient_name} is available to come to the phone.
- "confused": the person seems to be the patient but is confused about who is calling;
  your reply should re-explain gently and simply who you are and why you call.
- "declined": the person asked not to be called or refused recording; your reply should
  apologise warmly and say goodbye — the call must end.

Respond with STRICT JSON only:
{{"outcome": "<one of the above>", "reply": "<the exact words to say>"}}"""


class GatekeeperOutcome(str, Enum):
    PATIENT_CONFIRMED = "patient_confirmed"
    VOICEMAIL = "voicemail"
    FAMILY_MEMBER = "family_member"
    CONFUSED = "confused"
    DECLINED = "declined"


@dataclass(frozen=True)
class GatekeeperResult:
    outcome: GatekeeperOutcome
    reply: str
    end_call: bool


class Gatekeeper:
    def __init__(self, provider: LLMProvider, model: str):
        self._provider = provider
        self._model = model

    async def assess(
        self,
        answered_text: str,
        *,
        patient_name: str,
        preferred_name: str | None = None,
        attempt: int = 1,
        max_attempts: int = 3,
    ) -> GatekeeperResult:
        preferred = f' (goes by "{preferred_name}")' if preferred_name else ""
        try:
            response = await self._provider.complete(
                tag=TAG,
                model=self._model,
                system=_SYSTEM.format(patient_name=patient_name, preferred=preferred),
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Attempt {attempt} of {max_attempts}. "
                            f"The line was answered with: {answered_text!r}"
                        ),
                    }
                ],
                max_tokens=300,
            )
            parsed = extract_json(response.text)
        except Exception:  # noqa: BLE001
            logger.exception("gatekeeper assessment failed")
            parsed = None
        if parsed is None:
            # Deterministic fallback: bail out politely rather than pressing on
            # with someone we haven't identified.
            return GatekeeperResult(
                outcome=GatekeeperOutcome.VOICEMAIL,
                reply=(
                    "Hello, this is June calling from Juniper for a routine check-in. "
                    "We'll try again another time. Take care."
                ),
                end_call=True,
            )
        try:
            outcome = GatekeeperOutcome(str(parsed.get("outcome")))
        except ValueError:
            outcome = GatekeeperOutcome.CONFUSED
        reply = str(parsed.get("reply") or "").strip()
        end_call = outcome in (GatekeeperOutcome.VOICEMAIL, GatekeeperOutcome.DECLINED)
        if outcome is GatekeeperOutcome.CONFUSED and attempt >= max_attempts:
            # Never grind a confused patient through repeated re-explanations.
            end_call = True
            reply = reply or (
                "I'm so sorry for the confusion — I'll let you go now. Take good care."
            )
        return GatekeeperResult(outcome=outcome, reply=reply, end_call=end_call)
