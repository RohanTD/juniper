import { describe, expect, it } from 'vitest';
import { contrastRatio, oklabLightness } from '../src/color';
import { generateRamp, RAMP_STEPS } from '../src/ramp';
import { accent, juniper, JUNIPER_500, neutral, persimmon, ramps } from '../src/ramps';

describe('ramp generator', () => {
  it('produces exactly 10 steps, 50..900', () => {
    const ramp = generateRamp('#3366AA');
    expect(Object.keys(ramp)).toHaveLength(10);
    for (const step of RAMP_STEPS) {
      expect(ramp[step]).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(RAMP_STEPS).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('step 500 is the input hex verbatim', () => {
    expect(generateRamp('#3366AA')[500]).toBe('#3366AA');
    expect(generateRamp('#e8572a')[500]).toBe('#E8572A');
  });

  it('lightness is strictly monotonic (decreasing) for representative hues', () => {
    for (const brand of [JUNIPER_500, '#E8572A', '#1F7A4D', '#C0392B', '#8A5A00', '#2B6CB0']) {
      const ramp = generateRamp(brand);
      const ladder = RAMP_STEPS.map((s) => oklabLightness(ramp[s]));
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i], `${brand}: step ${RAMP_STEPS[i]} vs ${RAMP_STEPS[i - 1]}`).toBeLessThan(
          ladder[i - 1]
        );
      }
    }
  });
});

describe('juniper brand ramp', () => {
  it('500 is the chosen brand hex', () => {
    expect(JUNIPER_500).toBe('#2C6E5E');
    expect(juniper[500]).toBe(JUNIPER_500);
  });

  it('accent duplicates the juniper ramp as literals, per the theme note', () => {
    // accent is written as literals; this pins them to the generator output so
    // a brand change cannot silently leave stale literals behind.
    expect(accent).toEqual(juniper);
    expect(accent).not.toBe(juniper);
  });

  it('neutral ramp lightness is monotonic and carries the documented tokens', () => {
    const ladder = RAMP_STEPS.map((s) => oklabLightness(neutral[s]));
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeLessThan(ladder[i - 1]);
    }
    expect(neutral[600]).toBe('#5A5A66'); // text.secondary
    expect(neutral[400]).toBe('#9E9EA7'); // text.tertiary (base variant only)
  });
});

describe('persimmon reference ramp (Thoracle original)', () => {
  it('pins the two documented literals', () => {
    expect(persimmon[500]).toBe('#E8572A');
    expect(persimmon[600]).toBe('#CC4520');
  });

  it("reproduces THEME_SYSTEM.md's contrast findings", () => {
    // White on persimmon 500 fails AA for normal text (~3.6:1)…
    expect(contrastRatio('#FFFFFF', persimmon[500])).toBeCloseTo(3.6, 1);
    expect(contrastRatio('#FFFFFF', persimmon[500])).toBeLessThan(4.5);
    // …and the 600 step is the documented fix (~4.7:1).
    expect(contrastRatio('#FFFFFF', persimmon[600])).toBeCloseTo(4.73, 1);
    expect(contrastRatio('#FFFFFF', persimmon[600])).toBeGreaterThanOrEqual(4.5);
  });

  it('is exposed under ramps.persimmon for reference', () => {
    expect(ramps.persimmon).toBe(persimmon);
  });
});
