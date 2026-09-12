'use strict';

// The worked example is the one file in this repository that quotes a
// measurement nothing here can recompute: its corpus is downloaded on every
// replay and is not stored. Nothing guarded it, and two figures of one bullet
// shipped wrong. What can be checked without the corpus is the arithmetic the
// bullet does on its own numbers: the total of the characters the typography
// table names is the sum of the classes it breaks that total into. It counts
// both natures, because it measures a corpus and not a draft: a count of what
// the typographer of 1927 put in has no reason to stop at what a program can
// repair on its own.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const VOICE = fs.readFileSync(path.join(__dirname, '..', 'examples', 'person-fr', 'VOICE.md'), 'utf8');

// A French figure, written with the thin space this repository forbids replaced
// by an ordinary one: "11 552" is one number.
function figure(text) {
  return Number(text.replace(/[^\d]/g, ''));
}

test('the typographic bullet of the example adds up to its own total', () => {
  const line = VOICE.split('\n').find((one) => /table de typographie/.test(one));
  assert.ok(line, 'the example no longer carries the typographic bullet');

  const total = figure(/les ([\d ]+) caract/.exec(line)[1]);
  const parts = [
    /([\d ]+) apostrophes U\+2019/, /([\d ]+) espaces/, /([\d ]+) U\+2026/, /([\d ]+) U\+2014/,
  ].map((pattern) => figure(pattern.exec(line)[1]));

  assert.strictEqual(parts.reduce((sum, one) => sum + one, 0), total);
  // And the per-letter average is that total over the 200 letters of the corpus.
  assert.strictEqual(Number(/, ([\d,]+) par lettre/.exec(line)[1].replace(',', '.')),
    Math.round((total / 200) * 10) / 10);
});
