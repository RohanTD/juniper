import { describe, expect, it } from 'vitest';
import {
  accessibleTextStyles,
  baseTextStyles,
  resolveTextStyle,
  type TextStyles,
} from '../src/tokens';
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
});

describe('accessible type-scale floor', () => {
  it('has no 11px text anywhere', () => {
    for (const [name, style] of eachStyle(accessibleTextStyles)) {
      expect(style.fontSize, name).toBeGreaterThanOrEqual(13);
    }
  });

  it('body text is at least 16, labels at least 13', () => {
    expect(accessibleTextStyles.body.fontSize).toBeGreaterThanOrEqual(16);
    expect(accessibleTextStyles.bodyLg.fontSize).toBeGreaterThanOrEqual(16);
    expect(accessibleTextStyles.bodySm.fontSize).toBeGreaterThanOrEqual(16);
    expect(accessibleTextStyles.caption.fontSize).toBeGreaterThanOrEqual(16);
    expect(accessibleTextStyles.label.fontSize).toBeGreaterThanOrEqual(13);
    expect(accessibleTextStyles.eyebrow.fontSize).toBeGreaterThanOrEqual(13);
  });

  it('the base variant keeps the original 11px mono label (family app may use it)', () => {
    expect(baseTextStyles.label.fontSize).toBe(11);
  });
});

describe('font roles are fixed', () => {
  it('display styles use Instrument Serif only; body/UI use Outfit; labels use IBM Plex Mono', () => {
    for (const theme of [baseTheme, accessibleTheme]) {
      const s = theme.textStyles;
      for (const d of [s.displayXl, s.displayLg, s.displayMd]) {
        expect(d.fontFamily).toContain('InstrumentSerif');
      }
      for (const b of [s.title, s.headline, s.body, s.bodyLg, s.bodySm, s.button, s.caption]) {
        expect(b.fontFamily).toContain('Outfit');
      }
      for (const m of [s.label, s.eyebrow]) {
        expect(m.fontFamily).toContain('IBMPlexMono');
        expect(m.textTransform).toBe('uppercase');
      }
    }
  });

  it('touch targets are larger in the accessible variant', () => {
    expect(accessibleTheme.touchTarget.minHeight).toBeGreaterThanOrEqual(56);
    expect(accessibleTheme.recipes.button.primary.minHeight).toBeGreaterThanOrEqual(56);
  });
});
