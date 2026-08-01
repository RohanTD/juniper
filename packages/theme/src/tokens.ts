/**
 * Non-color primitive tokens: spacing, radii, shadows, fonts, text styles.
 *
 * Pure data — no react-native import. Shadow objects are shaped like RN shadow
 * style props (plus `elevation` for Android) but are plain objects; web can map
 * them to box-shadow.
 *
 * PORTING RULE (see THEME_SYSTEM.md "Porting notes"): every `lineHeight` in
 * this file is a MULTIPLIER of fontSize, never a fixed pixel value. The
 * original Thoracle theme used fixed px line heights, which clip text under OS
 * font scaling. Use `resolveTextStyle` to obtain concrete RN-ready values.
 */

// ---------------------------------------------------------------------------
// Spacing — 4pt base grid
// ---------------------------------------------------------------------------

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

// ---------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;

// ---------------------------------------------------------------------------
// Shadows — soft, low-contrast elevation ("editorial paper", never harsh)
// ---------------------------------------------------------------------------

export interface ShadowToken {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export const shadows: Record<'none' | 'sm' | 'md' | 'lg', ShadowToken> = {
  none: {
    shadowColor: '#101014',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  sm: {
    shadowColor: '#101014',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#101014',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#101014',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
};

// ---------------------------------------------------------------------------
// Fonts — three families, fixed roles. Names follow the @expo-google-fonts
// convention so apps can load them with useFonts and reference tokens directly.
// ---------------------------------------------------------------------------

export const fontFamilies = {
  /** Instrument Serif — DISPLAY ONLY. Never body, never UI chrome. */
  display: 'InstrumentSerif_400Regular',
  /** Outfit — all body text and UI. */
  body: {
    regular: 'Outfit_400Regular',
    medium: 'Outfit_500Medium',
    semibold: 'Outfit_600SemiBold',
  },
  /** IBM Plex Mono — small uppercase labels and metadata only. */
  mono: {
    regular: 'IBMPlexMono_400Regular',
    medium: 'IBMPlexMono_500Medium',
  },
} as const;

// ---------------------------------------------------------------------------
// Text styles
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

export type TextStyleName =
  | 'displayXl'
  | 'displayLg'
  | 'displayMd'
  | 'title'
  | 'headline'
  | 'bodyLg'
  | 'body'
  | 'bodySm'
  | 'button'
  | 'label'
  | 'eyebrow'
  | 'caption';

export type TextStyles = Record<TextStyleName, TextStyleToken>;

/** Base scale — the Thoracle scale as ported (fixed px converted to multipliers). */
export const baseTextStyles: TextStyles = {
  displayXl: { fontFamily: fontFamilies.display, fontSize: 40, lineHeight: 1.1, letterSpacing: -0.4 },
  displayLg: { fontFamily: fontFamilies.display, fontSize: 32, lineHeight: 1.15, letterSpacing: -0.3 },
  displayMd: { fontFamily: fontFamilies.display, fontSize: 26, lineHeight: 1.2, letterSpacing: -0.2 },
  title: { fontFamily: fontFamilies.body.semibold, fontSize: 20, lineHeight: 1.3 },
  headline: { fontFamily: fontFamilies.body.semibold, fontSize: 17, lineHeight: 1.35 },
  bodyLg: { fontFamily: fontFamilies.body.regular, fontSize: 17, lineHeight: 1.5 },
  body: { fontFamily: fontFamilies.body.regular, fontSize: 15, lineHeight: 1.5 },
  bodySm: { fontFamily: fontFamilies.body.regular, fontSize: 13, lineHeight: 1.45 },
  button: { fontFamily: fontFamilies.body.semibold, fontSize: 16, lineHeight: 1.25 },
  /** The classic Thoracle 11px uppercase mono label. Base variant only. */
  label: { fontFamily: fontFamilies.mono.medium, fontSize: 11, lineHeight: 1.35, letterSpacing: 0.8, textTransform: 'uppercase' },
  eyebrow: { fontFamily: fontFamilies.mono.medium, fontSize: 12, lineHeight: 1.35, letterSpacing: 1.2, textTransform: 'uppercase' },
  caption: { fontFamily: fontFamilies.body.regular, fontSize: 12, lineHeight: 1.4 },
};

/**
 * Accessible scale — the raised floor for patient-facing surfaces.
 * No text below 13px; nothing a patient must read below 16px.
 */
export const accessibleTextStyles: TextStyles = {
  displayXl: { fontFamily: fontFamilies.display, fontSize: 40, lineHeight: 1.15, letterSpacing: -0.4 },
  displayLg: { fontFamily: fontFamilies.display, fontSize: 34, lineHeight: 1.2, letterSpacing: -0.3 },
  displayMd: { fontFamily: fontFamilies.display, fontSize: 28, lineHeight: 1.25, letterSpacing: -0.2 },
  title: { fontFamily: fontFamilies.body.semibold, fontSize: 22, lineHeight: 1.3 },
  headline: { fontFamily: fontFamilies.body.semibold, fontSize: 18, lineHeight: 1.4 },
  bodyLg: { fontFamily: fontFamilies.body.regular, fontSize: 19, lineHeight: 1.5 },
  body: { fontFamily: fontFamilies.body.regular, fontSize: 17, lineHeight: 1.5 },
  bodySm: { fontFamily: fontFamilies.body.regular, fontSize: 16, lineHeight: 1.5 },
  button: { fontFamily: fontFamilies.body.semibold, fontSize: 18, lineHeight: 1.3 },
  label: { fontFamily: fontFamilies.mono.medium, fontSize: 13, lineHeight: 1.4, letterSpacing: 0.8, textTransform: 'uppercase' },
  eyebrow: { fontFamily: fontFamilies.mono.medium, fontSize: 14, lineHeight: 1.4, letterSpacing: 1.2, textTransform: 'uppercase' },
  caption: { fontFamily: fontFamilies.body.regular, fontSize: 16, lineHeight: 1.45 },
};

/**
 * Resolve a text-style token into concrete values for a given OS font scale.
 * `lineHeight` comes back in px, computed from the SCALED size — this is what
 * keeps large accessibility text from clipping.
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

// ---------------------------------------------------------------------------
// Touch targets
// ---------------------------------------------------------------------------

export interface TouchTargetToken {
  minHeight: number;
  minWidth: number;
}

export const baseTouchTarget: TouchTargetToken = { minHeight: 44, minWidth: 44 };
/** Patient-facing surfaces get larger targets. */
export const accessibleTouchTarget: TouchTargetToken = { minHeight: 56, minWidth: 56 };
