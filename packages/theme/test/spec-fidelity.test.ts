/**
 * SPEC FIDELITY — every token in THEME_SYSTEM.md sections 1–8, asserted against
 * the spec's own literal tables rather than against whatever `src/` happens to
 * contain.
 *
 * This file exists because `packages/theme` was once built from a
 * RECONSTRUCTION of the spec rather than the spec itself, and the two diverged
 * silently: a different spacing scale, different radii, four shadow steps
 * instead of eight, a neutral ramp with the wrong values and no `0` step, no
 * `secondary` ramp at all, generated semantic ramps instead of the documented
 * ones, and an invented set of text-style names. Nothing in the code caught it.
 *
 * The literals below are transcribed from THEME_SYSTEM.md by hand and must be
 * changed ONLY when that document changes. Deviations are permitted exactly
 * where the "Juniper porting notes" section permits them, and each such site is
 * marked `PORTING NOTE n` below.
 */
import { describe, expect, it } from 'vitest';
import { colors } from '../src/colors';
import { accessibleComponents, components } from '../src/components';
import {
  accent,
  error,
  juniper,
  JUNIPER_500,
  neutral,
  persimmon,
  primary,
  secondary,
  success,
  warning,
} from '../src/ramps';
import { theme } from '../src/theme';
import { animation, borderRadius, layout, shadows, spacing } from '../src/tokens';
import {
  accessibleTextStyles,
  baseTextStyles,
  fonts,
  letterSpacing,
  lineHeights,
  sizes,
  typography,
} from '../src/typography';

// ---------------------------------------------------------------------------
// Section 1 — fonts
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 1 — font family map', () => {
  it('is the spec\'s `typography.fonts` object exactly', () => {
    expect(fonts).toEqual({
      regular: 'Outfit_400Regular',
      medium: 'Outfit_500Medium',
      semiBold: 'Outfit_600SemiBold',
      bold: 'Outfit_700Bold',
      display: 'InstrumentSerif_400Regular',
      displayItalic: 'InstrumentSerif_400Regular_Italic',
      mono: 'IBMPlexMono_400Regular',
      monoMedium: 'IBMPlexMono_500Medium',
      monoItalic: 'IBMPlexMono_400Italic',
      italic: 'InstrumentSerif_400Regular_Italic',
    });
  });

  it('keeps the documented key rename and the serif-italic fallback', () => {
    // The spec loads IBMPlexMono_400Regular_Italic under the key
    // IBMPlexMono_400Italic ("note the key rename").
    expect(fonts.monoItalic).toBe('IBMPlexMono_400Italic');
    // Outfit has no italic, so `italic` falls back to the serif italic.
    expect(fonts.italic).toBe(fonts.displayItalic);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — color palette
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 2 — color palette', () => {
  it('secondary is the spec slate-blue ramp (the reconstruction omitted it entirely)', () => {
    expect(secondary).toEqual({
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
    });
  });

  it('success is the spec ramp, not a generated one', () => {
    expect(success).toEqual({
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
    });
  });

  it('warning is the spec ramp, not a generated one', () => {
    expect(warning).toEqual({
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
    });
  });

  it('error is the spec ramp, not a generated one', () => {
    expect(error).toEqual({
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
    });
  });

  it('neutral is the spec ramp INCLUDING the extra 0 step', () => {
    expect(neutral).toEqual({
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
    });
    // The reconstruction had no 0 step and a different 400/500/700/800/900.
    expect(neutral[0]).toBe('#FFFFFF');
    expect(neutral[400]).toBe('#B0B0B8');
    expect(neutral[500]).toBe('#7E7E8A');
    expect(neutral[700]).toBe('#3D3D47');
    expect(neutral[800]).toBe('#27272D');
    expect(neutral[900]).toBe('#111114');
  });

  it('background / text / rule / ink / inkSoft are the spec literals', () => {
    expect(colors.background).toEqual({
      primary: '#FFFFFF',
      secondary: '#FAFAFA',
      tertiary: '#F5F5F6',
      dark: '#111114',
    });
    expect(colors.text).toEqual({
      primary: '#111114',
      secondary: '#5A5A66',
      tertiary: '#9E9EA7',
      inverse: '#FFFFFF',
      accent: primary[500], // spec: "= primary[500]" — PORTING NOTE 1 makes this juniper
    });
    expect(colors.rule).toBe('#EBEBED');
    expect(colors.ink).toBe('#111114');
    expect(colors.inkSoft).toBe('#5A5A66');
    // The spec's own identities.
    expect(colors.ink).toBe(colors.text.primary);
    expect(colors.inkSoft).toBe(colors.text.secondary);
  });

  it('persimmon is retained verbatim as the reference ramp', () => {
    expect(persimmon).toEqual({
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
    });
  });

  it('PORTING NOTE 1: primary and accent carry the generated juniper ramp, not persimmon', () => {
    expect(JUNIPER_500).toBe('#2C6E5E');
    expect(primary).toBe(juniper);
    expect(accent).toEqual(juniper);
    expect(colors.primary[500]).toBe('#2C6E5E');
    expect(colors.accent[500]).toBe('#2C6E5E');
    expect(colors.primary).not.toEqual(persimmon);
  });
});

// ---------------------------------------------------------------------------
// Section 3 — typography scale
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 3 — typography scale', () => {
  it('sizes are the spec scale exactly', () => {
    expect(sizes).toEqual({
      xs: 11,
      sm: 13,
      base: 15,
      md: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
      '4xl': 38,
      '5xl': 48,
      '6xl': 64,
    });
  });

  it('lineHeights are the spec ratios exactly', () => {
    expect(lineHeights).toEqual({ tight: 1.15, snug: 1.3, normal: 1.5, relaxed: 1.7 });
  });

  it('letterSpacing is the spec scale exactly', () => {
    expect(letterSpacing).toEqual({
      tighter: -0.8,
      tight: -0.4,
      normal: 0,
      wide: 0.6,
      wider: 1.4,
      widest: 2.4,
    });
  });

  it('typography bundles fonts + sizes + lineHeights + letterSpacing', () => {
    expect(typography).toEqual({ fonts, sizes, lineHeights, letterSpacing });
  });
});

describe('THEME_SYSTEM.md section 3 — text style recipe table', () => {
  /** Style -> [font token, size token] straight from the spec's table. */
  const TABLE: Array<[keyof typeof baseTextStyles, keyof typeof fonts, keyof typeof sizes]> = [
    ['displayLarge', 'display', '6xl'],
    ['display', 'display', '5xl'],
    ['displayItalic', 'displayItalic', '4xl'],
    ['h1', 'bold', '3xl'],
    ['h2', 'bold', '2xl'],
    ['h3', 'semiBold', 'xl'],
    ['h4', 'semiBold', 'lg'],
    ['bodyLarge', 'regular', 'lg'],
    ['body', 'regular', 'base'],
    ['bodySmall', 'regular', 'sm'],
    ['label', 'monoMedium', 'xs'],
    ['meta', 'mono', 'xs'],
    ['caption', 'regular', 'xs'],
    ['button', 'semiBold', 'base'],
  ];

  it('has exactly the spec\'s recipe names — no invented ones', () => {
    expect(Object.keys(baseTextStyles).sort()).toEqual(TABLE.map(([n]) => n).sort());
    // The reconstruction's invented names must be gone.
    for (const gone of ['displayXl', 'displayLg', 'displayMd', 'title', 'headline', 'bodyLg', 'bodySm', 'eyebrow']) {
      expect(baseTextStyles as Record<string, unknown>).not.toHaveProperty(gone);
    }
  });

  it('pairs each recipe with the spec\'s font and size', () => {
    for (const [style, font, size] of TABLE) {
      expect(baseTextStyles[style].fontFamily, `${style}.fontFamily`).toBe(fonts[font]);
      expect(baseTextStyles[style].fontSize, `${style}.fontSize`).toBe(sizes[size]);
    }
  });

  it('composes every recipe out of the lineHeights / letterSpacing tokens', () => {
    const lh = Object.values(lineHeights) as number[];
    const ls = Object.values(letterSpacing) as number[];
    for (const styles of [baseTextStyles, accessibleTextStyles]) {
      for (const [name, style] of Object.entries(styles)) {
        expect(lh, `${name}.lineHeight is not a lineHeights token`).toContain(style.lineHeight);
        expect(ls, `${name}.letterSpacing is not a letterSpacing token`).toContain(
          style.letterSpacing
        );
        expect(Object.values(sizes) as number[], `${name}.fontSize is not a sizes token`).toContain(
          style.fontSize
        );
      }
    }
  });

  it('label is monoMedium + xs + uppercase + widest tracking', () => {
    expect(baseTextStyles.label).toEqual({
      fontFamily: fonts.monoMedium,
      fontSize: sizes.xs,
      lineHeight: lineHeights.snug,
      letterSpacing: letterSpacing.widest,
      textTransform: 'uppercase',
    });
  });

  it('button is semiBold + base + wide tracking', () => {
    expect(baseTextStyles.button.fontFamily).toBe(fonts.semiBold);
    expect(baseTextStyles.button.fontSize).toBe(sizes.base);
    expect(baseTextStyles.button.letterSpacing).toBe(letterSpacing.wide);
  });

  it('PORTING NOTE 2c: the accessible variant raises sizes and changes nothing else', () => {
    for (const name of Object.keys(baseTextStyles) as Array<keyof typeof baseTextStyles>) {
      const base = baseTextStyles[name];
      const accessible = accessibleTextStyles[name];
      expect(accessible.fontFamily, `${name}.fontFamily`).toBe(base.fontFamily);
      expect(accessible.lineHeight, `${name}.lineHeight`).toBe(base.lineHeight);
      expect(accessible.letterSpacing, `${name}.letterSpacing`).toBe(base.letterSpacing);
      expect(accessible.textTransform, `${name}.textTransform`).toBe(base.textTransform);
      expect(accessible.fontSize, `${name}.fontSize may only be raised`).toBeGreaterThanOrEqual(
        base.fontSize
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4 — spacing
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 4 — spacing', () => {
  it('is the spec scale exactly (the reconstruction used xxs/xxl/xxxl and lg=16)', () => {
    expect(spacing).toEqual({
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
    });
    expect(spacing.lg).toBe(20);
    expect(spacing.base).toBe(16);
    for (const gone of ['xxs', 'xxl', 'xxxl']) {
      expect(spacing as Record<string, unknown>).not.toHaveProperty(gone);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 5 — border radius
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 5 — border radius', () => {
  it('is the spec scale exactly, with `full` and not `pill`', () => {
    expect(borderRadius).toEqual({
      none: 0,
      sm: 4,
      base: 6,
      md: 10,
      lg: 14,
      xl: 18,
      '2xl': 24,
      full: 9999,
    });
    expect(borderRadius.full).toBe(9999);
    expect(borderRadius as Record<string, unknown>).not.toHaveProperty('pill');
  });
});

// ---------------------------------------------------------------------------
// Section 6 — shadows
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 6 — shadows', () => {
  it('has all six elevation steps plus the two colored variants', () => {
    expect(Object.keys(shadows)).toEqual([
      'none',
      'sm',
      'base',
      'md',
      'lg',
      'xl',
      'primary',
      'accent',
    ]);
  });

  it('every elevation step matches the spec offsets / opacities / radii / elevations', () => {
    expect(shadows.none).toEqual({
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    });
    expect(shadows.sm).toEqual({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 1,
    });
    expect(shadows.base).toEqual({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
    });
    expect(shadows.md).toEqual({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    });
    expect(shadows.lg).toEqual({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 8,
    });
    expect(shadows.xl).toEqual({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.14,
      shadowRadius: 28,
      elevation: 12,
    });
  });

  it('PORTING NOTE 1: the colored variants keep the spec geometry with the juniper hex', () => {
    const colored = {
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 4,
    };
    expect(shadows.primary).toEqual({ shadowColor: JUNIPER_500, ...colored });
    expect(shadows.accent).toEqual({ shadowColor: JUNIPER_500, ...colored });
    expect(shadows.primary.shadowColor).toBe(colors.primary[500]);
    expect(shadows.accent.shadowColor).toBe(colors.accent[500]);
  });
});

// ---------------------------------------------------------------------------
// Section 7 — component recipes
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 7 — component recipes', () => {
  it('card has base / elevated / outlined / ink exactly as written', () => {
    expect(components.card.base).toEqual({
      backgroundColor: colors.background.primary,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.rule,
    });
    expect(components.card.elevated).toEqual({
      backgroundColor: colors.background.primary,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      ...shadows.base,
    });
    expect(components.card.outlined).toEqual({
      backgroundColor: 'transparent',
      borderRadius: borderRadius.lg,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.rule,
    });
    expect(components.card.ink).toEqual({
      backgroundColor: colors.ink,
      borderRadius: borderRadius.lg,
      padding: spacing.base,
    });
  });

  it('button has primary / secondary / accent / outline / ghost exactly as written', () => {
    expect(Object.keys(components.button)).toEqual([
      'primary',
      'secondary',
      'accent',
      'outline',
      'ghost',
    ]);
    const box = {
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    };
    expect(components.button.primary).toEqual({
      backgroundColor: colors.primary[500],
      ...box,
      ...shadows.primary,
    });
    expect(components.button.secondary).toEqual({ backgroundColor: colors.ink, ...box });
    expect(components.button.accent).toEqual({
      backgroundColor: colors.accent[500],
      ...box,
      ...shadows.accent,
    });
    expect(components.button.outline).toEqual({
      backgroundColor: 'transparent',
      ...box,
      borderWidth: 1.5,
      borderColor: colors.rule,
    });
    expect(components.button.ghost).toEqual({ backgroundColor: 'transparent', ...box });
  });

  it('input has base and focused exactly as written', () => {
    expect(components.input.base).toEqual({
      backgroundColor: colors.background.secondary,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.rule,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
      fontSize: sizes.base,
      fontFamily: fonts.regular,
      color: colors.text.primary,
    });
    expect(components.input.focused).toEqual({
      borderColor: colors.primary[500],
      borderWidth: 1.5,
    });
  });

  it('badge has success / warning / error / info exactly as written', () => {
    const box = {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    };
    expect(components.badge.success).toEqual({ backgroundColor: colors.success[50], ...box });
    expect(components.badge.warning).toEqual({ backgroundColor: colors.warning[50], ...box });
    expect(components.badge.error).toEqual({ backgroundColor: colors.error[50], ...box });
    // info draws on the `secondary` slate ramp, which is why the ramp must exist.
    expect(components.badge.info).toEqual({ backgroundColor: colors.secondary[50], ...box });
  });

  it('only `rule` is used for borders — never a second gray', () => {
    const borders = [
      components.card.base.borderColor,
      components.card.outlined.borderColor,
      components.button.outline.borderColor,
      components.input.base.borderColor,
    ];
    expect(new Set(borders)).toEqual(new Set([colors.rule]));
  });

  it('PORTING NOTE 2c: the accessible component set differs only in input.base type', () => {
    expect(accessibleComponents.card).toEqual(components.card);
    expect(accessibleComponents.button).toEqual(components.button);
    expect(accessibleComponents.badge).toEqual(components.badge);
    expect(accessibleComponents.input.focused).toEqual(components.input.focused);
    expect(accessibleComponents.input.base.fontSize).toBeGreaterThanOrEqual(16);
    expect({ ...accessibleComponents.input.base, fontSize: sizes.base }).toEqual(
      components.input.base
    );
  });
});

// ---------------------------------------------------------------------------
// Section 8 — layout & animation
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 8 — layout & animation', () => {
  it('layout is the spec object exactly', () => {
    expect(layout).toEqual({
      containerPadding: 20,
      headerHeight: 60,
      bottomTabHeight: 80,
      maxContentWidth: 600,
    });
    expect(layout.containerPadding).toBe(spacing.lg);
  });

  it('animation is the spec object exactly', () => {
    expect(animation).toEqual({
      fast: 150,
      normal: 260,
      slow: 420,
      slower: 640,
      spring: { damping: 16, stiffness: 180 },
    });
  });
});

// ---------------------------------------------------------------------------
// Section 10 — the combined export
// ---------------------------------------------------------------------------

describe('THEME_SYSTEM.md section 10 — combined theme export', () => {
  it('carries every token group sections 2-8 name', () => {
    expect(Object.keys(theme).sort()).toEqual(
      [
        'animation',
        'borderRadius',
        'colors',
        'components',
        'layout',
        'shadows',
        'spacing',
        'textStyles',
        'typography',
      ].sort()
    );
    expect(theme.colors).toBe(colors);
    expect(theme.spacing).toBe(spacing);
    expect(theme.borderRadius).toBe(borderRadius);
    expect(theme.shadows).toBe(shadows);
    expect(theme.components).toBe(components);
    expect(theme.layout).toBe(layout);
    expect(theme.animation).toBe(animation);
    expect(theme.textStyles).toBe(baseTextStyles);
  });
});
