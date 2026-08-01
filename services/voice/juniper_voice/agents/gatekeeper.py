"""The Gatekeeper — identity and consent gate the call, before any
conversational agent engages.

Voicemail, a confused patient, and a family member answering are all common
and get explicit handling paths.  The FHIR Consent gate ran before dialing
(medplum.py) and already requires the call-recording provision, so this stage
verifies *who answered* and nothing more — it no longer re-confirms recording
verbally, which was redundant with the consent captured at onboarding and made
the opening exchange read like a form.

NOTE for deployment: some two-party-consent jurisdictions require a spoken
recording notice on the call itself, which written consent does not satisfy.
Confirm before real patients; restore a notice here if required.
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

# Left by TwiML <Say> when Twilio's answering-machine detection says a machine
# picked up. No LLM, no Deepgram agent session, no transcript — the previous
# behaviour was to let the Companion converse with the voicemail menu, which
# cost three gatekeeper calls plus a full Opus documentation pass per missed
# call. Deliberately contains NO health details: a voicemail can be heard by
# anyone in the household.
VOICEMAIL_MESSAGE = (
    "Hello, it's June from Juniper calling for your check-in. "
    "Sorry I missed you. I'll try again soon. Take care."
)

GREETING_TEMPLATE = "Hi {name}, it's June from Juniper. How are you doing today?"
GREETING_NO_NAME = "Hello, it's June from Juniper calling for a check-in. Who am I speaking with?"
CONFIRMED_REPLY = "Is this a good time to check in on how you're doing?"

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

# The greeting asks "How are you doing today?", so the reply that proves a
# cooperative patient is on the line is a WELLBEING answer, not a confirmation
# of identity. Keeping only the identity matchers after the greeting changed
# meant the natural answer — "I'm doing good, how are you?" — never matched,
# and every single call was routed through the gatekeeper LLM instead.
_WELLBEING = frozenset(
    {
        "good", "fine", "well", "great", "okay", "ok", "alright", "right",
        "decent", "wonderful", "lovely", "grand", "tired", "so", "bad",
        "hanging", "surviving", "managing", "better",
    }
)
# Anything suggesting we have NOT reached an oriented patient. Conservative on
# purpose: these route to the LLM, which is exactly what it is for.
_NOT_THE_PATIENT = (
    "who is this", "who's this", "whos this", "who am i speaking",
    "wrong number", "not here", "isn't here", "isnt here", "he's not",
    "she's not", "take a message", "leave a message", "after the tone",
    "after the beep", "not available", "unavailable", "hold on", "hang on",
    "stop calling", "don't call", "dont call", "remove me", "not interested",
    "say that again", "pardon", "come again", "speak up", "can't hear",
    "cant hear", "what was that", "this is a recording",
)
_MAX_FAST_PATH_WORDS = 12


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


def is_cooperative_answer(text: str) -> bool:
    """Does this answer to the greeting show an oriented patient on the line?

    This must stay paired with GREETING_TEMPLATE: it recognises answers to the
    question the greeting actually asks. A hit skips the gatekeeper LLM, which
    is both the slowest component of the opening and — as observed live — the
    one most prone to improvising an identity-and-consent monologue nobody
    asked for. Urgency still classifies the utterance either way, so a "not
    great, my chest hurts" that lands here is never missed.
    """
    if is_clear_identity_yes(text):
        return True
    lowered = " ".join(text.lower().split())
    if any(marker in lowered for marker in _NOT_THE_PATIENT):
        return False
    words = re.sub(r"[^a-z' ]", " ", lowered).split()
    while words and words[0] in _FILLERS:
        words = words[1:]
    # A long reply carries more than an answer to "how are you" — let the LLM
    # read it. Short and cooperative is the only thing that fast-paths.
    if not words or len(words) > _MAX_FAST_PATH_WORDS:
        return False
    return any(word in _WELLBEING for word in words)

_SYSTEM = """You are June, a phone companion calling from Juniper. Your name is June; Juniper is
the service you call on behalf of. Never introduce yourself as "Juniper".

You handle the very first moments of a wellbeing call to an elderly patient named
{patient_name}{preferred}. You have ALREADY said: "Hi, it's June from Juniper. How are you
doing today?" — so do not greet them a second time. Decide who answered and produce the
next thing to say.

Your reply is one or two short spoken sentences. Never mention recording, quality, training,
or monitoring: consent was captured at onboarding and raising it here reads as a script.
Never ask them to verify their identity like a call centre.

Outcomes (choose exactly one):
- "patient_confirmed": the patient themselves answered and seems oriented; your reply should
  respond briefly to what they just said and ask whether now is a good time to talk. Nothing
  else — do not open a health topic yet.
- "voicemail": an answering machine or voicemail greeting; your reply is a brief, warm
  message saying June from Juniper called to check in and will try again — leave NO health
  details.
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
