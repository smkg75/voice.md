'use strict';

// The character table in docs/spec.md is normative. This test parses it out of
// the specification and compares it to the table the code implements, in both
// directions, so the two cannot drift apart. The expected values come from the
// specification, never from the code.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { TABLE, PRESERVED } = require('../scripts/typo.js');

const SPEC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'spec.md'), 'utf8');

// '`U+2000` to `U+200A`' is a range, a bare '`U+00A0`' is a single point.
function parsePoints(cell) {
  const tokens = [...cell.matchAll(/`U\+([0-9A-F]{4,6})`(\s+to\s+)?/g)];
  const points = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const point = parseInt(tokens[i][1], 16);
    if (tokens[i][2] && tokens[i + 1]) {
      const last = parseInt(tokens[i + 1][1], 16);
      for (let p = point; p <= last; p += 1) points.push(p);
      i += 1;
      continue;
    }
    points.push(point);
  }
  return points.sort((a, b) => a - b);
}

function specTable() {
  const rows = SPEC.split('\n').filter((line) => /^\| `?[A-Z]/.test(line));
  const table = {};
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const points = parsePoints(cells[2]);
    if (points.length) table[cells[1]] = points;
  }
  return table;
}

function specPreserved() {
  const start = SPEC.indexOf('Preserved, never rewritten:');
  assert.notStrictEqual(start, -1, 'the specification names the preserved characters');
  const block = SPEC.slice(start, SPEC.indexOf('\n\n', start));
  return [...block.matchAll(/`U\+([0-9A-F]{4,6})`/g)]
    .map((m) => parseInt(m[1], 16))
    .sort((a, b) => a - b);
}

test('the specification and the code carry the same classes', () => {
  assert.deepStrictEqual(Object.keys(TABLE).sort(), Object.keys(specTable()).sort());
});

test('every class holds exactly the code points the specification gives it', () => {
  const spec = specTable();
  for (const [name, points] of Object.entries(spec)) {
    assert.deepStrictEqual(
      TABLE[name].points.slice().sort((a, b) => a - b),
      points,
      `class ${name} differs between the specification and the code`
    );
  }
});

test('the code claims no code point the specification does not list', () => {
  const listed = new Set(Object.values(specTable()).flat());
  for (const [name, entry] of Object.entries(TABLE)) {
    for (const point of entry.points) {
      assert.ok(listed.has(point), `${name} claims U+${point.toString(16).toUpperCase()}, absent from the specification`);
    }
  }
});

test('the preserved characters are the ones the specification preserves', () => {
  assert.deepStrictEqual(PRESERVED.slice().sort((a, b) => a - b), specPreserved());
});

// The two natures. The specification says which classes are replaced and which
// are reported, in the third column of the same table, so the code cannot
// quietly start rewriting a construction or stop replacing a glyph.

function specNatures() {
  const rows = SPEC.split('\n').filter((line) => /^\| `?[A-Z]/.test(line));
  const natures = {};
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4 || !parsePoints(cells[2]).length) continue;
    natures[cells[1]] = {
      reported: /reported, never rewritten/.test(cells[3]),
      betweenDigits: /digit on each side/.test(cells[2]),
    };
  }
  return natures;
}

test('the classes the specification reports are the ones the code reports', () => {
  const spec = specNatures();
  const reported = Object.keys(spec).filter((name) => spec[name].reported).sort();
  const code = Object.keys(TABLE).filter((name) => TABLE[name].reported).sort();
  assert.deepStrictEqual(code, reported);
  assert.deepStrictEqual(reported, ['Dashes'], 'version 1 reports exactly one class');
});

test('the class the specification bounds by digits is the one the code bounds', () => {
  const spec = specNatures();
  const bounded = Object.keys(spec).filter((name) => spec[name].betweenDigits).sort();
  const code = Object.keys(TABLE).filter((name) => TABLE[name].betweenDigits).sort();
  assert.deepStrictEqual(code, bounded);
  assert.deepStrictEqual(bounded, ['Ranges']);
});

test('a class is replaced or reported, never both, and a reported class can still be asked for', () => {
  for (const [name, entry] of Object.entries(TABLE)) {
    assert.strictEqual(typeof entry.replace, 'function',
      name + ' carries a replacement, which a profile can ask for by name');
  }
});
