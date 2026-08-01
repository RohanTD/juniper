/**
 * Token-only enforcement, matching apps/onboarding: no raw hex color literal
 * may appear in app source. THEME_SYSTEM.md section 2's first rule — "Never
 * hardcode a hex value in a screen/component. Always reference a token" — and
 * a stray hex is also a color nobody audited.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'src'];
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('token-only styling', () => {
  it('no hex color literals in app source (use theme tokens)', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      const absolute = path.join(APP_ROOT, dir);
      if (!fs.existsSync(absolute)) {
        continue;
      }
      for (const file of collectSourceFiles(absolute)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (HEX_LITERAL.test(line)) {
            offenders.push(`${path.relative(APP_ROOT, file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
