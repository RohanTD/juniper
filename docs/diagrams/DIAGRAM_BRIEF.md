# Diagram brief: how Juniper works

Hand this to whoever (or whatever) is drawing the diagram. It describes the
system in the terms the picture should use, not the terms the code uses.

---

## Audience and purpose

One slide, for people with **no clinical and no technical background** — a
board, a pilot clinic, a family open evening. They should leave able to say:
*"It phones her regularly, writes down what it learns where her doctors already
work, and the family sees a friendly version — never the recording."*

Landscape, 16:9.

---

## The one-sentence claim

Juniper phones an older adult on a schedule, has a real conversation, and turns
it into two different documents: a clinical one for her care team, and a warm
one for her family.

---

## Boxes

Seven, in four groups. Labels are the exact words to print; descriptions are
one supporting line each.

### Group 1 — Before anything else (once)

| Label | Supporting line |
|---|---|
| **Setup on a phone** | Best times to call, what she enjoys, what to avoid, and her permission for all of it. |

Tagged **"ONCE, AT THE START"**. This is the only time anyone touches an app on
her behalf; after this she just answers her phone.

### Group 2 — The call (recurring, and the visual centre)

| Label | Supporting line |
|---|---|
| **Juniper calls** | One familiar voice, every time. It already knows her name, her roses and her grandchildren. |
| **Margaret, 80** | Answers her own phone. No app to learn. |

Tagged **"EVERY FEW DAYS"**. This box should be the most visually prominent
thing on the slide — largest, filled with the brand colour, everything else
white. It is what the product *is*.

Inside or beneath "Juniper calls", list the four things it listens for, under a
label like **"WHILE THEY TALK, IT LISTENS FOR"**:

- What matters to her
- How she is managing medication
- Mood and memory
- Getting about safely

(These are the 4Ms of age-friendly care, in plain English. **Do not print the
words "the 4Ms", "What Matters", "Mentation" or "Mobility"** — this audience
does not know them and the plain versions carry the meaning.)

### Group 3 — Where it goes

| Label | Supporting line |
|---|---|
| **Her medical record** | Everything written down in the same place her doctors already work. |

Tagged **"THE SINGLE SOURCE OF TRUTH"**. The point being made is that Juniper
does not create a separate silo.

### Group 4 — Who sees what (the payoff)

| Label | Supporting line | Callout |
|---|---|---|
| **The care team** | A clinical note, in their language, with the detail they need. | **Anything urgent** reaches them straight away. |
| **Her family** | A short, plain-language summary — plus ideas for what they could do. | *"Take her to the roses"* — never medical advice. |
| **Family dashboard** | How she's doing, when the next call is, and anything that needs them. | tagged **"ANY TIME"** |

Put a label above this group: **"AFTER EVERY CALL, TWO DIFFERENT THINGS ARE
WRITTEN"**. The two-audiences split is the single most important idea on the
slide — same conversation, deliberately different documents. If the layout can
only emphasise one thing after the call box, emphasise this.

Use a warm/amber tint for the urgent callout and a green tint for the family
one. Not red: nothing here is an emergency, and the urgent path is a feature
working correctly.

---

## Arrows

Left to right as the spine, with two drops at the end:

```
Setup on a phone  →  Juniper calls  →  Her medical record  →  Family dashboard
                          ↕                    ↓                     ↓
                    Margaret, 80         The care team          Her family
```

- `Setup → Juniper calls` — the answers shape every call that follows.
- `Juniper calls ↔ Margaret` — **double-headed.** It is a conversation, not a
  broadcast, and a one-way arrow quietly says the wrong thing.
- `Juniper calls → Her medical record` — written after the call ends.
- `Her medical record → The care team` and `→ Her family` (via the dashboard) —
  the two outputs.

---

## The footer — required, not decoration

Print this, or something with the same content:

> **Her call, her rules.** Nothing happens without her permission, and she can
> change her mind on any call.
> Her family never sees the recording or the clinical note — only the summary
> written for them.

*"Does the family get to hear the recording?"* is the first question this
audience asks about an app that listens to their mother's phone calls.
Answering it before it is asked is worth more than another box.

---

## Do not include

- **FHIR, Medplum, access policies, LLMs, agents, Twilio, Deepgram.** None of it
  helps this audience and all of it invites the wrong questions.
- **"AI"** doing load-bearing work. "A friendly automated companion" or just
  "Juniper" is enough. The claim is about what happens to a person.
- **Charts, trends or numbers.** The product deliberately shows counts and dates
  rather than graphs, and a mocked-up trend line on a slide promises something
  that does not exist.
- **A transcript or recording icon anywhere near the family side.** It
  contradicts the footer.

---

## Tone and style

- Brand colour **`#2C6E5E`** (deep juniper green). Supporting tints:
  `#85B2A5`, `#EDF6F3`. Neutrals: `#111114` text, `#5A5A66` secondary,
  `#FAFAFA` background, `#EBEBED` hairlines.
- Rounded cards, generous whitespace, soft shadows. Calm rather than clinical —
  this is a product about someone's mother, not a systems diagram.
- Sentence case for headings. No exclamation marks. No stock imagery of smiling
  seniors.
- Use **Margaret ("Peggy"), 80** as the running example so the slide matches
  whatever gets demoed afterwards.

---

## If a technical version is wanted instead

Same shape, but the boxes become: onboarding app (Expo, one-time) → voice
service (Twilio media stream + Deepgram voice agent with a bring-your-own-LLM
Companion, plus slow-loop 4M/closer advisors and urgency/compassion filters) →
Medplum FHIR server (Encounter, DocumentReference + Binary per document,
escalation Task) → family web dashboard (read-only apart from call settings)
and clinician EHR view. Add that the family's access is derived from CareTeam
membership and enforced by an AccessPolicy, and that the family summary and
guidance are generated only when consent permits — never generated and then
hidden.
