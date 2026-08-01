"""The Gatekeeper — identity and consent gate the call, before any
conversational agent engages.

Voicemail, a confused patient, and a family member answering are all common
and get explicit handling paths.  The FHIR Consent gate ran before dialing
(medplum.py); this stage verifies *who answered* and confirms recording
verbally before the Companion proper engages.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum

from ..llm.provider import LLMProvider, extract_json

logger = logging.getLogger("juniper.gatekeeper")

TAG = "gatekeeper"

# ---------------------------------------------------------------------------
# Scripted opening (latency work, 2026-08-01)
#
# The measured cost of an LLM-composed opening was 2s (Sonnet gatekeeper
# assess) + 0.6-3.7s (compassion, worse when the rewrite loop fired) before
# the patient heard ANYTHING after saying hello. The fix is the plan's own
# philosophy applied to the call opening: control in code. The greeting is
# spoken by Deepgram's `agent.greeting` at connect (zero LLM), and a clear
# "yes, this is her" fast-paths to a scripted line. Only ambiguous answers
# (family member, confusion, refusal) pay for the LLM assessment.
#
# These strings are pre-vetted constants — they bypass the compassion filter
# deliberately. The filter exists to catch model-generated drift; a constant
# reviewed at code-review time cannot drift. Urgency is NEVER bypassed: the
# classifier still runs on every patient utterance, scripted turn or not.
# ---------------------------------------------------------------------------

GREETING_TEMPLATE = "Hi, this is Juniper checking in. Is this {name}?"
GREETING_NO_NAME = "Hi, this is Juniper calling for a routine check-in. Who am I speaking with?"
CONFIRMED_REPLY = (
    "Great! Just so you know, this call is recorded. Do you have a few minutes to chat?"
)

_FILLERS = frozenset({"uh", "um", "oh", "well", "hi", "hello", "hey", "why"})
_YES_SINGLE = frozenset({"yes", "yeah", "yep", "yup", "speaking", "correct", "indeed"})
_YES_PHRASES = frozenset(
    {
        "yes it is",
        "it is",
        "yes i am",
        "i am",
        "this is she",
        "this is her",
        "this is he",
        "this is him",
        "thats me",
        "yes speaking",
        "yes this is she",
        "yes this is he",
        "yes maam",
        "yes sir",
    }
)


def scripted_greeting(patient_name: str, preferred_name: str | None) -> str:
    name = (preferred_name or patient_name or "").strip()
    if not name:
        return GREETING_NO_NAME
    # Preferred name is the whole point of collecting it; legal first name
    # is the fallback.
    first = name.split()[0]
    return GREETING_TEMPLATE.format(name=first)


def is_clear_identity_yes(text: str) -> bool:
    """Deliberately conservative: only unambiguous confirmations fast-path.
    'yes but my chest hurts' has more words than any phrase here and falls
    through to the LLM (and urgency runs regardless, on every utterance)."""
    words = re.sub(r"[^a-z' ]", " ", text.lower()).split()
    while words and words[0] in _FILLERS:
        words = words[1:]
    if not words:
        return False
    normalized = " ".join(words).replace("'", "")
    if len(words) == 1:
        return words[0] in _YES_SINGLE
    return normalized in _YES_PHRASES

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
