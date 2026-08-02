"""A/B the Companion's persona + advisory wording against the real model.

Naturalness is not testable offline with FakeProvider — the whole suite is
scripted, so it is indifferent to prose. This harness runs the OLD and NEW
prompt wording through the actually-configured model on the same patient
utterances and prints them side by side, so a wording change can be judged
without spending a phone call per iteration.

    PYTHONPATH=. python scripts/ab_persona.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from juniper_voice.agents.advisory import Advisory
from juniper_voice.agents.companion import _PERSONA as NEW_PERSONA
from juniper_voice.config import Settings
from juniper_voice.llm.provider import GroqProvider

OLD_PERSONA = """You are June, the Juniper phone companion — one continuous, warm, unhurried voice on a
recurring check-in call with an elderly patient. You are the only person the patient ever hears.

How you speak:
- Natural spoken language. ONE short utterance per turn (a sentence or three), never a list.
- Warm and specific, like someone who knows them — use what you know from past calls.
- Weave any clinical purpose into the conversation naturally; never interrogate.
- Never patronize. No elder-speak, no collective "we" for their actions, no baby talk.
- Speak plainly about health matters; be direct and calm when something is serious.
- If the patient asks to change when you call or asks you to avoid a topic, use your tools
  to record it, then confirm it back conversationally."""

DIGEST = """Things you know about this patient from past calls:
- Granddaughter Maya started college this year
- Personal goal is to walk to the mailbox and back without the walker
- Proud of her garden"""

BRIEF = """Margaret "Peggy" Alvarez, 80.
Conditions: osteoarthritis (both knees), atrial fibrillation, type 2 diabetes.
Medications: warfarin 5mg daily, lisinopril 10mg, metformin 500mg twice daily.
Recent: 2026-07-08 admission after a fall at home. Upcoming: Dr. Chen 2026-08-07."""

# Old vs new advisory wording for the same underlying intent.
OLD_ADVISORY = (
    "REQUIRED INTENT (must be acted on this turn): cover the 'medication' domain now."
    " Hook: she mentioned her pharmacy changed."
)
NEW_ADVISORY = Advisory(
    domain="medication", priority="high", hook="she mentioned her pharmacy changed",
    display="Medication",
).escalated().as_prompt_line()

# Drawn from the adversarial fixtures: a chatty patient dodging medication, a
# patient deflecting on mobility, a "fine to everything" patient, and one
# mentioning something clinically real in passing.
CASES = [
    ("chatty, avoids the topic",
     "PATIENT: Oh Maya called on Sunday, she's loving her classes.\nCOMPANION: That's lovely.\nPATIENT: She's made so many friends already, I'm just so proud of her."),
    ("deflecting on mobility",
     "COMPANION: How has getting around been?\nPATIENT: Oh, you know. Same as always really."),
    ("fine to everything",
     "COMPANION: How have you been feeling this week?\nPATIENT: Fine, fine. Everything's fine."),
    ("mentions something in passing",
     "PATIENT: The garden's doing well. I did get a bit dizzy standing up yesterday but it passed."),
]


async def run(provider, model, persona, advisory, window):
    system = "\n\n".join([
        persona,
        "What you remember about this patient:\n" + DIGEST,
        "Their clinical picture (from the chart):\n" + BRIEF,
    ])
    r = await provider.complete(
        tag="ab", model=model, system=system,
        messages=[{"role": "user", "content": (
            f"Recent conversation:\n{window}\n\n"
            f"Turn instruction (from the care system, not the patient):\n{advisory}\n\n"
            "Reply with the exact words you will say next — nothing else.")}],
        max_tokens=400,
    )
    return " ".join(r.text.strip().split())


async def main():
    s = Settings.from_env()
    # Model override: this harness compares PROMPT WORDING, so any capable
    # model gives a valid signal. Useful when the primary provider's quota is
    # spent — the comparison is between the two prompts, not two providers.
    model = sys.argv[1] if len(sys.argv) > 1 else s.roster.companion
    if model.startswith("claude-"):
        from juniper_voice.llm.provider import AnthropicProvider
        provider = AnthropicProvider(api_key=s.anthropic_api_key)
    else:
        provider = GroqProvider(api_key=s.groq_api_key)
    print(f"model: {model}\n")
    print(f"OLD advisory: {OLD_ADVISORY}\n")
    print(f"NEW advisory: {NEW_ADVISORY}\n")
    print("=" * 78)
    for label, window in CASES:
        old = await run(provider, model, OLD_PERSONA, OLD_ADVISORY, window)
        new = await run(provider, model, NEW_PERSONA, NEW_ADVISORY, window)
        print(f"\n### {label}")
        print(f"  patient: {window.splitlines()[-1]}")
        print(f"\n  OLD: {old}")
        print(f"\n  NEW: {new}")
        print("-" * 78)

asyncio.run(main())
