import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Guards the platform's design rules at the source level, so a new screen
// can't quietly drift off them:
//  - spacing (padding, margin, gap, space-*) sits on the 8px grid: Tailwind
//    units are 4px, so only even units (and 0 / px) are allowed;
//  - font sizes come from the 1.25 modular scale in tailwind.config.js, never
//    an arbitrary text-[Npx];
//  - shadows come from the tinted boxShadow scale, never an arbitrary
//    shadow-[...] or a flat-black rgba(0,0,0,...).
// Line length (75ch) and the 60/30/10 colour balance are layout outcomes,
// checked on rendered pages rather than here.

const SRC = join(__dirname);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

const SPACING = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.5)?|\[[^\]]+\])(?![\w.\]-])/g;
const offGrid = (value: string) => {
  if (value.startsWith('[')) {
    const px = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);
    return !px || Number(px[1]) % 8 !== 0;
  }
  return Number(value) % 2 !== 0;
};

function violations(test: (source: string) => string[]): string[] {
  return files(SRC).flatMap((file) => test(readFileSync(file, 'utf8')).map((hit) => `${relative(SRC, file)}: ${hit}`));
}

describe('design rules', () => {
  it('keeps every spacing utility on the 8px grid', () => {
    expect(violations((s) => [...s.matchAll(SPACING)].filter((m) => offGrid(m[1])).map((m) => m[0]))).toEqual([]);
  });

  it('uses only the modular type scale', () => {
    expect(violations((s) => s.match(/\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g) ?? [])).toEqual([]);
  });

  it('uses only the tinted shadow scale', () => {
    expect(violations((s) => s.match(/\bshadow-\[[^\]]+\]|rgba?\(\s*0\s*,\s*0\s*,\s*0\b/g) ?? [])).toEqual([]);
  });
});
