/**
 * THEME_SYSTEM.md sections 1 and 3 — fonts, the type scale, and the pre-built
 * text style recipes.
 *
 * Three families, three jobs, never mixed (section 1):
 *   Instrument Serif — display/hero only, never body copy.
 *   Outfit          — all body copy, buttons, form labels, UI text.
 *   IBM Plex Mono   — small metadata and uppercase tracked labels only.
 *
 * PORTING NOTE 3: `lineHeights` in the spec are already *ratios*, not fixed px,
 * so scaled text cannot clip. Every `lineHeight` in this file is therefore a
 * MULTIPLIER of fontSize; `resolveTextStyle` multiplies the SCALED font size by
 * it to obtain concrete RN-ready values.
 */

// ---------------------------------------------------------------------------
// Section 1 — font family name map (`typography.fonts`)
// ---------------------------------------------------------------------------

export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semiBold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',

  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',

  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoItalic: 'IBMPlexMono_400Italic',

  /** Outfit has no italic; fall back to serif italic. */
  italic: 'InstrumentSerif_400Regular_Italic',
} as const;

export type FontToken = keyof typeof fonts;

// ---------------------------------------------------------------------------
// Section 3 — the type scale
// ---------------------------------------------------------------------------

export const sizes = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 38,
  '5xl': 48,
  '6xl': 64,
} as const;

export type SizeToken = keyof typeof sizes;

/** Ratios, never px — see porting note 3. */
export const lineHeights = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.5,
  relaxed: 1.7,
} as const;

export type LineHeightToken = keyof typeof lineHeights;

export const letterSpacing = {
  tighter: -0.8,
  tight: -0.4,
  normal: 0,
  wide: 0.6,
  wider: 1.4,
  widest: 2.4,
} as const;

export type LetterSpacingToken = keyof typeof letterSpacing;

export const typography = { fonts, sizes, lineHeights, letterSpacing } as const;

// ---------------------------------------------------------------------------
// Section 3 — pre-built text style recipes
// ---------------------------------------------------------------------------

export interface TextStyleToken {
  fontFamily: string;
  /** px at fontScale 1 */
  fontSize: number;
  /** MULTIPLIER of fontSize — never px. */
  lineHeight: number;
  /** px at fontScale 1 */
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'none';
}

/** The spec's recipe table, verbatim in name and order. */
export type TextStyleName =
  | 'displayLarge'
  | 'display'
  | 'displayItalic'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'bodyLarge'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'meta'
  | 'caption'
  | 'button';

export type TextStyles = Record<TextStyleName, TextStyleToken>;

/**
 * Base scale — the spec's table exactly.
 *
 * The table fixes font and size for every recipe, and fixes tracking for the
 * two recipes where it is part of the recipe's identity (`label` = widest,
 * `button` = wide) plus `label`'s uppercase transform. Line height and the
 * remaining tracking are composed from the `lineHeights` / `letterSpacing`
 * tokens: tight/tighter for display sizes, snug for headings and one-line UI
 * text, normal for body copy, relaxed for lead paragraphs.
 */
export const baseTextStyles: TextStyles = {
  displayLarge: {
    fontFamily: fonts.display,
    fontSize: sizes['6xl'],
    lineHeight: lineHeights.tight,
    letterSpacing: letterSpacing.tighter,
  },
  display: {
    fontFamily: fonts.display,
    fontSize: sizes['5xl'],
    lineHeight: lineHeights.tight,
    letterSpacing: letterSpacing.tighter,
  },
  displayItalic: {
    fontFamily: fonts.displayItalic,
    fontSize: sizes['4xl'],
    lineHeight: lineHeights.tight,
    letterSpacing: letterSpacing.tight,
  },
  h1: {
    fontFamily: fonts.bold,
    fontSize: sizes['3xl'],
    lineHeight: lineHeights.tight,
    letterSpacing: letterSpacing.tight,
  },
  h2: {
    fontFamily: fonts.bold,
    fontSize: sizes['2xl'],
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.tight,
  },
  h3: {
    fontFamily: fonts.semiBold,
    fontSize: sizes.xl,
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.normal,
  },
  h4: {
    fontFamily: fonts.semiBold,
    fontSize: sizes.lg,
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.normal,
  },
  bodyLarge: {
    fontFamily: fonts.regular,
    fontSize: sizes.lg,
    lineHeight: lineHeights.relaxed,
    letterSpacing: letterSpacing.normal,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: sizes.base,
    lineHeight: lineHeights.normal,
    letterSpacing: letterSpacing.normal,
  },
  bodySmall: {
    fontFamily: fonts.regular,
    fontSize: sizes.sm,
    lineHeight: lineHeights.normal,
    letterSpacing: letterSpacing.normal,
  },
  label: {
    fontFamily: fonts.monoMedium,
    fontSize: sizes.xs,
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.widest,
    textTransform: 'uppercase',
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: sizes.xs,
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.normal,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: sizes.xs,
    lineHeight: lineHeights.normal,
    letterSpacing: letterSpacing.normal,
  },
  button: {
    fontFamily: fonts.semiBold,
    fontSize: sizes.base,
    lineHeight: lineHeights.snug,
    letterSpacing: letterSpacing.wide,
  },
};

/**
 * Accessible scale — porting note 2c, and nothing else.
 *
 * Identical to the base table except that the type-scale FLOOR is raised: no
 * text sits below `sizes.sm` (13) and nothing a patient must actually read
 * sits below `sizes.md` (16). Fonts, tracking, transforms and every size at or
 * above the floor are untouched, and each raised size is still a `sizes` token.
 *
 *   body      base 15 -> md 16    (must be read)
 *   bodySmall sm   13 -> md 16    (must be read)
 *   caption   xs   11 -> md 16    (must be read — helper text)
 *   button    base 15 -> md 16    (must be read)
 *   label     xs   11 -> sm 13    (metadata floor)
 *   meta      xs   11 -> sm 13    (metadata floor)
 */
export const accessibleTextStyles: TextStyles = {
  ...baseTextStyles,
  bodyLarge: { ...baseTextStyles.bodyLarge },
  body: { ...baseTextStyles.body, fontSize: sizes.md },
  bodySmall: { ...baseTextStyles.bodySmall, fontSize: sizes.md },
  caption: { ...baseTextStyles.caption, fontSize: sizes.md },
  button: { ...baseTextStyles.button, fontSize: sizes.md },
  label: { ...baseTextStyles.label, fontSize: sizes.sm },
  meta: { ...baseTextStyles.meta, fontSize: sizes.sm },
};

/**
 * Resolve a text-style token into concrete values for a given OS font scale.
 * `lineHeight` comes back in px, computed from the SCALED size — this is what
 * keeps large accessibility text from clipping (porting note 3).
 */
export interface ResolvedTextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'none';
}

export function resolveTextStyle(token: TextStyleToken, fontScale = 1): ResolvedTextStyle {
  const fontSize = token.fontSize * fontScale;
  const resolved: ResolvedTextStyle = {
    fontFamily: token.fontFamily,
    fontSize,
    lineHeight: Math.round(fontSize * token.lineHeight * 100) / 100,
  };
  if (token.letterSpacing !== undefined) {
    resolved.letterSpacing = token.letterSpacing * fontScale;
  }
  if (token.textTransform !== undefined) {
    resolved.textTransform = token.textTransform;
  }
  return resolved;
}
