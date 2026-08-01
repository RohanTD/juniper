/**
 * THEME_SYSTEM.md section 7 — the component recipes, verbatim.
 *
 * Pre-composed style objects: spread these into a component's style, then
 * override as needed. Values are derived from the token modules exactly as the
 * spec writes them, so a token change flows through automatically.
 *
 * `input.focused` is specified but not yet used by any Juniper screen (porting
 * note 4) — it stays here rather than being deleted.
 */
import { colors } from './colors';
import { borderRadius, shadows, spacing } from './tokens';
import { accessibleTextStyles, typography } from './typography';

export const components = {
  card: {
    base: {
      backgroundColor: colors.background.primary,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.rule,
    },
    elevated: {
      backgroundColor: colors.background.primary,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      ...shadows.base,
    },
    outlined: {
      backgroundColor: 'transparent',
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.rule,
    },
    /** dark/inverse card */
    ink: {
      backgroundColor: colors.ink,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
    },
  },
  button: {
    primary: {
      backgroundColor: colors.primary[500],
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      ...shadows.primary,
    },
    secondary: {
      backgroundColor: colors.ink,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    accent: {
      backgroundColor: colors.accent[500],
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      ...shadows.accent,
    },
    outline: {
      backgroundColor: 'transparent',
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderWidth: 1.5,
      borderColor: colors.rule,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
  },
  input: {
    base: {
      backgroundColor: colors.background.secondary,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.rule,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
      fontSize: typography.sizes.base as number,
      fontFamily: typography.fonts.regular as string,
      color: colors.text.primary,
    },
    focused: {
      borderColor: colors.primary[500],
      borderWidth: 1.5,
    },
  },
  badge: {
    success: {
      backgroundColor: colors.success[50],
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    },
    warning: {
      backgroundColor: colors.warning[50],
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    },
    error: {
      backgroundColor: colors.error[50],
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    },
    info: {
      backgroundColor: colors.secondary[50],
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    },
  },
};

export type Components = typeof components;

/**
 * The same recipes for patient-facing surfaces. Only `input.base`'s type
 * differs, and only because porting note 2c forbids text a patient must read
 * from sitting below 16px — `input.base` is the one recipe in section 7 that
 * bakes a font size in. Everything else is the spec's set unchanged.
 */
export const accessibleComponents: Components = {
  ...components,
  input: {
    ...components.input,
    base: {
      ...components.input.base,
      fontSize: accessibleTextStyles.body.fontSize,
      fontFamily: accessibleTextStyles.body.fontFamily,
    },
  },
};
