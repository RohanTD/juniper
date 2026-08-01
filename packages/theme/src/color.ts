/**
 * Color math for @juniper/theme.
 *
 * Two independent concerns live here:
 *  1. WCAG 2.x relative luminance + contrast ratio (the accessibility audit path,
 *     exported for tests and CI).
 *  2. sRGB <-> OKLab/OKLCH conversion (the perceptual space the ramp generator
 *     works in — OKLab lightness is far closer to perceived lightness than HSL's L).
 *
 * Pure TypeScript, no dependencies, no react-native imports.
 */

export interface Rgb {
  /** 0..1 */
  r: number;
  /** 0..1 */
  g: number;
  /** 0..1 */
  b: number;
}

export interface Oklch {
  /** perceptual lightness 0..1 */
  L: number;
  /** chroma, 0.. ~0.37 for sRGB */
  C: number;
  /** hue angle in degrees 0..360 */
  h: number;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    throw new Error(`Expected #RRGGBB hex color, got: ${hex}`);
  }
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

export function rgbToHex(rgb: Rgb): string {
  const to = (c: number): string => {
    const v = Math.round(Math.min(1, Math.max(0, c)) * 255);
    return v.toString(16).padStart(2, '0');
  };
  return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// WCAG 2.x
// ---------------------------------------------------------------------------

/** sRGB channel -> linear-light, per WCAG 2.x definition. */
function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a hex color, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG 2.x contrast ratio between two hex colors, 1..21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA: 4.5:1 for normal text, 3:1 for large text (>=18pt / >=14pt bold). */
export function meetsWcagAA(fg: string, bg: string, largeText = false): boolean {
  return contrastRatio(fg, bg) >= (largeText ? 3 : 4.5);
}

/** AAA: 7:1 normal, 4.5:1 large. Used for reporting, not enforcement. */
export function meetsWcagAAA(fg: string, bg: string, largeText = false): boolean {
  return contrastRatio(fg, bg) >= (largeText ? 4.5 : 7);
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson's reference implementation, transliterated)
// ---------------------------------------------------------------------------

interface Oklab {
  L: number;
  a: number;
  b: number;
}

function linearSrgbToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearSrgb(L: number, a: number, b: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function linearToSrgbChannel(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Hex -> OKLCH. */
export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const lab = linearSrgbToOklab(
    srgbChannelToLinear(r),
    srgbChannelToLinear(g),
    srgbChannelToLinear(b)
  );
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) {
    h += 360;
  }
  return { L: lab.L, C, h };
}

/** OKLab perceptual lightness of a hex color — used by the ramp monotonicity test. */
export function oklabLightness(hex: string): number {
  return hexToOklch(hex).L;
}

function oklchInGamut(L: number, C: number, h: number): Rgb | undefined {
  const hr = (h * Math.PI) / 180;
  const lin = oklabToLinearSrgb(L, C * Math.cos(hr), C * Math.sin(hr));
  const eps = 1e-6;
  if (
    lin.r < -eps || lin.r > 1 + eps ||
    lin.g < -eps || lin.g > 1 + eps ||
    lin.b < -eps || lin.b > 1 + eps
  ) {
    return undefined;
  }
  return {
    r: linearToSrgbChannel(Math.min(1, Math.max(0, lin.r))),
    g: linearToSrgbChannel(Math.min(1, Math.max(0, lin.g))),
    b: linearToSrgbChannel(Math.min(1, Math.max(0, lin.b))),
  };
}

/**
 * OKLCH -> hex. If the requested chroma is out of the sRGB gamut, chroma is
 * reduced (binary search) until it fits — lightness and hue are preserved,
 * which is exactly the property the ramp generator relies on.
 */
export function oklchToHex({ L, C, h }: Oklch): string {
  const direct = oklchInGamut(L, C, h);
  if (direct) {
    return rgbToHex(direct);
  }
  let lo = 0;
  let hi = C;
  let best: Rgb = oklchInGamut(L, 0, h) ?? { r: L, g: L, b: L };
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = oklchInGamut(L, mid, h);
    if (candidate) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return rgbToHex(best);
}
