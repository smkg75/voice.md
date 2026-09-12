'use strict';

// The end to end pass over a real corpus. It reads a directory of plain text
// letters, measures the lot and checks the two files that come out.
//
// The corpus is never in this repository: it is somebody's correspondence, even
// when the somebody has been dead for a century. Point VOICE_CORPUS at a
// directory of .txt files to run these checks, and they skip without it:
//
//   VOICE_CORPUS=/path/to/letters node --test
//
// What is checked here is what a synthetic fixture cannot check: that nothing is
// silently dropped at scale, that the typographic count agrees with the hook's
// own count over the same text, and that neither output file carries a character
// or a piece of personal data it should not.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  analyse, prepare, measure, profileFor, words, maskPersonalData, NGRAM_LIMIT,
} = require('../scripts/stylometry.js');
const { TABLE, normalize } = require('../scripts/typo.js');

const CORPUS = process.env.VOICE_CORPUS;
const skip = !(CORPUS && fs.existsSync(CORPUS)) && 'set VOICE_CORPUS to a directory of .txt letters';

// The collection this was written against prints a header and numbered footnotes
// around each letter. A collector strips that furniture; here it is stripped in
// the same spirit, so that what is measured is the letter and nothing else.
function letter(raw) {
  const lines = raw
    .split('\n')
    .filter((line) => !/^(RECIPIENT|YEAR):/.test(line) && !line.trimStart().startsWith('↑'));
  while (lines.length && (!lines[0].trim() || /^\[.*\]$/.test(lines[0].trim()))) lines.shift();
  return lines.join('\n').trim();
}

// Read and measured once, since every check below asks about the same pass.
let cached = null;

function corpus() {
  if (cached) return cached;
  const files = fs.readdirSync(CORPUS).filter((name) => name.endsWith('.txt')).sort();
  const samples = files.map((name) => ({
    text: letter(fs.readFileSync(path.join(CORPUS, name), 'utf8')),
    surface: 'letter',
    mailbox: 'letters',
  }));
  cached = Object.assign({ files, samples }, analyse({ lang: 'fr', source: files.length + ' letters', samples }));
  return cached;
}

test('every letter in the corpus is measured, and none is dropped', { skip }, () => {
  const { files, analysis } = corpus();
  assert.strictEqual(analysis.corpus.samples, files.length);
  assert.ok(files.length >= 20, 'a corpus worth running this on');
  assert.strictEqual(analysis.overall.messages, files.length);
});

test('the word count agrees with a plain count of the words in the files', { skip }, () => {
  const { samples, analysis } = corpus();
  // An independent count: every run of letters, with no notion of elision, over
  // the whole letter rather than over its body. It is the upper bound the
  // measured count has to sit just under.
  const plain = samples.reduce(
    (total, sample) => total + (sample.text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || []).length,
    0
  );
  const measured = analysis.corpus.words_measured;
  assert.ok(measured <= plain, measured + ' words measured against ' + plain + ' counted plainly');
  assert.ok(measured > plain * 0.9, measured + ' words measured against ' + plain + ' counted plainly');
});

test('the typographic count is the one the command itself makes over the same text', { skip }, () => {
  const { samples, analysis } = corpus();

  // The command is a different program with its own reader and its own report.
  // Run it over the same texts and compare the totals.
  //
  // A profile sits beside them asking for `Dashes: replace`, which is what a
  // count of a corpus wants: the analysis counts every character the table
  // names, because it measures what a typographer put in and not what a program
  // can repair alone. Left to the table's own nature the command would report
  // the dashes under `to rewrite` instead of counting them, and the two numbers
  // would differ by exactly those. The profile is also the resolution, walked up
  // from each file, on a real tree.
  //
  // The only temporary files in this suite that hold somebody's correspondence,
  // so they go whatever the checks below do.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-corpus-'));
  let counted;
  let rewritten;
  try {
    fs.writeFileSync(path.join(dir, 'VOICE.md'),
      '---\nname: T\nkind: person\nlang: fr\ntypography:\n  Dashes: replace\n---\n');
    samples.forEach((sample, index) => fs.writeFileSync(path.join(dir, index + '.txt'), sample.text));
    const report = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'typo.js'), dir],
      { encoding: 'utf8' }
    );
    counted = report.stdout.match(/(\d+) characters in \d+ of \d+ files/);
    rewritten = /to rewrite/.test(report.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.ok(counted, 'the command reported a total');
  assert.strictEqual(rewritten, false, 'a class asked to replace is never also reported');
  assert.strictEqual(analysis.typographic_base.characters_normalised_total, Number(counted[1]));
  assert.ok(analysis.typographic_base.characters_normalised_total > 0, 'a real corpus has typography in it');
});

test('neither file that leaves the machine carries a character the table rewrites', { skip }, () => {
  const { analysis, exemplars } = corpus();
  const forbidden = new Set(Object.values(TABLE).flatMap((entry) => entry.points));

  for (const [name, text] of [['analysis.json', JSON.stringify(analysis, null, 2)], ['exemplars.md', exemplars]]) {
    let offset = 0;
    for (const ch of text) {
      const point = ch.codePointAt(0);
      assert.ok(
        !forbidden.has(point) || (point === 0xfeff && offset === 0),
        name + ' carries U+' + point.toString(16).toUpperCase() + ' at ' + offset
      );
      offset += ch.length;
    }
  }
});

test('the extracts are five per group, and carry no address, number or link', { skip }, () => {
  const { analysis, exemplars } = corpus();

  const sections = exemplars.split(/^## /m).slice(1);
  assert.strictEqual(sections.length, analysis.registers.length + analysis.surfaces.length);
  for (const section of sections) {
    const extracts = (section.match(/^#### /gm) || []).length;
    assert.ok(extracts > 0 && extracts <= 5, extracts + ' extracts in one section');
  }

  assert.doesNotMatch(exemplars, /[\w.+-]+@[\w-]+\.[\w.-]+/, 'an address reached the extracts');
  assert.doesNotMatch(exemplars, /\b\d{5,}\b/, 'a reference number reached the extracts');
  assert.doesNotMatch(exemplars, /\bhttps?:\/\//, 'a link reached the extracts');
});

// A synthetic fixture can only be caught naming the people it was written to
// name. Real correspondence names hundreds, and names them where a writer names
// them: in the middle of a sentence, next to a town and a firm. The invariant
// below needs no list of them. A word this corpus never once writes in lower case
// is a proper noun, and no n-gram may carry one, however deep the list is read.
test('no n-gram over a real corpus carries a word the corpus only writes with a capital', { skip }, () => {
  const { samples, analysis } = corpus();
  const profile = profileFor('fr');
  const records = prepare(
    samples.map((sample) => Object.assign({}, sample, { text: normalize(sample.text, 'fr').text })),
    profile
  );

  // Twenty times what analysis.json carries: the head of the list passing says
  // nothing, since a name that runs forty times still sits under the habits.
  const deep = measure(records, profile, NGRAM_LIMIT * 20);
  assert.ok(deep.ngrams.bigrams.length > NGRAM_LIMIT * 5, 'a list long enough to be worth reading');
  assert.ok(deep.ngrams.trigrams.length > NGRAM_LIMIT, 'a list long enough to be worth reading');

  // Built on the masked text, not on the raw one: the local part of an address
  // is written in lower case, and reading it as vocabulary would let
  // 'camille.berthier@example.org' vouch for the surname it carries.
  const lowerCased = new Set();
  for (const sample of samples) {
    const masked = maskPersonalData(normalize(sample.text, 'fr').text, profile);
    for (const word of masked.match(profile.word) || []) {
      if (word[0] === word[0].toLowerCase()) lowerCased.add(word.toLowerCase());
    }
  }

  const blocks = [deep, analysis.overall, ...analysis.registers, ...analysis.surfaces];
  for (const block of blocks) {
    for (const entry of [...block.ngrams.bigrams, ...block.ngrams.trigrams]) {
      for (const token of words(entry.ngram, profile)) {
        assert.ok(lowerCased.has(token), token + ' is a proper noun, and it reached "' + entry.ngram + '"');
        // The head of a bank identifier is written in lower case as often as not,
        // so the proper noun rule above passes it and this one has to catch it.
        assert.doesNotMatch(token, /^[a-z]{2}\d{2}$/, token + ' reached "' + entry.ngram + '"');
      }
    }
  }
});

test('the measurements of a real corpus stay inside what French makes possible', { skip }, () => {
  const { analysis } = corpus();
  const overall = analysis.overall;

  // Not a fingerprint of one writer: the bounds any French prose has to sit in,
  // so that an arithmetic slip shows up as an impossible number.
  assert.ok(overall.words.median > 20, 'the median letter is not empty');
  assert.ok(overall.sentences.median_words >= 5 && overall.sentences.median_words <= 40);
  assert.strictEqual(
    Object.values(overall.sentences.distribution_pct).reduce((sum, share) => sum + share, 0) > 99.5,
    true
  );
  const secondPerson = overall.second_person;
  assert.strictEqual(
    secondPerson.familiar_messages + secondPerson.formal_messages
      + secondPerson.mixed_messages + secondPerson.no_marker_messages,
    overall.messages
  );
  for (const entry of overall.ngrams.bigrams) {
    assert.strictEqual(entry.ngram.split(/[ ']/).filter(Boolean).length <= 2, true, entry.ngram);
    assert.ok(entry.count >= 4);
  }
  assert.ok(overall.ngrams.trigrams.every((entry) => entry.count >= 3));
});
