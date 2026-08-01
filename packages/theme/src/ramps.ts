/**
 * Color ramps — THEME_SYSTEM.md section 2.
 *
 * Every ramp below except `primary`/`accent` is the spec's literal table,
 * transcribed verbatim. Per the spec's own instruction ("The rest of the
 * palette — neutrals, semantic success/warning/error — is intentionally
 * generic and should not change") they are NOT generated and must not be
 * regenerated.
 *
 * The single permitted deviation (porting note 1) is the brand ramp:
 * `juniper` is generated from the Juniper brand hex, and `accent` duplicates
 * it as LITERALS per the spec's note on `accent` ("Keep it as a literal
 * duplicate of `primary`, not an alias"). A test asserts the literals stay
 * equal to the generator output — if you change JUNIPER_500, re-bake them.
 *
 * `persimmon` is Thoracle's original brand ramp, transcribed from the spec and
 * retained for reference and for the contrast tests only. Never Juniper UI.
 */
import { generateRamp, type ColorRamp, type NeutralRamp } from './ramp';

/**
 * The Juniper brand color: a deep juniper blue-green.
 * White on this step measures 6.0:1 — AA for normal text with room to spare.
 */
export const JUNIPER_500 = '#2C6E5E';

/** Generated brand ramp. juniper[500] === JUNIPER_500. */
export const juniper: ColorRamp = generateRamp(JUNIPER_500);

/**
 * `colors.primary` — the brand ramp (porting note 1: juniper, not persimmon).
 */
export const primary: ColorRamp = juniper;

/** Brand ramp duplicated as literals, per the spec's note on `accent`. */
export const accent: ColorRamp = {
  50: '#EDF6F3',
  100: '#D7E8E3',
  200: '#B1D0C6',
  300: '#85B2A5',
  400: '#599182',
  500: '#2C6E5E',
  600: '#185A4B',
  700: '#07483B',
  800: '#01392E',
  900: '#002C22',
};

/**
 * Thoracle's original persimmon ramp, verbatim from THEME_SYSTEM.md section 2.
 * Reference and contrast tests only — never Juniper UI.
 */
export const persimmon: ColorRamp = {
  50: '#FFF5F0',
  100: '#FFE4D6',
  200: '#FFCBB2',
  300: '#FFA682',
  400: '#F07843',
  500: '#E8572A',
  600: '#CC4520',
  700: '#A83618',
  800: '#862B14',
  900: '#5C1D0E',
};

/** Secondary — slate blue, used sparingly for secondary UI accents. Spec verbatim. */
export const secondary: ColorRamp = {
  50: '#F0F4FF',
  100: '#D9E2FC',
  200: '#B3C5F7',
  300: '#8DA6ED',
  400: '#6684DC',
  500: '#4361C2',
  600: '#354FA0',
  700: '#293D7D',
  800: '#1D2C5A',
  900: '#111B38',
};

/** Semantic ramps — meaning only, never decoration. Spec verbatim. */
export const success: ColorRamp = {
  50: '#ECFDF5',
  100: '#D1FAE5',
  200: '#A7F3D0',
  300: '#6EE7B7',
  400: '#34D399',
  500: '#10B981',
  600: '#059669',
  700: '#047857',
  800: '#065F46',
  900: '#064E3B',
};

export const warning: ColorRamp = {
  50: '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  300: '#FCD34D',
  400: '#FBBF24',
  500: '#F59E0B',
  600: '#D97706',
  700: '#B45309',
  800: '#92400E',
  900: '#78350F',
};

export const error: ColorRamp = {
  50: '#FEF2F2',
  100: '#FEE2E2',
  200: '#FECACA',
  300: '#FCA5A5',
  400: '#F87171',
  500: '#EF4444',
  600: '#DC2626',
  700: '#B91C1C',
  800: '#991B1B',
  900: '#7F1D1D',
};

/**
 * Neutrals — cool-warm gray, deliberately neither blue-gray nor yellow-gray.
 * Spec verbatim, including the extra `0` step no other ramp has.
 */
export const neutral: NeutralRamp = {
  0: '#FFFFFF',
  50: '#FAFAFA',
  100: '#F5F5F6',
  200: '#EBEBED',
  300: '#DCDCE0',
  400: '#B0B0B8',
  500: '#7E7E8A',
  600: '#5A5A66',
  700: '#3D3D47',
  800: '#27272D',
  900: '#111114',
};

export const ramps = {
  primary,
  secondary,
  accent,
  success,
  warning,
  error,
  neutral,
  juniper,
  persimmon,
} as const;

export type RampName = keyof typeof ramps;
