# Thoracle Theme System — Portable Spec

> **Provenance.** Everything above the "Juniper porting notes" section is the original
> Thoracle spec, verbatim. Juniper's deviations from it are enumerated at the bottom and
> nowhere else — if this file and `src/` disagree, that is a bug in `src/`.

A design system for React Native (Expo) apps. "Modern editorial": clean white
base, serif/sans display contrast, one bold accent color, mono for
labels/metadata. Originally built for Thoracle (a CT surgery board-review
app); nothing below is medical-specific — apply it to any app.

This doc contains everything another agent needs to reproduce the system in
a new codebase: exact values, font setup, and usage conventions. Copy the
token tables into a new `src/theme/index.ts`, install the three font
packages, and load fonts in `App.tsx` before rendering.

---

## 1. Fonts

Three families, three jobs. Never mix their roles.

| Family | Package | Job |
|---|---|---|
| **Instrument Serif** | `@expo-google-fonts/instrument-serif` | Display/hero text only — big headlines, welcome screens, empty-state titles. Never body copy. |
| **Outfit** | `@expo-google-fonts/outfit` | All body copy, buttons, form labels, UI text. Geometric sans, modern and readable. |
| **IBM Plex Mono** | `@expo-google-fonts/ibm-plex-mono` | Small metadata: section labels, timestamps, stat captions, uppercase tracked labels. Never body paragraphs. |

Install:
```bash
npx expo install @expo-google-fonts/instrument-serif @expo-google-fonts/outfit @expo-google-fonts/ibm-plex-mono expo-font expo-splash-screen
```

Load in `App.tsx` before the app renders (keep splash screen up until fonts resolve):
```tsx
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_400Regular_Italic,
} from '@expo-google-fonts/ibm-plex-mono';

SplashScreen.preventAutoHideAsync();

// inside App component, before render:
await Font.loadAsync({
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_400Italic: IBMPlexMono_400Regular_Italic, // note the key rename
});
```

Font family name map used everywhere in styles (this is the `typography.fonts` object):
```ts
fonts: {
  regular:  'Outfit_400Regular',
  medium:   'Outfit_500Medium',
  semiBold: 'Outfit_600SemiBold',
  bold:     'Outfit_700Bold',

  display:       'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',

  mono:       'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoItalic: 'IBMPlexMono_400Italic',

  italic: 'InstrumentSerif_400Regular_Italic', // Outfit has no italic; fall back to serif italic
}
```

---

## 2. Color palette

One accent color drives the whole app. In Thoracle it's **persimmon**
(`#E8572A`) — a warm, confident orange-red. **When porting to a new app,
swap only the `primary` (and `accent`, which mirrors it) ramp to the new
app's brand color, keep everything else as-is.** The rest of the palette
(neutrals, semantic success/warning/error) is intentionally generic and
should not change.

Every color is a 10-step ramp (50 → 900, light → dark), Tailwind-style.

```ts
export const colors = {
  // Primary — swap this ramp for a new brand color; keep the ramp shape
  primary: {
    50:  '#FFF5F0',
    100: '#FFE4D6',
    200: '#FFCBB2',
    300: '#FFA682',
    400: '#F07843',
    500: '#E8572A', // <- the actual brand color; everything else is derived light/dark steps
    600: '#CC4520',
    700: '#A83618',
    800: '#862B14',
    900: '#5C1D0E',
  },

  // Secondary — slate blue, used sparingly for secondary UI accents
  secondary: {
    50:  '#F0F4FF', 100: '#D9E2FC', 200: '#B3C5F7', 300: '#8DA6ED', 400: '#6684DC',
    500: '#4361C2', 600: '#354FA0', 700: '#293D7D', 800: '#1D2C5A', 900: '#111B38',
  },

  // Accent — identical to primary in this system (single-accent design).
  // Keep it as a literal duplicate of `primary`, not an alias, so a future
  // two-accent redesign can diverge them without touching call sites.
  accent: {
    50:  '#FFF5F0', 100: '#FFE4D6', 200: '#FFCBB2', 300: '#FFA682', 400: '#F07843',
    500: '#E8572A', 600: '#CC4520', 700: '#A83618', 800: '#862B14', 900: '#5C1D0E',
  },

  success: {
    50:  '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#34D399',
    500: '#10B981', 600: '#059669', 700: '#047857', 800: '#065F46', 900: '#064E3B',
  },
  warning: {
    50:  '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#FBBF24',
    500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E', 900: '#78350F',
  },
  error: {
    50:  '#FEF2F2', 100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171',
    500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B', 900: '#7F1D1D',
  },

  // Neutrals — cool-warm gray (deliberately neither blue-gray nor yellow-gray)
  neutral: {
    0:   '#FFFFFF', 50:  '#FAFAFA', 100: '#F5F5F6', 200: '#EBEBED', 300: '#DCDCE0',
    400: '#B0B0B8', 500: '#7E7E8A', 600: '#5A5A66', 700: '#3D3D47', 800: '#27272D', 900: '#111114',
  },

  background: {
    primary:   '#FFFFFF',
    secondary: '#FAFAFA',
    tertiary:  '#F5F5F6',
    dark:      '#111114',
  },

  text: {
    primary:   '#111114',
    secondary: '#5A5A66',
    tertiary:  '#9E9EA7',
    inverse:   '#FFFFFF',
    accent:    '#E8572A', // = primary[500]
  },

  rule:    '#EBEBED', // hairline dividers — the ONLY divider color used app-wide
  ink:     '#111114', // = text.primary; used as a semantic name for "near-black"
  inkSoft: '#5A5A66', // = text.secondary
};
```

**Rules for using color:**
- Never hardcode a hex value in a screen/component. Always reference a token (`colors.primary[500]`, not `'#E8572A'`).
- `colors.rule` is the *only* divider/border color used for hairlines throughout the app — don't introduce a second gray for borders.
- `colors.ink` is used instead of `colors.text.primary` in a lot of places for near-black text/icons — they're the same value; either is acceptable, but be consistent within a file.
- Status colors (success/warning/error) map to meaning, not decoration: green = correct/good, amber = medium/caution, red = wrong/critical. Don't use them for arbitrary accents.

---

## 3. Typography scale

```ts
sizes: {
  xs: 11, sm: 13, base: 15, md: 16, lg: 18, xl: 20,
  '2xl': 24, '3xl': 30, '4xl': 38, '5xl': 48, '6xl': 64,
},

lineHeights: {
  tight: 1.15, snug: 1.3, normal: 1.5, relaxed: 1.7,
},

letterSpacing: {
  tighter: -0.8, tight: -0.4, normal: 0, wide: 0.6, wider: 1.4, widest: 2.4,
},
```

### Pre-built text style recipes (compose fontFamily + size + lineHeight + letterSpacing + color)

| Style | Font | Size | Use for |
|---|---|---|---|
| `displayLarge` | `display` (serif) | 6xl (64) | Hero/splash headlines |
| `display` | `display` (serif) | 5xl (48) | Page-level display headings |
| `displayItalic` | `displayItalic` | 4xl (38) | Editorial pull-quotes |
| `h1` | `bold` (Outfit) | 3xl (30) | Screen titles |
| `h2` | `bold` | 2xl (24) | Section headers |
| `h3` | `semiBold` | xl (20) | Card/subsection titles |
| `h4` | `semiBold` | lg (18) | Minor headings |
| `bodyLarge` | `regular` | lg (18) | Lead paragraphs |
| `body` | `regular` | base (15) | Default body text |
| `bodySmall` | `regular` | sm (13) | Secondary/dense text |
| `label` | `monoMedium`, uppercase, `widest` tracking | xs (11) | ALL-CAPS section labels (e.g. "PRACTICE", "REFERENCE") |
| `meta` | `mono` | xs (11) | Timestamps, counts, fine print |
| `caption` | `regular` | xs (11) | Image captions, helper text |
| `button` | `semiBold`, `wide` tracking | base (15) | Button labels |

**Signature pattern — the serif/mono contrast:** a big serif display headline paired with a small uppercase mono label is the app's recurring visual signature (e.g. hero title in Instrument Serif + a tracked mono eyebrow label above or below it). Reuse this pairing for any "big moment" screen (welcome, empty states, score reveals).

---

## 4. Spacing

8-point-ish scale, slightly irregular at the edges for visual rhythm:

```ts
spacing: {
  none: 0, xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24,
  '2xl': 32, '3xl': 40, '4xl': 48, '5xl': 64,
}
```
Use `spacing.base` (16) as the default screen-edge padding and card padding. Use `spacing.lg`/`spacing.xl` for section gaps.

---

## 5. Border radius

```ts
borderRadius: {
  none: 0, sm: 4, base: 6, md: 10, lg: 14, xl: 18, '2xl': 24, full: 9999,
}
```
Cards and buttons typically use `md` (10) or `lg` (14). Pills/badges/avatars use `full`.

---

## 6. Shadows

Subtle, soft, low-opacity — never harsh drop shadows. React Native shadow props (iOS) + `elevation` (Android):

```ts
shadows: {
  none: { shadowColor: 'transparent', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm:   { shadowColor: '#000', shadowOffset: { width: 0, height: 1 },  shadowOpacity: 0.04, shadowRadius: 3,  elevation: 1 },
  base: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.06, shadowRadius: 6,  elevation: 2 },
  md:   { shadowColor: '#000', shadowOffset: { width: 0, height: 4 },  shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  lg:   { shadowColor: '#000', shadowOffset: { width: 0, height: 8 },  shadowOpacity: 0.1,  shadowRadius: 20, elevation: 8 },
  xl:   { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 12 },
  // Colored shadow variants for primary-colored elements (e.g. a floating CTA button)
  primary: { shadowColor: '#E8572A' /* = primary[500] */, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 },
  accent:  { shadowColor: '#E8572A' /* = accent[500] */,  shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 },
}
```
Default card elevation is `shadows.sm` or `shadows.base`. Reserve `lg`/`xl` for modals and floating elements.

---

## 7. Component recipes

Pre-composed style objects — spread these into a component's style, then override as needed.

```ts
components: {
  card: {
    base:     { backgroundColor: colors.background.primary, borderRadius: borderRadius.lg, padding: spacing.base, borderWidth: 1, borderColor: colors.rule },
    elevated: { backgroundColor: colors.background.primary, borderRadius: borderRadius.lg, padding: spacing.base, ...shadows.base },
    outlined: { backgroundColor: 'transparent', borderRadius: borderRadius.lg, padding: spacing.base, borderWidth: 1, borderColor: colors.rule },
    ink:      { backgroundColor: colors.ink, borderRadius: borderRadius.lg, padding: spacing.base }, // dark/inverse card
  },
  button: {
    primary:   { backgroundColor: colors.primary[500], borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, ...shadows.primary },
    secondary: { backgroundColor: colors.ink,           borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
    accent:    { backgroundColor: colors.accent[500],  borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, ...shadows.accent },
    outline:   { backgroundColor: 'transparent', borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1.5, borderColor: colors.rule },
    ghost:     { backgroundColor: 'transparent', borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  },
  input: {
    base:    { backgroundColor: colors.background.secondary, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.rule, paddingVertical: spacing.md, paddingHorizontal: spacing.base, fontSize: typography.sizes.base, fontFamily: typography.fonts.regular, color: colors.text.primary },
    focused: { borderColor: colors.primary[500], borderWidth: 1.5 },
  },
  badge: {
    success: { backgroundColor: colors.success[50], paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
    warning: { backgroundColor: colors.warning[50], paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
    error:   { backgroundColor: colors.error[50],   paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
    info:    { backgroundColor: colors.secondary[50], paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
  },
}
```

---

## 8. Layout & animation constants

```ts
layout: {
  containerPadding: spacing.lg, // 20
  headerHeight: 60,
  bottomTabHeight: 80,
  maxContentWidth: 600,
}

animation: {
  fast: 150, normal: 260, slow: 420, slower: 640,
  spring: { damping: 16, stiffness: 180 },
}
```

---

## 9. Recurring UI patterns observed in the source app

These aren't theme *tokens* but conventions worth carrying over — they're what makes screens feel consistent:

- **Section headers**: an uppercase mono `label`-style heading (e.g. "PRACTICE") followed by a thin `colors.rule` horizontal line filling the remaining width — a "label + rule" header, not a bordered box.
- **Icon-in-circle**: small icons are wrapped in a colored circle (`background: primary[50]` or a semantic color's `50` step, icon colored at `500`) rather than shown bare. Common sizes: 22–44px depending on context (list row vs. hero).
- **Cards over tables**: list data (categories, sessions, users) renders as bordered/shadowed rows or cards with an icon-circle + title/subtitle + trailing chevron — not raw tables.
- **Tri-state checkboxes**: for hierarchical selection UIs (e.g. group → category → item), use a checkbox that supports empty / filled / partial (dash) states, filled = `primary[500]` background, partial = `primary[50]` bg + `primary[400]` border + a small dash glyph.
- **Fade-and-slide-in entrance**: screen content animates in with staggered opacity + translateY (16–24px) on mount, ~400–700ms, `Easing.out(Easing.cubic)`. Used on hero/welcome screens and list items for a polished first-paint.
- **Empty states**: large muted icon (`neutral[300]`, 48–64px) + `h3`/semibold title + `bodySmall`/tertiary description + a primary button CTA, centered.
- **Deprecation note**: the source app uses React Native's built-in `SafeAreaView` in places (flagged deprecated by React Native); prefer `react-native-safe-area-context`'s `SafeAreaView` in a new build.

---

## 10. Quick-start for a new app

1. `npx expo install @expo-google-fonts/instrument-serif @expo-google-fonts/outfit @expo-google-fonts/ibm-plex-mono expo-font expo-splash-screen`
2. Create `src/theme/index.ts`, paste sections 2–8 above verbatim (colors, typography, textStyles, spacing, borderRadius, shadows, components, layout, animation), export a combined `theme` default object.
3. **Pick the new app's brand color** and replace only the `primary`/`accent` 10-step ramps (keep the same light→dark ramp *shape*, i.e. don't just swap the 500 step and leave the others persimmon-derived — generate a full new ramp, e.g. via a color-scale tool, from the new brand hex).
4. Wire font loading into the new app's root component exactly as in section 1, gated behind `expo-splash-screen`.
5. Import `{ colors, typography, spacing, borderRadius, shadows }` from the theme module in every screen — never hardcode hex/px values inline.

---
---

# Juniper porting notes

Everything above is Thoracle's spec as written. This section is the complete list of
Juniper's deviations from it. Nothing else changes: the neutrals, the semantic ramps, the
`secondary` slate blue, the spacing / radius / shadow scales, the text-style recipes, the
component recipes and the layout / animation constants are all ported as-is.

## 1. Brand ramp → juniper (step 3 of the Quick-start)

`primary` and `accent` are replaced with a full ten-step ramp generated from the Juniper
brand hex **`#2C6E5E`** — a deep juniper blue-green, calmer than persimmon and better
suited to a health context. Per the spec's explicit warning, all ten steps are generated
from the new hex rather than swapping only the 500 step; per the spec's note on `accent`,
the ramp is duplicated into `accent` as literals rather than aliased.

`shadows.primary` and `shadows.accent` take the new brand hex as their `shadowColor`.

The original persimmon ramp is retained as `ramps.persimmon` for reference and for the
contrast tests — never for Juniper UI.

## 2. An accessible variant for patient-facing surfaces

The spec was written for a board-review app used by young professionals on good screens.
Juniper's onboarding app is used by people in their seventies and eighties. `apps/family`
uses the base theme unchanged (its readers are adult children); `apps/onboarding` uses an
**accessible variant** differing in exactly three ways:

**a. `text.tertiary` is removed entirely.** At `#9E9EA7` it measures ~2.7:1 on white — far
below AA. It does not exist on the accessible variant, and a test fails the build if anyone
reintroduces it. `text.secondary` (`#5A5A66`, ~6.8:1) is the lightest text available.

**b. The button fill is computed, not assumed.** Persimmon 500 (`#E8572A`) measures ~3.6:1
against white and fails AA for normal text — hence Thoracle's 600-step note. That number is
hue-specific and does **not** transfer: juniper 500 (`#2C6E5E`) measures **6.00:1** on white
and passes comfortably. The accessible variant therefore computes the first ramp step that
actually clears 4.5:1 rather than hardcoding 600, which for juniper resolves to **500**. If
the brand hex changes, the fill follows it and the contrast test keeps it honest.

**c. The type-scale floor is raised.** `xs: 11` uppercase mono is a stylish label and an
unreadable one at 78. On the accessible variant no text sits below 13px, nothing a patient
must read sits below 16px, and touch targets grow from 44px to 56px.

## 3. Line heights are multipliers (a clarification, not a change)

The Juniper plan anticipated that fixed numeric line heights would clip under OS font
scaling. In this spec they are **already** ratios (`tight: 1.15` … `relaxed: 1.7`), so no
correction was needed — the concern did not apply. `resolveTextStyle(token, fontScale)`
multiplies the *scaled* font size by the ratio so the property holds end to end, and a test
asserts it at 2× scale.

## 4. Specified but not yet used

`components.input.focused`, the tri-state checkbox and the fade-and-slide-in entrance are
specified above but unused so far — no Juniper screen needs them yet. They stay in the spec
rather than being deleted so a future screen can adopt them without re-deriving values.
