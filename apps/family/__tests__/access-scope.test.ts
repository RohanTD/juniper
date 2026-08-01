/**
 * The caregiver access boundary, enforced at the source level.
 *
 * The server-side AccessPolicy is the real control: it admits only the
 * `juniper-family-summary` category and hides the clinical note and the raw
 * transcript outright. This test guards the client side of that contract — a
 * caregiver must never be one URL guess (or one stray query) away from a full
 * recording of their parent's conversation, and a code path that *tries* to
 * read one would render as a confusing error rather than a graceful empty
 * state.
 *
 * It also enforces the "no charts" constraint: with writes limited to notes
 * there is no structured data to trend, so charting components would be
 * mocked-up UI with nothing behind them.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'src'];

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function scanSources(): { file: string; line: number; text: string }[] {
  const rows: { file: string; line: number; text: string }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectSourceFiles(path.join(APP_ROOT, dir))) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((text, index) => {
          rows.push({ file: path.relative(APP_ROOT, file), line: index + 1, text });
        });
    }
  }
  return rows;
}

const SOURCES = scanSources();

function offenders(pattern: RegExp): string[] {
  return SOURCES.filter(
    (row) => pattern.test(row.text) && !row.text.trimStart().startsWith('*')
  ).map((row) => `${row.file}:${row.line}: ${row.text.trim()}`);
}

describe('caregiver access scope', () => {
  it('never references the clinical note category', () => {
    expect(offenders(/juniper-note|NOTE_CATEGORY\.note\b/)).toEqual([]);
  });

  it('never references the raw transcript category', () => {
    expect(offenders(/juniper-transcript|NOTE_CATEGORY\.transcript\b/)).toEqual([]);
  });

  it('reads only the family-summary document category', () => {
    const categoryUses = SOURCES.filter((row) => /NOTE_CATEGORY\./.test(row.text));
    expect(categoryUses.length).toBeGreaterThan(0);
    for (const row of categoryUses) {
      expect(row.text).toMatch(/NOTE_CATEGORY\.familySummary/);
    }
  });

  it('reads codes from the terminology package rather than hardcoding them', () => {
    // FHIR code slugs must come from @juniper/terminology; a literal here
    // drifts from the server the moment a code changes. (The app's own URL
    // scheme, "juniper-family", is not a FHIR code and is deliberately not
    // matched.)
    const CODE_SLUGS =
      /['"`](juniper-note|juniper-transcript|juniper-family-summary|juniper-escalation|juniper-4m-checkin)['"`]/;
    expect(offenders(CODE_SLUGS)).toEqual([]);
  });
});

describe('qualitative timeline only', () => {
  it('ships no charting components — there is no structured data to trend yet', () => {
    expect(offenders(/\b(VictoryChart|LineChart|BarChart|react-native-chart|Sparkline)\b/)).toEqual(
      []
    );
  });
});
