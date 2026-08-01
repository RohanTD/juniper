/**
 * @juniper/theme — the Thoracle theme system, ported for Juniper.
 *
 * See THEME_SYSTEM.md (in this package) for the canonical spec, including the
 * two porting changes: the generated Juniper brand ramp and the accessible
 * variant for patient-facing surfaces.
 */
export {
  contrastRatio,
  hexToOklch,
  hexToRgb,
  meetsWcagAA,
  meetsWcagAAA,
  oklabLightness,
  oklchToHex,
  relativeLuminance,
  rgbToHex,
  type Oklch,
  type Rgb,
} from './color';
export { generateRamp, RAMP_STEPS, type ColorRamp, type RampStep } from './ramp';
export {
  accent,
  error,
  info,
  juniper,
  JUNIPER_500,
  neutral,
  persimmon,
  ramps,
  success,
  warning,
  type RampName,
} from './ramps';
export {
  accessibleTextStyles,
  accessibleTouchTarget,
  baseTextStyles,
  baseTouchTarget,
  fontFamilies,
  radii,
  resolveTextStyle,
  shadows,
  spacing,
  type RadiusToken,
  type ResolvedTextStyle,
  type ShadowToken,
  type SpacingToken,
  type TextStyleName,
  type TextStyles,
  type TextStyleToken,
  type TouchTargetToken,
} from './tokens';
export {
  ACCESSIBLE_BUTTON_FILL_STEP,
  accessibleContrastPairs,
  accessibleTheme,
  baseTheme,
  firstAccessibleFillStep,
  themes,
  type AccessibleTextColors,
  type AccessibleTheme,
  type BaseTextColors,
  type BaseTheme,
  type ButtonRecipe,
  type CardRecipe,
  type ContrastPair,
  type HeroRecipe,
  type ListRowRecipe,
  type Recipes,
  type SectionHeaderRecipe,
  type SemanticColors,
  type SemanticColorSet,
  type Theme,
  type ThemeVariant,
} from './themes';
export { ThemeProvider, useTheme, type ThemeProviderProps } from './provider';
