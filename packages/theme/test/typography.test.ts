import { describe, expect, it } from 'vitest';
import {
  accessibleTextStyles,
  baseTextStyles,
  fonts,
  resolveTextStyle,
  sizes,
  type TextStyles,
} from '../src/typography';
import { accessibleTheme, baseTheme } from '../src/themes';

function eachStyle(styles: TextStyles): Array<[string, TextStyles[keyof TextStyles]]> {
  return Object.entries(styles);
}

describe('line heights are multipliers, never fixed px', () => {
  it('holds for both variants', () => {
    for (const styles of [baseTextStyles, accessibleTextStyles]) {
      for (const [name, style] of eachStyle(styles)) {
        // A px value would be >= the font size (e.g. 22); a multiplier sits in a
        // narrow human range. Anything >= 3 is certainly px and a regression.
        expect(style.lineHeight, `${name}.lineHeight must be a multiplier`).toBeGreaterThan(1);
        expect(style.lineHeight, `${name}.lineHeight must be a multiplier`).toBeLessThan(2);
      }
    }
  });

  it('computed line height scales proportionally at 2x font scale', () => {
    for (const styles of [baseTextStyles, accessibleTextStyles]) {
      for (const [name, style] of eachStyle(styles)) {
        const at1 = resolveTextStyle(style, 1);
        const at2 = resolveTextStyle(style, 2);
        expect(at2.fontSize, name).toBe(at1.fontSize * 2);
        expect(at2.lineHeight, name).toBeCloseTo(at1.lineHeight * 2, 6);
        if (at1.letterSpacing !== undefined) {
          expect(at2.letterSpacing, name).toBeCloseTo(at1.letterSpacing * 2, 6);
        }
        // Line height in px always clears the scaled font size — no clipping.
        expect(at2.lineHeight, name).toBeGreaterThan(at2.fontSize);
      }
    }
  });

  it('resolves against the SCALED size, not the nominal one', () => {
    const body = baseTextStyles.body; // 15 x 1.5
    expect(resolveTextStyle(body, 1)).toMatchObject({ fontSize: 15, lineHeight: 22.5 });
    expect(resolveTextStyle(body, 2)).toMatchObject({ fontSize: 30, lineHeight: 45 });
  });
});

describe('accessible type-scale floor (porting note 2c)', () => {
  it('has no text below 13px anywhere', () => {
    for (const [name, style] of eachStyle(accessibleTextStyles)) {
      expect(style.fontSize, name).toBeGreaterThanOrEqual(sizes.sm);
    }
  });

  it('nothing a patient must read sits below 16px', () => {
    for (const name of ['body', 'bodyLarge', 'bodySmall', 'caption', 'button'] as const) {
      expect(accessibleTextStyles[name].fontSize, name).toBeGreaterThanOrEqual(sizes.md);
    }
  });

  it('metadata recipes stop at the 13px floor rather than growing to 16', () => {
    expect(accessibleTextStyles.label.fontSize).toBe(sizes.sm);
    expect(accessibleTextStyles.meta.fontSize).toBe(sizes.sm);
  });

  it('the base variant keeps the spec\'s 11px mono label (family app may use it)', () => {
    expect(baseTextStyles.label.fontSize).toBe(sizes.xs);
    expect(baseTextStyles.meta.fontSize).toBe(sizes.xs);
  });
});

describe('font roles are fixed', () => {
  it('display uses Instrument Serif only; body/UI use Outfit; label/meta use IBM Plex Mono', () => {
    for (const theme of [baseTheme, accessibleTheme]) {
      const s = theme.textStyles;
      for (const d of [s.displayLarge, s.display, s.displayItalic]) {
        expect(d.fontFamily).toContain('InstrumentSerif');
      }
      for (const b of [s.h1, s.h2, s.h3, s.h4, s.bodyLarge, s.body, s.bodySmall, s.caption, s.button]) {
        expect(b.fontFamily).toContain('Outfit');
      }
      for (const m of [s.label, s.meta]) {
        expect(m.fontFamily).toContain('IBMPlexMono');
      }
      // Only `label` is the uppercase tracked one; `meta` is fine print.
      expect(s.label.textTransform).toBe('uppercase');
      expect(s.meta.textTransform).toBeUndefined();
    }
  });

  it('body copy never uses a display or mono family', () => {
    for (const styles of [baseTextStyles, accessibleTextStyles]) {
      for (const name of ['bodyLarge', 'body', 'bodySmall'] as const) {
        expect(styles[name].fontFamily).toBe(fonts.regular);
      }
    }
  });

  it('touch targets are larger in the accessible variant (44 -> 56)', () => {
    expect(baseTheme.touchTarget.minHeight).toBe(44);
    expect(accessibleTheme.touchTarget.minHeight).toBe(56);
    expect(accessibleTheme.recipes.button.primary.minHeight).toBeGreaterThanOrEqual(56);
    expect(accessibleTheme.recipes.listRow.minHeight).toBeGreaterThanOrEqual(56);
  });
});
