/**
 * Color ramps.
 *
 * `juniper` is generated from the brand hex; `accent` duplicates it as
 * LITERALS per the theme's own note ("brand ramp duplicated into `accent` as a
 * literal"). A test asserts the literals stay equal to the generator output —
 * if you change JUNIPER_500, re-bake the literals below.
 *
 * `persimmon` is the original Thoracle brand ramp, retained for reference and
 * tests only. Its 600 step is pinned to the documented literal #CC4520 (the
 * step THEME_SYSTEM.md's accessible-button note is calibrated against); the
 * other steps are generated from the documented 500.
 */
import { generateRamp, type ColorRamp } from './ramp';

/**
 * The Juniper brand color: a deep juniper blue-green.
 * White on this step measures 6.0:1 — AA for normal text with room to spare.
 */
export const JUNIPER_500 = '#2C6E5E';

/** Generated brand ramp. juniper[500] === JUNIPER_500. */
export const juniper: ColorRamp = generateRamp(JUNIPER_500);

/** Brand ramp duplicated as literals, per the theme's own note. */
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

/** Original Thoracle persimmon — reference/tests only. Never use in Juniper UI. */
export const persimmon: ColorRamp = {
  ...generateRamp('#E8572A'),
  600: '#CC4520',
};

/** Neutral ramp — warm-violet greys. 400 = text.tertiary, 600 = text.secondary. */
export const neutral: ColorRamp = {
  50: '#F7F7F9',
  100: '#EFEFF3',
  200: '#E3E3E9',
  300: '#C9C9D2',
  400: '#9E9EA7',
  500: '#75757F',
  600: '#5A5A66',
  700: '#43434D',
  800: '#2C2C34',
  900: '#1A1A1F',
};

// Semantic ramps — meaning only, never decoration.
export const success: ColorRamp = generateRamp('#1F7A4D');
export const error: ColorRamp = generateRamp('#C0392B');
export const warning: ColorRamp = generateRamp('#8A5A00');
export const info: ColorRamp = generateRamp('#2B6CB0');

export const ramps = {
  juniper,
  accent,
  persimmon,
  neutral,
  success,
  error,
  warning,
  info,
} as const;

export type RampName = keyof typeof ramps;
