import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsWcagAA, relativeLuminance } from '../src/color';
import { juniper, persimmon } from '../src/ramps';
import {
  ACCESSIBLE_BUTTON_FILL_STEP,
  accessibleContrastPairs,
  accessibleTheme,
  baseTheme,
  firstAccessibleFillStep,
} from '../src/themes';

describe('WCAG utility', () => {
  it('computes the spec anchors', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('matches known reference ratios', () => {
    // #767676 on white is the canonical "just passes AA" grey (~4.54:1).
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThan(4.5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
    // The values the porting notes are argued from:
    expect(contrastRatio('#5A5A66', '#FFFFFF')).toBeCloseTo(6.8, 1); // text.secondary
    expect(contrastRatio('#9E9EA7', '#FFFFFF')).toBeCloseTo(2.66, 1); // text.tertiary
  });

  it('is order-independent and applies large-text thresholds', () => {
    expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(contrastRatio('#FEDCBA', '#123456'), 10);
    expect(meetsWcagAA('#9E9EA7', '#FFFFFF')).toBe(false);
    expect(meetsWcagAA('#949494', '#FFFFFF', true)).toBe(true); // ~3.0:1 large-text pass
  });
});

describe('accessible variant contrast audit', () => {
  it('audits a non-trivial number of pairs', () => {
    // Guards against the audit silently shrinking to nothing.
    expect(accessibleContrastPairs().length).toBeGreaterThan(20);
  });

  it('every declared fg/bg pair meets AA (4.5:1 normal, 3:1 large)', () => {
    const failures: string[] = [];
    for (const pair of accessibleContrastPairs()) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      const threshold = pair.large ? 3 : 4.5;
      if (ratio < threshold) {
        failures.push(`${pair.name}: ${ratio.toFixed(2)}:1 < ${threshold}:1 (${pair.fg} on ${pair.bg})`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the primary button fill/text pair passes AA, measured', () => {
    const { background, text } = accessibleTheme.recipes.button.primary;
    const ratio = contrastRatio(text, background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // The fill must be the FIRST juniper step that actually clears 4.5:1 —
    // recomputed against the real ramp, not assumed from the persimmon numbers.
    expect(background).toBe(juniper[ACCESSIBLE_BUTTON_FILL_STEP]);
    expect(ACCESSIBLE_BUTTON_FILL_STEP).toBe(firstAccessibleFillStep(juniper, text));
  });

  it('the fill step is computed per-hue: 500 for juniper, 600 for persimmon', () => {
    // Porting note 2b: the "use the 600 step" advice is hue-specific and must
    // never be hardcoded. Juniper 500 measures 6.00:1 and passes on its own.
    expect(ACCESSIBLE_BUTTON_FILL_STEP).toBe(500);
    expect(contrastRatio('#FFFFFF', juniper[500])).toBeCloseTo(6.0, 1);
    expect(firstAccessibleFillStep(persimmon, '#FFFFFF')).toBe(600);
  });

  it('FAILS if text.tertiary is reintroduced into the accessible variant', () => {
    // The accessible variant deliberately has no tertiary text token: 2.7:1 on
    // white. If this test fails, someone put it back — do not weaken the test.
    expect('tertiary' in accessibleTheme.colors.text).toBe(false);
    expect(
      (accessibleTheme.colors.text as unknown as Record<string, unknown>).tertiary
    ).toBeUndefined();
    // And nothing anywhere in the variant — colors, components or recipes — may
    // reach for the raw hex either. (#9E9EA7 is not a step of any spec ramp, so
    // stringifying the whole theme is a safe way to look for it.)
    expect(JSON.stringify(accessibleTheme)).not.toContain('#9E9EA7');
  });

  it('the base variant still carries text.tertiary, as the spec requires', () => {
    // The removal is scoped to patient-facing surfaces only; the spec token
    // itself must survive on the base variant.
    expect(accessibleTheme.name).toBe('accessible');
    expect(baseTheme.name).toBe('base');
    expect(baseTheme.colors.text.tertiary).toBe('#9E9EA7');
  });
});
