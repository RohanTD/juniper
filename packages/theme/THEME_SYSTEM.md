# THEME_SYSTEM — the Juniper design system

This is the canonical specification of the theme system ported from Thoracle
(a surgical board-review app) into Juniper. The original `THEME_SYSTEM.md` was
not recoverable; this document reconstructs it faithfully from everything
`docs/PLAN.md` records about it, and then applies the two changes the port
mandates (see **Porting notes** at the end). Where this document and the code
in `src/` disagree, the code's tests are the arbiter — every number below that
matters is asserted in `test/`.

The system's character in one line: **editorial, calm, and typographic** —
serif display type over generous whitespace, cards over tables, mono
micro-labels for metadata, and color used sparingly and only ever for meaning.

---

## 1. Typography — three families, fixed roles

Three font families, and the roles are **fixed**. Mixing them outside their
role is the fastest way to break the system's voice.

| Family | Token | Role — and nothing else |
|---|---|---|
| **Instrument Serif** | `fonts.display` | Display ONLY: hero headlines, the one big statement on a screen. Never body copy, never buttons, never navigation. |
| **Outfit** | `fonts.body.{regular,medium,semibold}` | All body text and all UI chrome: paragraphs, titles, buttons, inputs, tabs. |
| **IBM Plex Mono** | `fonts.mono.{regular,medium}` | Small uppercase labels and metadata only: eyebrows, section labels, timestamps, badges. Always uppercase, always letter-spaced. |

Font family tokens use the `@expo-google-fonts` PostScript-style names
(`InstrumentSerif_400Regular`, `Outfit_500Medium`, `IBMPlexMono_500Medium` …)
so apps can pass them straight to `useFonts` and to RN `fontFamily`.

### Text-style recipes

Every piece of text on screen uses a named recipe — never an ad-hoc
size/weight combination. `lineHeight` is a **multiplier** of `fontSize`
(see Porting notes §3), resolved to px via `resolveTextStyle(token, fontScale)`.

**Base scale** (`baseTextStyles`) — the Thoracle scale as ported:

| Recipe | Family | Size | Line height | Notes |
|---|---|---|---|---|
| `displayXl` | Instrument Serif | 40 | 1.10 | tracking −0.4 |
| `displayLg` | Instrument Serif | 32 | 1.15 | tracking −0.3 |
| `displayMd` | Instrument Serif | 26 | 1.20 | tracking −0.2 |
| `title` | Outfit SemiBold | 20 | 1.30 | |
| `headline` | Outfit SemiBold | 17 | 1.35 | card titles |
| `bodyLg` | Outfit Regular | 17 | 1.50 | |
| `body` | Outfit Regular | 15 | 1.50 | default reading size |
| `bodySm` | Outfit Regular | 13 | 1.45 | card subtitles |
| `button` | Outfit SemiBold | 16 | 1.25 | |
| `label` | IBM Plex Mono Medium | 11 | 1.35 | UPPERCASE, +0.8 tracking — the signature micro-label |
| `eyebrow` | IBM Plex Mono Medium | 12 | 1.35 | UPPERCASE, +1.2 tracking |
| `caption` | Outfit Regular | 12 | 1.40 | |

**Accessible scale** (`accessibleTextStyles`) — see Porting notes §2. Floor
raised: nothing below 13; nothing a patient must *read* below 16.

| Recipe | Size (accessible) | Notes |
|---|---|---|
| `displayXl` / `displayLg` / `displayMd` | 40 / 34 / 28 | line heights loosened slightly |
| `title` / `headline` | 22 / 18 | |
| `bodyLg` / `body` / `bodySm` / `caption` | 19 / 17 / 16 / 16 | reading floor = 16 |
| `button` | 18 | |
| `label` / `eyebrow` | 13 / 14 | mono label floor = 13; **11px mono is banned here** |

---

## 2. Color

### 2.1 Ramp architecture

Every hue is a **10-step ramp**: `50, 100, 200, 300, 400, 500, 600, 700, 800,
900`. `500` is the identity step — the brand color itself. Steps lighten
toward 50 (washes, tinted surfaces) and deepen toward 900. The ramps are
generated in OKLCH with a perceptually even, strictly monotonic lightness
ladder (`src/ramp.ts`); chroma tapers toward both extremes so the 50 step is a
wash rather than a pastel neon, and hue is held constant.

The brand ramp is **duplicated into `accent` as a literal** — the theme's own
note, preserved by the port. Screens reference `accent`, never the brand ramp
by name, so a rebrand is a one-file change. A test pins the `accent` literals
to the generator's output.

**Juniper brand:** `JUNIPER_500 = #2C6E5E`, a deep juniper blue-green — calmer
than Thoracle's persimmon, which suits a health context better than a
board-review app.

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|---|
| juniper / accent | `#EDF6F3` | `#D7E8E3` | `#B1D0C6` | `#85B2A5` | `#599182` | `#2C6E5E` | `#185A4B` | `#07483B` | `#01392E` | `#002C22` |

The original **persimmon** ramp (500 `#E8572A`, 600 pinned to the documented
`#CC4520`) is retained as `ramps.persimmon` for reference and tests only. It
must never appear in Juniper UI.

### 2.2 Neutrals

A single warm-violet grey ramp (`neutral`), with the named text/background
tokens drawn from it:

| Token | Value | Contrast on white |
|---|---|---|
| `text.primary` | `#1A1A1F` (neutral 900) | 17.3:1 |
| `text.secondary` | `#5A5A66` (neutral 600) | 6.8:1 — passes AA everywhere |
| `text.tertiary` | `#9E9EA7` (neutral 400) | 2.7:1 — **base variant only**; decorative metadata at most |
| `text.inverse` | `#FFFFFF` | — |
| `background.primary` | `#FFFFFF` | — |
| `background.secondary` | `#F7F7F9` (neutral 50) | |
| `background.tertiary` | `#EFEFF3` (neutral 100) | |
| `border.subtle / default / strong` | neutral 100 / 200 / 300 | |

### 2.3 Semantic ramps — meaning only, never decoration

Four ramps: `success` (green, 500 `#1F7A4D`), `error` (red, 500 `#C0392B`),
`warning` (amber, 500 `#8A5A00`), `info` (blue, 500 `#2B6CB0`). The rule is
absolute: **semantic color communicates state, never style.** An escalation is
`error`; a completed check-in is `success`; a green button that merely wants
attention is a violation. Each exposes a named set:

- `text` (700 on white), `icon` (600), `bg` (50 tinted surface),
  `fgOnBg` (800 on the 50 surface), `solid` (600 fill), `onSolid` (white).

All of these pairs are AA-audited in the accessible variant's contrast tests.

---

## 3. Spacing, radii, shadows

- **Spacing** — 4pt grid: `none 0 · xxs 2 · xs 4 · sm 8 · md 12 · lg 16 ·
  xl 24 · xxl 32 · xxxl 48`. Screens compose from these; a raw px margin in a
  screen is a defect.
- **Radii** — `sm 8 · md 12 · lg 16 · xl 24 · pill 999`. Cards use `lg`,
  buttons `md`, badges `pill`.
- **Shadows** — three soft elevations (`sm`, `md`, `lg`), low-opacity
  near-black, RN-shaped objects with Android `elevation`. Elevation is
  whisper-quiet; a hard drop shadow is off-voice.

---

## 4. Component recipes

Recipes are token bundles, not components — apps own the (small) components
and read every value from the recipe.

### 4.1 Cards over tables

Data that would be a table row anywhere else is a **card** here:
**icon-in-circle · title · subtitle · chevron**, on `surface.primary`, radius
`lg`, shadow `sm`. The icon circle is a 40px (48px accessible) disc filled
with `accent[100]`, icon in `accent[600]`. Title is `headline` in
`text.primary`; subtitle is `bodySm`; the trailing chevron signals
navigability. The family app's check-in timeline is exactly this pattern.

### 4.2 Label-plus-rule section header

The section header is a mono `label` (uppercase, letter-spaced) with a 1px
hairline rule filling the remaining width — an editorial device that carries
date groupings and list sections without shouting. Label color: `text.tertiary`
in base, `text.secondary` in accessible.

### 4.3 Serif-display-plus-mono-eyebrow — the signature

The system's signature moment: a small uppercase mono `eyebrow` in
`accent[600]` (700 accessible) sitting above an Instrument Serif display line.
**Use it once, on the screen that earns it** — the "how is Mom doing" summary
in the family app — and nowhere else. Repetition kills a signature.

### 4.4 Buttons

- `button.primary`: filled `accent` step with white text — base uses 500;
  the accessible variant uses the **audited** step (see Porting notes §2).
  Radius `md`, one primary action per screen.
- `button.secondary`: transparent fill, 1–1.5px `accent[500]` border,
  `accent[600]` (700 accessible) text.
- Touch targets: 44px minimum (base), **56px minimum (accessible)**.

### 4.5 List rows

Rows inside cards: `minHeight` 48 (56 accessible), vertical padding `md`
(`lg` accessible), internal gap `md`.

---

## 5. Usage rules

1. **Never hardcode a hex or px value in a screen — always a token.** The apps
   enforce this with a lint test that fails on hex literals in app source.
2. Fonts never leave their roles (§1).
3. Semantic color only for meaning (§2.3).
4. One primary action per screen.
5. Patient-facing surfaces use the accessible variant **exclusively** — no
   `text.tertiary`, no 11px mono, no unaudited white-on-accent fills.

---

## 6. Porting notes — the two mandated changes (plus one consequence)

### §1 Generated Juniper brand ramp

Thoracle's step 3 was explicit that swapping only the 500 step leaves the rest
of the ramp persimmon-derived. The port therefore generates **all ten steps**
from the new brand hex `#2C6E5E` with the OKLCH ladder in `src/ramp.ts`
(monotonic lightness asserted in tests; step 500 returns the brand hex
verbatim), and duplicates the result into `accent` as literals per the theme's
own note. Persimmon survives only as `ramps.persimmon` (500 `#E8572A`; 600
pinned to the documented `#CC4520`) for reference and regression tests.

### §2 Accessible variant for patient-facing surfaces

The original theme was designed for young professionals on good screens;
Juniper's onboarding is used by people in their seventies and eighties. The
accessible variant (`accessibleTheme`) makes four changes, all test-enforced:

- **Contrast, recomputed against the actual Juniper ramp.** The persimmon
  numbers did not transfer: white on persimmon 500 was 3.6:1 (fail) and the
  fix was the 600 step at 4.7:1. On the Juniper ramp, **white on 500
  (`#2C6E5E`) measures 6.0:1 and passes AA outright**, so the accessible
  `button.primary` fill stays at 500 — chosen programmatically by
  `firstAccessibleFillStep()`, which scans from 500 downward for the first
  step clearing 4.5:1, so a future rebrand re-derives the fill instead of
  inheriting a stale assumption.
- **`text.tertiary` is removed, not discouraged.** At 2.7:1 it cannot carry
  anything a patient needs to read. The accessible variant's text tokens are
  `primary`, `secondary`, `inverse` — and a test fails if `tertiary` is ever
  reintroduced.
- **Type floor raised.** No 11px mono; labels ≥13, reading text ≥16 (§1).
- **Touch targets 56px minimum**; one primary action per screen.

Every fg/bg pair the variant uses is enumerated by `accessibleContrastPairs()`
and audited at AA (4.5:1 normal, 3:1 large) in `test/contrast.test.ts`.

### §3 Line heights are multipliers (both variants)

The original theme carried fixed numeric line heights, which clip text under
OS font scaling (RN honours Dynamic Type by default). The port expresses
**every** `lineHeight` as a multiplier of `fontSize` — in the base variant
too, since the family app's readers are in their fifties and sixties and OS
font scaling is exactly the setting they use. `resolveTextStyle(token,
fontScale)` produces the concrete px values; tests assert proportional scaling
at 2× and that computed line height always clears the scaled font size.
