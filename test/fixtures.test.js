'use strict';

// The rule this file enforces: a test fixture names a character by escape and
// never carries it. A literal one would be rewritten by this hook the day it is
// active, and the test holding it would then pass without checking anything.
//
// The repository applies the same rule to its own prose, so the check runs over
// every tracked file, not only the tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { TABLE } = require('../scripts/typo.js');

const ROOT = path.join(__dirname, '..');
const FORBIDDEN = new Set(Object.values(TABLE).flatMap((entry) => entry.points));

function walk(dir) {
  const found = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function offenders(text) {
  const hits = [];
  let offset = 0;
  for (const ch of text) {
    const point = ch.codePointAt(0);
    // U+FEFF at offset 0 is a byte order mark, which the table allows.
    if (FORBIDDEN.has(point) && !(point === 0xfeff && offset === 0)) {
      hits.push('U+' + point.toString(16).toUpperCase().padStart(4, '0'));
    }
    offset += ch.length;
  }
  return hits;
}

test('the check catches a character a fixture should have escaped', () => {
  assert.deepStrictEqual(offenders('a \u2014 b'), ['U+2014']);
  assert.deepStrictEqual(offenders('a - b'), []);
});

test('no test file carries a character it should have escaped', () => {
  for (const file of walk(__dirname)) {
    assert.deepStrictEqual(offenders(fs.readFileSync(file, 'utf8')), [], file);
  }
});

test('no file in the repository carries a character the table forbids', () => {
  for (const file of walk(ROOT)) {
    assert.deepStrictEqual(offenders(fs.readFileSync(file, 'utf8')), [], file);
  }
});
