/**
 * @juniper/theme — the Thoracle theme system, ported for Juniper.
 *
 * THEME_SYSTEM.md (in this package) is the authoritative spec. Sections 2–8 are
 * ported verbatim; the "Juniper porting notes" section at its foot lists the
 * only permitted deviations (the generated Juniper brand ramp, the accessible
 * variant for patient-facing surfaces, and the line-height clarification).
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
export {
  generateRamp,
  RAMP_STEPS,
  type ColorRamp,
  type NeutralRamp,
  type NeutralRampStep,
  type RampStep,
} from './ramp';
export {
  accent,
  error,
  juniper,
  JUNIPER_500,
  neutral,
  persimmon,
  primary,
  ramps,
  secondary,
  success,
  warning,
  type RampName,
} from './ramps';
export {
  accessiblePalette,
  accessibleText,
  background,
  colors,
  ink,
  inkSoft,
  rule,
  text,
  type AccessibleTextColors,
  type BackgroundColors,
  type PaletteColors,
  type TextColors,
} from './colors';
export {
  accessibleTextStyles,
  baseTextStyles,
  fonts,
  letterSpacing,
  lineHeights,
  resolveTextStyle,
  sizes,
  typography,
  type FontToken,
  type LetterSpacingToken,
  type LineHeightToken,
  type ResolvedTextStyle,
  type SizeToken,
  type TextStyleName,
  type TextStyles,
  type TextStyleToken,
} from './typography';
export {
  accessibleTouchTarget,
  animation,
  baseTouchTarget,
  borderRadius,
  layout,
  shadows,
  spacing,
  type BorderRadiusToken,
  type ShadowName,
  type ShadowToken,
  type SpacingToken,
  type TouchTargetToken,
} from './tokens';
export { accessibleComponents, components, type Components } from './components';
export { theme, type SpecTheme } from './theme';
export {
  ACCESSIBLE_BUTTON_FILL_STEP,
  accessibleContrastPairs,
  accessibleTheme,
  baseTheme,
  firstAccessibleFillStep,
  themes,
  type AccessibleTheme,
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
  type ThemeColors,
  type ThemeVariant,
} from './themes';
export { ThemeProvider, useTheme, type ThemeProviderProps } from './provider';
