/**
 * 10-step color ramp generator.
 *
 * THEME_SYSTEM.md's ramps are 10 steps (50..900) with the brand color at 500.
 * Quick-start step 3 is explicit that a new app must *generate* all ten steps
 * from its brand hex rather than swapping only the 500 step. This generator
 * does that in OKLCH:
 *
 *  - Lightness: steps 50..400 interpolate from a near-white anchor (0.965)
 *    down to the brand's own OKLab lightness; steps 600..900 interpolate from
 *    the brand down to a deep anchor (~0.26). Easing fractions keep adjacent
 *    steps visually distinct. Strictly monotonic by construction.
 *  - Chroma: scaled down toward the extremes (a 50 step is a wash, not a
 *    pastel neon), peaking at the brand step.
 *  - Hue: held constant.
 *  - Gamut: out-of-sRGB requests are resolved by reducing chroma only, so the
 *    lightness ladder survives clamping.
 *
 * Step 500 always returns the input hex verbatim (normalized to uppercase).
 */
import { hexToOklch, oklchToHex } from './color';

export type RampStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type ColorRamp = Readonly<Record<RampStep, string>>;

/**
 * The neutral ramp in THEME_SYSTEM.md section 2 carries an extra `0: '#FFFFFF'`
 * step that no other ramp has.
 */
export type NeutralRampStep = 0 | RampStep;

export type NeutralRamp = Readonly<Record<NeutralRampStep, string>>;

export const RAMP_STEPS: readonly RampStep[] = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900,
] as const;

/** Near-white lightness for step 50. */
const LIGHT_ANCHOR = 0.965;
/** Deep lightness for step 900 (bounded so dark brand colors still descend). */
const DARK_ANCHOR = 0.26;

/** Fraction of the (anchor - L500) span for steps 50..400. */
const LIGHT_FRACTIONS: Record<50 | 100 | 200 | 300 | 400, number> = {
  50: 1.0,
  100: 0.9,
  200: 0.72,
  300: 0.5,
  400: 0.26,
};

/** Fraction of the (L500 - darkAnchor) span for steps 600..900. */
const DARK_FRACTIONS: Record<600 | 700 | 800 | 900, number> = {
  600: 0.3,
  700: 0.56,
  800: 0.79,
  900: 1.0,
};

/** Chroma multiplier per step, relative to the brand chroma. */
const CHROMA_FACTORS: Record<RampStep, number> = {
  50: 0.14,
  100: 0.28,
  200: 0.5,
  300: 0.72,
  400: 0.9,
  500: 1.0,
  600: 0.96,
  700: 0.9,
  800: 0.8,
  900: 0.68,
};

export function generateRamp(hex500: string): ColorRamp {
  const brand = hexToOklch(hex500);
  const lightAnchor = Math.max(LIGHT_ANCHOR, brand.L + 0.02);
  const darkAnchor = Math.min(DARK_ANCHOR, brand.L - 0.12);

  const ramp = {} as Record<RampStep, string>;
  for (const step of RAMP_STEPS) {
    if (step === 500) {
      ramp[500] = hex500.toUpperCase();
      continue;
    }
    let L: number;
    if (step < 500) {
      const f = LIGHT_FRACTIONS[step as 50 | 100 | 200 | 300 | 400];
      L = brand.L + (lightAnchor - brand.L) * f;
    } else {
      const f = DARK_FRACTIONS[step as 600 | 700 | 800 | 900];
      L = brand.L - (brand.L - darkAnchor) * f;
    }
    ramp[step] = oklchToHex({
      L,
      C: brand.C * CHROMA_FACTORS[step],
      h: brand.h,
    });
  }
  return ramp;
}
