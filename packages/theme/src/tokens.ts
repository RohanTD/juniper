/**
 * THEME_SYSTEM.md sections 4, 5, 6 and 8 — spacing, border radius, shadows,
 * layout and animation.
 *
 * Pure data — no react-native import. Shadow objects are shaped like RN shadow
 * style props (plus `elevation` for Android) but are plain objects; web can map
 * them to box-shadow.
 *
 * The only deviation from the spec in this file is porting note 1:
 * `shadows.primary` / `shadows.accent` take the Juniper brand hex as their
 * shadowColor, since they are documented as "= primary[500]" / "= accent[500]".
 */
import { JUNIPER_500 } from './ramps';

// ---------------------------------------------------------------------------
// Section 4 — spacing. 8-point-ish, slightly irregular at the edges.
// `base` (16) is the default screen-edge and card padding; `lg`/`xl` are
// section gaps.
// ---------------------------------------------------------------------------

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 64,
} as const;

export type SpacingToken = keyof typeof spacing;

// ---------------------------------------------------------------------------
// Section 5 — border radius. Cards and buttons use `md` (10) or `lg` (14);
// pills/badges/avatars use `full`.
// ---------------------------------------------------------------------------

export const borderRadius = {
  none: 0,
  sm: 4,
  base: 6,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 24,
  full: 9999,
} as const;

export type BorderRadiusToken = keyof typeof borderRadius;

// ---------------------------------------------------------------------------
// Section 6 — shadows. Subtle, soft, low-opacity; never harsh drop shadows.
// Default card elevation is `sm` or `base`; reserve `lg`/`xl` for modals and
// floating elements.
// ---------------------------------------------------------------------------

export interface ShadowToken {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export type ShadowName = 'none' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | 'primary' | 'accent';

export const shadows: Record<ShadowName, ShadowToken> = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  base: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  },
  // Colored shadow variants for primary-colored elements (e.g. a floating CTA).
  primary: {
    shadowColor: JUNIPER_500, // = primary[500] (porting note 1)
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  accent: {
    shadowColor: JUNIPER_500, // = accent[500] (porting note 1)
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
};

// ---------------------------------------------------------------------------
// Section 8 — layout & animation constants
// ---------------------------------------------------------------------------

export const layout = {
  containerPadding: spacing.lg, // 20
  headerHeight: 60,
  bottomTabHeight: 80,
  maxContentWidth: 600,
} as const;

export const animation = {
  fast: 150,
  normal: 260,
  slow: 420,
  slower: 640,
  spring: { damping: 16, stiffness: 180 },
} as const;

// ---------------------------------------------------------------------------
// Touch targets — porting note 2c. Not a spec token; the spec never states a
// minimum. 44 is the platform floor; patient-facing surfaces get 56.
// ---------------------------------------------------------------------------

export interface TouchTargetToken {
  minHeight: number;
  minWidth: number;
}

export const baseTouchTarget: TouchTargetToken = { minHeight: 44, minWidth: 44 };
/** Patient-facing surfaces get larger targets. */
export const accessibleTouchTarget: TouchTargetToken = { minHeight: 56, minWidth: 56 };
