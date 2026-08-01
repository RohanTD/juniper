/**
 * The two theme variants.
 *
 *  - `baseTheme` — THEME_SYSTEM.md sections 2–8 as ported, with only the
 *    brand-ramp deviation (porting note 1). Editorial, compact, designed for
 *    adult readers on good screens. Used by apps/family.
 *  - `accessibleTheme` — the patient-facing variant (porting note 2), which
 *    differs in exactly three ways: `text.tertiary` REMOVED (not merely
 *    discouraged), a computed AA-passing button fill, a raised type floor and
 *    larger touch targets. Used exclusively by apps/onboarding.
 *
 * Everything below the token layer — `semantic`, `recipes`, `touchTarget` — is
 * the port's own app-facing scaffolding, composed strictly out of the spec's
 * tokens. It adds no new values; where the spec names a convention (section 9's
 * label-plus-rule header, icon-in-circle, cards-over-tables) these recipes are
 * how the two apps consume it.
 *
 * `accessibleContrastPairs()` enumerates every foreground/background pair the
 * accessible variant actually uses, and is consumed by the contrast audit test
 * and available to CI.
 */
import { contrastRatio } from './color';
import {
  accessiblePalette,
  colors,
  type AccessibleTextColors,
  type PaletteColors,
  type TextColors,
} from './colors';
import { accessibleComponents, components, type Components } from './components';
import type { ColorRamp, RampStep } from './ramp';
import { juniper, ramps } from './ramps';
import {
  accessibleTouchTarget,
  animation,
  baseTouchTarget,
  borderRadius,
  layout,
  shadows,
  spacing,
  type ShadowToken,
  type TouchTargetToken,
} from './tokens';
import {
  accessibleTextStyles,
  baseTextStyles,
  fonts,
  typography,
  type TextStyles,
  type TextStyleToken,
} from './typography';

// ---------------------------------------------------------------------------
// Semantic sets — a thin, meaning-only read of the spec's success / warning /
// error ramps (plus `secondary` for "info", which is the ramp the spec's own
// `badge.info` recipe reaches for). Steps are chosen so every pair clears AA:
// the 500/600 steps of the Tailwind-style ramps do NOT carry white text.
// ---------------------------------------------------------------------------

export interface SemanticColorSet {
  /** Text of this meaning on background.primary. */
  text: string;
  /** Icon tint on background.primary. */
  icon: string;
  /** Tinted surface (e.g. alert card background). */
  bg: string;
  /** Text on the tinted surface. */
  fgOnBg: string;
  /** Solid fill (badges, pills). */
  solid: string;
  /** Text on the solid fill. */
  onSolid: string;
}

export interface SemanticColors {
  success: SemanticColorSet;
  error: SemanticColorSet;
  warning: SemanticColorSet;
  info: SemanticColorSet;
}

function semanticSet(ramp: ColorRamp): SemanticColorSet {
  return {
    text: ramp[800],
    icon: ramp[700],
    bg: ramp[50],
    fgOnBg: ramp[900],
    solid: ramp[700],
    onSolid: colors.text.inverse,
  };
}

const semantic: SemanticColors = {
  success: semanticSet(colors.success),
  error: semanticSet(colors.error),
  warning: semanticSet(colors.warning),
  info: semanticSet(colors.secondary),
};

// ---------------------------------------------------------------------------
// App-facing recipes
// ---------------------------------------------------------------------------

export interface ButtonRecipe {
  background: string;
  text: string;
  borderColor?: string;
  borderWidth?: number;
  minHeight: number;
  borderRadius: number;
  paddingHorizontal: number;
  textStyle: TextStyleToken;
}

export interface CardRecipe {
  background: string;
  borderRadius: number;
  padding: number;
  gap: number;
  shadow: ShadowToken;
  /** Section 9's icon-in-circle: a `50`-step circle with a saturated icon. */
  iconCircle: { size: number; background: string; color: string };
  title: { textStyle: TextStyleToken; color: string };
  subtitle: { textStyle: TextStyleToken; color: string };
  chevron: { color: string; size: number };
}

/** Section 9's label-plus-rule section header. */
export interface SectionHeaderRecipe {
  label: { textStyle: TextStyleToken; color: string };
  rule: { color: string; thickness: number };
  gap: number;
  marginTop: number;
  marginBottom: number;
}

/** Section 3's signature pattern: serif display + tracked mono eyebrow. */
export interface HeroRecipe {
  eyebrow: { textStyle: TextStyleToken; color: string };
  display: { textStyle: TextStyleToken; color: string };
  gap: number;
}

export interface ListRowRecipe {
  minHeight: number;
  paddingVertical: number;
  gap: number;
}

export interface Recipes {
  button: { primary: ButtonRecipe; secondary: ButtonRecipe };
  card: CardRecipe;
  sectionHeader: SectionHeaderRecipe;
  hero: HeroRecipe;
  listRow: ListRowRecipe;
}

// ---------------------------------------------------------------------------
// Theme shape
// ---------------------------------------------------------------------------

export interface ThemeColors<TText> extends PaletteColors<TText> {
  /** Meaning-only reads of the semantic ramps. */
  semantic: SemanticColors;
  /** Every ramp, including the persimmon reference ramp. */
  ramps: typeof ramps;
}

export interface ThemeBase<TText> {
  name: 'base' | 'accessible';
  colors: ThemeColors<TText>;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  shadows: typeof shadows;
  typography: typeof typography;
  fonts: typeof fonts;
  textStyles: TextStyles;
  components: Components;
  layout: typeof layout;
  animation: typeof animation;
  touchTarget: TouchTargetToken;
  recipes: Recipes;
}

export type BaseTheme = ThemeBase<TextColors>;
export type AccessibleTheme = ThemeBase<AccessibleTextColors>;
export type Theme = BaseTheme | AccessibleTheme;

/**
 * "Whichever step actually clears 4.5:1" — scan the ramp from 500 downward and
 * return the first step whose contrast with the given text color passes AA for
 * normal text. This is how the accessible button fill is chosen, so a future
 * brand-color change re-derives the fill instead of silently failing.
 *
 * Persimmon needed 600; juniper resolves to 500. The number is hue-specific and
 * must never be hardcoded (porting note 2b).
 */
export function firstAccessibleFillStep(ramp: ColorRamp, text: string): RampStep {
  const candidates: RampStep[] = [500, 600, 700, 800, 900];
  for (const step of candidates) {
    if (contrastRatio(text, ramp[step]) >= 4.5) {
      return step;
    }
  }
  throw new Error('No ramp step from 500 down carries this text color at AA.');
}

/** The AA-passing primary button fill for the Juniper ramp (recomputed, not assumed). */
export const ACCESSIBLE_BUTTON_FILL_STEP: RampStep = firstAccessibleFillStep(
  juniper,
  colors.text.inverse
);

// ---------------------------------------------------------------------------
// Base theme (the spec as ported) — apps/family
// ---------------------------------------------------------------------------

export const baseTheme: BaseTheme = {
  name: 'base',
  colors: { ...colors, semantic, ramps },
  spacing,
  borderRadius,
  shadows,
  typography,
  fonts,
  textStyles: baseTextStyles,
  components,
  layout,
  animation,
  touchTarget: baseTouchTarget,
  recipes: {
    button: {
      // section 7 `button.primary`
      primary: {
        background: components.button.primary.backgroundColor,
        text: colors.text.inverse,
        minHeight: baseTouchTarget.minHeight,
        borderRadius: components.button.primary.borderRadius,
        paddingHorizontal: components.button.primary.paddingHorizontal,
        textStyle: baseTextStyles.button,
      },
      // section 7 `button.outline` — the quiet companion to the primary CTA.
      secondary: {
        background: components.button.outline.backgroundColor,
        text: colors.text.accent,
        borderColor: components.button.outline.borderColor,
        borderWidth: components.button.outline.borderWidth,
        minHeight: baseTouchTarget.minHeight,
        borderRadius: components.button.outline.borderRadius,
        paddingHorizontal: components.button.outline.paddingHorizontal,
        textStyle: baseTextStyles.button,
      },
    },
    card: {
      background: components.card.base.backgroundColor,
      borderRadius: components.card.base.borderRadius,
      padding: components.card.base.padding,
      gap: spacing.md,
      shadow: shadows.sm,
      iconCircle: { size: 40, background: colors.accent[50], color: colors.accent[500] },
      title: { textStyle: baseTextStyles.h3, color: colors.text.primary },
      subtitle: { textStyle: baseTextStyles.bodySmall, color: colors.text.secondary },
      chevron: { color: colors.text.tertiary, size: 20 },
    },
    sectionHeader: {
      label: { textStyle: baseTextStyles.label, color: colors.text.secondary },
      rule: { color: colors.rule, thickness: 1 },
      gap: spacing.sm,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    hero: {
      eyebrow: { textStyle: baseTextStyles.label, color: colors.text.accent },
      display: { textStyle: baseTextStyles.display, color: colors.text.primary },
      gap: spacing.xs,
    },
    listRow: {
      minHeight: baseTouchTarget.minHeight,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
  },
};

// ---------------------------------------------------------------------------
// Accessible theme — apps/onboarding, exclusively
// ---------------------------------------------------------------------------

const accessibleColors: ThemeColors<AccessibleTextColors> = {
  ...accessiblePalette,
  semantic,
  ramps,
};

export const accessibleTheme: AccessibleTheme = {
  name: 'accessible',
  colors: accessibleColors,
  spacing,
  borderRadius,
  shadows,
  typography,
  fonts,
  textStyles: accessibleTextStyles,
  components: accessibleComponents,
  layout,
  animation,
  touchTarget: accessibleTouchTarget,
  recipes: {
    button: {
      primary: {
        // The AA-audited pair: white text on the first Juniper step >= 4.5:1.
        background: juniper[ACCESSIBLE_BUTTON_FILL_STEP],
        text: accessibleColors.text.inverse,
        minHeight: accessibleTouchTarget.minHeight,
        borderRadius: components.button.primary.borderRadius,
        paddingHorizontal: components.button.primary.paddingHorizontal,
        textStyle: accessibleTextStyles.button,
      },
      secondary: {
        background: components.button.outline.backgroundColor,
        text: colors.accent[700],
        borderColor: components.button.outline.borderColor,
        borderWidth: components.button.outline.borderWidth,
        minHeight: accessibleTouchTarget.minHeight,
        borderRadius: components.button.outline.borderRadius,
        paddingHorizontal: components.button.outline.paddingHorizontal,
        textStyle: accessibleTextStyles.button,
      },
    },
    card: {
      background: components.card.base.backgroundColor,
      borderRadius: components.card.base.borderRadius,
      // Patient-facing cards breathe: the spec's next step up from `base`.
      padding: spacing.lg,
      gap: spacing.md,
      shadow: shadows.sm,
      iconCircle: { size: 48, background: colors.accent[50], color: colors.accent[700] },
      title: { textStyle: accessibleTextStyles.h3, color: accessibleColors.text.primary },
      subtitle: { textStyle: accessibleTextStyles.bodySmall, color: accessibleColors.text.secondary },
      chevron: { color: accessibleColors.text.secondary, size: 24 },
    },
    sectionHeader: {
      label: { textStyle: accessibleTextStyles.label, color: accessibleColors.text.secondary },
      rule: { color: colors.rule, thickness: 1 },
      gap: spacing.sm,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    hero: {
      eyebrow: { textStyle: accessibleTextStyles.label, color: accessibleColors.text.accent },
      display: { textStyle: accessibleTextStyles.display, color: accessibleColors.text.primary },
      gap: spacing.xs,
    },
    listRow: {
      minHeight: accessibleTouchTarget.minHeight,
      paddingVertical: spacing.base,
      gap: spacing.md,
    },
  },
};

export const themes = { base: baseTheme, accessible: accessibleTheme } as const;
export type ThemeVariant = keyof typeof themes;

// ---------------------------------------------------------------------------
// Contrast audit surface
// ---------------------------------------------------------------------------

export interface ContrastPair {
  name: string;
  fg: string;
  bg: string;
  /** Large text (>=18pt regular / >=14pt bold) — AA threshold 3:1 instead of 4.5:1. */
  large?: boolean;
}

/**
 * Every foreground/background token pair the accessible variant uses.
 * The contrast audit test (and CI) asserts AA over this list.
 */
export function accessibleContrastPairs(): ContrastPair[] {
  const t = accessibleTheme;
  const { text } = t.colors;
  const bgs: Array<[string, string]> = [
    ['background.primary', t.colors.background.primary],
    ['background.secondary', t.colors.background.secondary],
    ['background.tertiary', t.colors.background.tertiary],
  ];
  const pairs: ContrastPair[] = [];
  for (const [bgName, bg] of bgs) {
    pairs.push({ name: `text.primary on ${bgName}`, fg: text.primary, bg });
    pairs.push({ name: `text.secondary on ${bgName}`, fg: text.secondary, bg });
    pairs.push({ name: `text.accent on ${bgName}`, fg: text.accent, bg });
    pairs.push({ name: `ink on ${bgName}`, fg: t.colors.ink, bg });
    pairs.push({ name: `inkSoft on ${bgName}`, fg: t.colors.inkSoft, bg });
  }
  pairs.push(
    {
      name: 'text.inverse on background.dark',
      fg: text.inverse,
      bg: t.colors.background.dark,
    },
    {
      name: 'button.primary text on fill',
      fg: t.recipes.button.primary.text,
      bg: t.recipes.button.primary.background,
    },
    {
      name: 'button.secondary text on background.primary',
      fg: t.recipes.button.secondary.text,
      bg: t.colors.background.primary,
    },
    {
      name: 'hero eyebrow on background.primary',
      fg: t.recipes.hero.eyebrow.color,
      bg: t.colors.background.primary,
    },
    {
      name: 'hero display on background.primary',
      fg: t.recipes.hero.display.color,
      bg: t.colors.background.primary,
      large: true,
    },
    {
      name: 'sectionHeader label on background.primary',
      fg: t.recipes.sectionHeader.label.color,
      bg: t.colors.background.primary,
    },
    {
      name: 'sectionHeader label on background.secondary',
      fg: t.recipes.sectionHeader.label.color,
      bg: t.colors.background.secondary,
    },
    {
      name: 'card title on card background',
      fg: t.recipes.card.title.color,
      bg: t.recipes.card.background,
    },
    {
      name: 'card subtitle on card background',
      fg: t.recipes.card.subtitle.color,
      bg: t.recipes.card.background,
    },
    {
      name: 'card icon on icon circle',
      fg: t.recipes.card.iconCircle.color,
      bg: t.recipes.card.iconCircle.background,
    },
    {
      name: 'input text on components.input.base background',
      fg: t.components.input.base.color,
      bg: t.components.input.base.backgroundColor,
    },
    {
      name: 'accent link (accent.700) on background.primary',
      fg: t.colors.accent[700],
      bg: t.colors.background.primary,
    }
  );
  for (const key of ['success', 'error', 'warning', 'info'] as const) {
    const s = t.colors.semantic[key];
    pairs.push(
      { name: `semantic.${key}.text on background.primary`, fg: s.text, bg: t.colors.background.primary },
      { name: `semantic.${key}.icon on background.primary (large/icon)`, fg: s.icon, bg: t.colors.background.primary, large: true },
      { name: `semantic.${key}.fgOnBg on semantic.${key}.bg`, fg: s.fgOnBg, bg: s.bg },
      { name: `semantic.${key}.onSolid on semantic.${key}.solid`, fg: s.onSolid, bg: s.solid }
    );
  }
  return pairs;
}
