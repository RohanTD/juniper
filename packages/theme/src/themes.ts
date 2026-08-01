/**
 * The two theme variants.
 *
 *  - `baseTheme` — the Thoracle theme as ported: editorial, compact, designed
 *    for adult readers on good screens. Used by apps/family.
 *  - `accessibleTheme` — the patient-facing variant mandated by the port:
 *    every fg/bg pair AA-audited, `text.tertiary` REMOVED (not merely
 *    discouraged), raised type floor, larger touch targets. Used exclusively
 *    by apps/onboarding.
 *
 * `accessibleContrastPairs()` enumerates every foreground/background pair the
 * accessible variant actually uses, and is consumed by the contrast audit test
 * and available to CI.
 */
import { contrastRatio } from './color';
import type { ColorRamp, RampStep } from './ramp';
import { accent, error, info, juniper, neutral, ramps, success, warning } from './ramps';
import {
  accessibleTextStyles,
  accessibleTouchTarget,
  baseTextStyles,
  baseTouchTarget,
  radii,
  shadows,
  spacing,
  fontFamilies,
  type ShadowToken,
  type TextStyles,
  type TouchTargetToken,
} from './tokens';

// ---------------------------------------------------------------------------
// Named color tokens
// ---------------------------------------------------------------------------

export interface BackgroundColors {
  primary: string;
  secondary: string;
  tertiary: string;
}

export interface BaseTextColors {
  primary: string;
  secondary: string;
  /** Base variant only — fails AA on white (~2.7:1). Metadata at your own risk. */
  tertiary: string;
  inverse: string;
}

/** The accessible variant deliberately has NO `tertiary`. `never` keeps it out at the type level too. */
export interface AccessibleTextColors {
  primary: string;
  secondary: string;
  inverse: string;
  tertiary?: never;
}

export interface BorderColors {
  subtle: string;
  default: string;
  strong: string;
}

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

// ---------------------------------------------------------------------------
// Component recipes
// ---------------------------------------------------------------------------

export interface ButtonRecipe {
  background: string;
  text: string;
  borderColor?: string;
  borderWidth?: number;
  minHeight: number;
  borderRadius: number;
  paddingHorizontal: number;
  textStyle: TextStyles['button'];
}

export interface CardRecipe {
  background: string;
  borderRadius: number;
  padding: number;
  gap: number;
  shadow: ShadowToken;
  iconCircle: { size: number; background: string; color: string };
  title: { textStyle: TextStyles['headline']; color: string };
  subtitle: { textStyle: TextStyles['bodySm']; color: string };
  chevron: { color: string; size: number };
}

export interface SectionHeaderRecipe {
  label: { textStyle: TextStyles['label']; color: string };
  rule: { color: string; thickness: number };
  gap: number;
  marginTop: number;
  marginBottom: number;
}

export interface HeroRecipe {
  eyebrow: { textStyle: TextStyles['eyebrow']; color: string };
  display: { textStyle: TextStyles['displayLg']; color: string };
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

export interface ThemeColors<TText> {
  background: BackgroundColors;
  surface: { primary: string; sunken: string };
  text: TText;
  border: BorderColors;
  accent: ColorRamp;
  semantic: SemanticColors;
  ramps: typeof ramps;
}

export interface ThemeBase<TText> {
  name: 'base' | 'accessible';
  colors: ThemeColors<TText>;
  spacing: typeof spacing;
  radii: typeof radii;
  shadows: typeof shadows;
  fonts: typeof fontFamilies;
  textStyles: TextStyles;
  touchTarget: TouchTargetToken;
  recipes: Recipes;
}

export type BaseTheme = ThemeBase<BaseTextColors>;
export type AccessibleTheme = ThemeBase<AccessibleTextColors>;
export type Theme = BaseTheme | AccessibleTheme;

// ---------------------------------------------------------------------------
// Shared literals
// ---------------------------------------------------------------------------

const background: BackgroundColors = {
  primary: '#FFFFFF',
  secondary: neutral[50],
  tertiary: neutral[100],
};

const surface = { primary: '#FFFFFF', sunken: neutral[50] };

const border: BorderColors = {
  subtle: neutral[100],
  default: neutral[200],
  strong: neutral[300],
};

const WHITE = '#FFFFFF';

function semanticSet(ramp: ColorRamp): SemanticColorSet {
  return {
    text: ramp[700],
    icon: ramp[600],
    bg: ramp[50],
    fgOnBg: ramp[800],
    solid: ramp[600],
    onSolid: WHITE,
  };
}

const semantic: SemanticColors = {
  success: semanticSet(success),
  error: semanticSet(error),
  warning: semanticSet(warning),
  info: semanticSet(info),
};

/**
 * "Whichever step actually clears 4.5:1" — scan the ramp from 500 downward and
 * return the first step whose contrast with the given text color passes AA for
 * normal text. This is how the accessible button fill is chosen, so a future
 * brand-color change re-derives the fill instead of silently failing.
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
export const ACCESSIBLE_BUTTON_FILL_STEP: RampStep = firstAccessibleFillStep(juniper, WHITE);

// ---------------------------------------------------------------------------
// Base theme (Thoracle as ported) — apps/family
// ---------------------------------------------------------------------------

const baseText: BaseTextColors = {
  primary: neutral[900],
  secondary: neutral[600],
  tertiary: neutral[400],
  inverse: WHITE,
};

export const baseTheme: BaseTheme = {
  name: 'base',
  colors: {
    background,
    surface,
    text: baseText,
    border,
    accent,
    semantic,
    ramps,
  },
  spacing,
  radii,
  shadows,
  fonts: fontFamilies,
  textStyles: baseTextStyles,
  touchTarget: baseTouchTarget,
  recipes: {
    button: {
      primary: {
        background: accent[500],
        text: WHITE,
        minHeight: 48,
        borderRadius: radii.md,
        paddingHorizontal: spacing.xl,
        textStyle: baseTextStyles.button,
      },
      secondary: {
        background: 'transparent',
        text: accent[600],
        borderColor: accent[500],
        borderWidth: 1,
        minHeight: 48,
        borderRadius: radii.md,
        paddingHorizontal: spacing.xl,
        textStyle: baseTextStyles.button,
      },
    },
    card: {
      background: surface.primary,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.md,
      shadow: shadows.sm,
      iconCircle: { size: 40, background: accent[100], color: accent[600] },
      title: { textStyle: baseTextStyles.headline, color: baseText.primary },
      subtitle: { textStyle: baseTextStyles.bodySm, color: baseText.secondary },
      chevron: { color: baseText.tertiary, size: 20 },
    },
    sectionHeader: {
      label: { textStyle: baseTextStyles.label, color: baseText.tertiary },
      rule: { color: border.default, thickness: 1 },
      gap: spacing.sm,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    hero: {
      eyebrow: { textStyle: baseTextStyles.eyebrow, color: accent[600] },
      display: { textStyle: baseTextStyles.displayLg, color: baseText.primary },
      gap: spacing.xs,
    },
    listRow: {
      minHeight: 48,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
  },
};

// ---------------------------------------------------------------------------
// Accessible theme — apps/onboarding, exclusively
// ---------------------------------------------------------------------------

const accessibleText: AccessibleTextColors = {
  primary: neutral[900],
  secondary: neutral[600],
  inverse: WHITE,
};

export const accessibleTheme: AccessibleTheme = {
  name: 'accessible',
  colors: {
    background,
    surface,
    text: accessibleText,
    border,
    accent,
    semantic,
    ramps,
  },
  spacing,
  radii,
  shadows,
  fonts: fontFamilies,
  textStyles: accessibleTextStyles,
  touchTarget: accessibleTouchTarget,
  recipes: {
    button: {
      primary: {
        // The AA-audited pair: white text on the first Juniper step >= 4.5:1.
        background: juniper[ACCESSIBLE_BUTTON_FILL_STEP],
        text: WHITE,
        minHeight: accessibleTouchTarget.minHeight,
        borderRadius: radii.md,
        paddingHorizontal: spacing.xl,
        textStyle: accessibleTextStyles.button,
      },
      secondary: {
        background: 'transparent',
        text: accent[700],
        borderColor: accent[500],
        borderWidth: 1.5,
        minHeight: accessibleTouchTarget.minHeight,
        borderRadius: radii.md,
        paddingHorizontal: spacing.xl,
        textStyle: accessibleTextStyles.button,
      },
    },
    card: {
      background: surface.primary,
      borderRadius: radii.lg,
      padding: spacing.xl,
      gap: spacing.md,
      shadow: shadows.sm,
      iconCircle: { size: 48, background: accent[100], color: accent[700] },
      title: { textStyle: accessibleTextStyles.headline, color: accessibleText.primary },
      subtitle: { textStyle: accessibleTextStyles.bodySm, color: accessibleText.secondary },
      chevron: { color: accessibleText.secondary, size: 24 },
    },
    sectionHeader: {
      label: { textStyle: accessibleTextStyles.label, color: accessibleText.secondary },
      rule: { color: border.default, thickness: 1 },
      gap: spacing.sm,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    hero: {
      eyebrow: { textStyle: accessibleTextStyles.eyebrow, color: accent[700] },
      display: { textStyle: accessibleTextStyles.displayLg, color: accessibleText.primary },
      gap: spacing.xs,
    },
    listRow: {
      minHeight: accessibleTouchTarget.minHeight,
      paddingVertical: spacing.lg,
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
    ['surface.sunken', t.colors.surface.sunken],
  ];
  const pairs: ContrastPair[] = [];
  for (const [bgName, bg] of bgs) {
    pairs.push({ name: `text.primary on ${bgName}`, fg: text.primary, bg });
    pairs.push({ name: `text.secondary on ${bgName}`, fg: text.secondary, bg });
  }
  pairs.push(
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
