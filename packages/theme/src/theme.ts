/**
 * THEME_SYSTEM.md section 10, step 2: "export a combined `theme` default
 * object" carrying sections 2–8.
 *
 * This is the spec's own flat token object. Juniper screens consume the
 * per-variant themes from `./themes` (`useTheme()`), which layer the accessible
 * variant and the app-facing recipes on top of exactly these tokens — but this
 * object is the direct, unlayered port and is what the spec-fidelity test
 * measures against.
 */
import { colors } from './colors';
import { components } from './components';
import { animation, borderRadius, layout, shadows, spacing } from './tokens';
import { baseTextStyles, typography } from './typography';

export const theme = {
  colors,
  typography,
  textStyles: baseTextStyles,
  spacing,
  borderRadius,
  shadows,
  components,
  layout,
  animation,
} as const;

export type SpecTheme = typeof theme;
