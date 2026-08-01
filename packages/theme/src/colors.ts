/**
 * THEME_SYSTEM.md section 2 — the named color tokens.
 *
 * Everything here is the spec's literal table. The only deviation is porting
 * note 1: `primary`/`accent` (and therefore `text.accent`, which the spec
 * defines as "= primary[500]") carry the Juniper brand ramp instead of
 * persimmon. Neutrals, `secondary`, the semantic ramps, `background`, `text`,
 * `rule`, `ink` and `inkSoft` are unchanged from the spec.
 *
 * Rules for using color (spec section 2):
 *  - Never hardcode a hex in a screen/component — always a token.
 *  - `rule` is the ONLY divider/border color. Do not introduce a second gray.
 *  - `ink` / `inkSoft` are semantic names for text.primary / text.secondary.
 *  - success / warning / error map to meaning, never decoration.
 */
import type { ColorRamp, NeutralRamp } from './ramp';
import {
  accent,
  error,
  neutral,
  primary,
  secondary,
  success,
  warning,
} from './ramps';

export interface BackgroundColors {
  primary: string;
  secondary: string;
  tertiary: string;
  dark: string;
}

export interface TextColors {
  primary: string;
  secondary: string;
  /**
   * Base variant only — #9E9EA7 measures ~2.7:1 on white and fails AA badly.
   * Absent from the accessible variant (porting note 2a).
   */
  tertiary: string;
  inverse: string;
  accent: string;
}

/** The accessible variant deliberately has NO `tertiary`; `never` keeps it out at the type level. */
export interface AccessibleTextColors {
  primary: string;
  secondary: string;
  inverse: string;
  accent: string;
  tertiary?: never;
}

export interface PaletteColors<TText> {
  primary: ColorRamp;
  secondary: ColorRamp;
  accent: ColorRamp;
  success: ColorRamp;
  warning: ColorRamp;
  error: ColorRamp;
  neutral: NeutralRamp;
  background: BackgroundColors;
  text: TText;
  /** Hairline dividers — the ONLY divider color used app-wide. */
  rule: string;
  /** = text.primary; a semantic name for "near-black". */
  ink: string;
  /** = text.secondary. */
  inkSoft: string;
}

export const background: BackgroundColors = {
  primary: '#FFFFFF',
  secondary: '#FAFAFA',
  tertiary: '#F5F5F6',
  dark: '#111114',
};

export const text: TextColors = {
  primary: '#111114',
  secondary: '#5A5A66',
  tertiary: '#9E9EA7',
  inverse: '#FFFFFF',
  accent: primary[500], // spec: "= primary[500]"
};

/** Porting note 2a: `text.tertiary` does not exist on patient-facing surfaces. */
export const accessibleText: AccessibleTextColors = {
  primary: text.primary,
  secondary: text.secondary,
  inverse: text.inverse,
  accent: text.accent,
};

export const rule = '#EBEBED';
export const ink = '#111114';
export const inkSoft = '#5A5A66';

/** The spec's `colors` object, section 2. */
export const colors: PaletteColors<TextColors> = {
  primary,
  secondary,
  accent,
  success,
  warning,
  error,
  neutral,
  background,
  text,
  rule,
  ink,
  inkSoft,
};

/** Same palette with `text.tertiary` removed (porting note 2a). */
export const accessiblePalette: PaletteColors<AccessibleTextColors> = {
  ...colors,
  text: accessibleText,
};
