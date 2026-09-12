'use strict';

// Every fixture writes its characters as \u escapes and never as the character
// itself. A fixture holding a literal curly apostrophe would be rewritten by
// this very hook the day it is active, and the test would then pass vacuously.
// A test in fixtures.test.js holds this file to that rule.

const test = require('node:test');
const assert = require('node:assert');

const { normalize } = require('../scripts/typo.js');

test('a hyphen variant becomes one hyphen and the spacing around it is untouched', () => {
  const out = normalize('a \u2010 b\u2011c\u2212d\uFF0De', 'en');
  assert.strictEqual(out.text, 'a - b-c-d-e');
  assert.deepStrictEqual(out.counts, {
    'U+2010': 1, 'U+2011': 1, 'U+2212': 1, 'U+FF0D': 1,
  });
  assert.deepStrictEqual(out.constructions, []);
});

// The two natures of the table, on the three characters that have both. Between
// two digits the character is a range, which is a glyph and is replaced;
// anywhere else it sets off an aside, and an aside is rewritten as a sentence by
// whoever is writing, so it is reported and left exactly where it was.
test('a dash between two digits is a range and becomes a hyphen', () => {
  const out = normalize('1914\u20131918, p. 3\u20144', 'en');
  assert.strictEqual(out.text, '1914-1918, p. 3-4');
  assert.deepStrictEqual(out.counts, { 'U+2013': 1, 'U+2014': 1 });
  assert.deepStrictEqual(out.constructions, []);
});

test('a dash anywhere else is reported, never rewritten', () => {
  const text = 'La phrase \u2014 celle-ci \u2014 porte une incise.';
  const out = normalize(text, 'fr');
  assert.strictEqual(out.text, text, 'the text comes back byte for byte');
  assert.deepStrictEqual(out.counts, {});
  assert.deepStrictEqual(out.constructions.map((one) => one.point), [0x2014, 0x2014]);
  assert.strictEqual(text.codePointAt(out.constructions[0].index), 0x2014, 'the index points at it');
});

test('a profile can ask for the dashes it wants replaced, or kept and unreported', () => {
  const text = 'a \u2014 b';
  assert.strictEqual(normalize(text, 'en', { Dashes: 'replace' }).text, 'a - b');
  const kept = normalize(text, 'en', { Dashes: 'keep' });
  assert.strictEqual(kept.text, text);
  assert.deepStrictEqual(kept.constructions, [], 'keep says nothing about the class');
  const quiet = normalize('a\u00A0b', 'en', { Spaces: 'keep' });
  assert.strictEqual(quiet.text, 'a\u00A0b', 'a glyph class can be kept too');
  assert.deepStrictEqual(quiet.counts, {});
});

test('a range is still a range when the profile keeps the dashes', () => {
  // Ranges and Dashes are two classes over the same three characters, and the
  // profile names them one at a time.
  const out = normalize('1914\u20131918 \u2013 et la suite', 'fr', { Dashes: 'keep' });
  assert.strictEqual(out.text, '1914-1918 \u2013 et la suite');
  assert.deepStrictEqual(out.counts, { 'U+2013': 1 });
  assert.deepStrictEqual(out.constructions, []);
});

test('a curly apostrophe becomes a straight one, never a backtick', () => {
  const out = normalize('l\u2019ami d\u02BCun \u2032 autre', 'fr');
  assert.strictEqual(out.text, "l'ami d'un ' autre");
  assert.ok(!out.text.includes('`'));
});

test('each space character becomes exactly one space, and runs are not merged', () => {
  const out = normalize('a\u00A0\u00A0b c\u202F\u3000d\u2009e', 'en');
  assert.strictEqual(out.text, 'a  b c  d e');
  assert.deepStrictEqual(out.counts, {
    'U+00A0': 2, 'U+202F': 1, 'U+3000': 1, 'U+2009': 1,
  });
});

test('an invisible character is removed', () => {
  const out = normalize('a\u200Bb\u2060c\u00ADd\u2062e', 'en');
  assert.strictEqual(out.text, 'abcde');
  assert.deepStrictEqual(out.counts, {
    'U+200B': 1, 'U+2060': 1, 'U+00AD': 1, 'U+2062': 1,
  });
});

test('a byte order mark survives at offset 0 and is removed anywhere else', () => {
  assert.strictEqual(normalize('\uFEFFabc', 'en').text, '\uFEFFabc');
  assert.deepStrictEqual(normalize('\uFEFFabc', 'en').counts, {});
  assert.strictEqual(normalize('abc\uFEFFdef', 'en').text, 'abcdef');
});

test('an ellipsis becomes three dots, a ligature its letters, a fraction slash a slash', () => {
  const out = normalize('wait\u2026 o\uFB03ce 1\u2044\u22152 a\uFB06b', 'en');
  assert.strictEqual(out.text, 'wait... office 1//2 astb');
});

test('outside French every double quote becomes a straight one', () => {
  const out = normalize('\u201Cyes\u201D \u201Eno\u201F 6\u2033', 'en');
  assert.strictEqual(out.text, '"yes" "no" 6"');
});

test('in French an opening double quote becomes a guillemet and a space, a closing one the reverse', () => {
  const out = normalize('il dit \u201Coui\u201D.', 'fr');
  assert.strictEqual(out.text, 'il dit \u00AB oui \u00BB.');
});

test('French leaves guillemets already in the text and straight quotes alone', () => {
  const input = '\u00AB oui \u00BB et "non"';
  assert.strictEqual(normalize(input, 'fr').text, input);
  assert.deepStrictEqual(normalize(input, 'fr').counts, {});
});

test('a preserved character is never rewritten, whatever the language', () => {
  const input = '\u0153uf \u00E6on \u2022 \u2192 \u00D7 iel\u00B7le'
    + ' a\u200Db \u26A1\uFE0F c\u200Ed \u200Fe \u200Cf \uFE0Eg';
  for (const lang of ['fr', 'en', 'de']) {
    assert.strictEqual(normalize(input, lang).text, input);
    assert.deepStrictEqual(normalize(input, lang).counts, {});
  }
});

test('text with nothing to change comes back identical and counts nothing', () => {
  const input = "plain ASCII, a hyphen - and a straight quote '.";
  const out = normalize(input, 'en');
  assert.strictEqual(out.text, input);
  assert.deepStrictEqual(out.counts, {});
});

test('an astral character is carried through without being split', () => {
  assert.strictEqual(normalize('a \u{1F680} b\u2010c', 'en').text, 'a \u{1F680} b-c');
  assert.strictEqual(normalize('\u{1F680}\u00A0\u{1F680}', 'en').text, '\u{1F680} \u{1F680}');
});

test('an empty text is returned as it is', () => {
  const out = normalize('', 'en');
  assert.strictEqual(out.text, '');
  assert.deepStrictEqual(out.counts, {});
});

test('a double prime is a measure, not a quotation, in every language', () => {
  // 5'10" is a height, not a citation. U+2033 follows U+2032, which becomes a
  // straight apostrophe, so it becomes a straight double quote everywhere.
  assert.strictEqual(normalize("5\u2032 10\u2033", 'fr').text, `5' 10"`);
  assert.strictEqual(normalize("5\u2032 10\u2033", 'en').text, `5' 10"`);
});
