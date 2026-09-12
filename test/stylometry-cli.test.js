'use strict';

// The command line seam: one samples file in, two files out, and nothing else
// on the machine touched. What the model is allowed to read is exactly those two
// files, so this is the boundary that matters.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'stylometry.js');

const SAMPLES = {
  lang: 'fr',
  source: 'one mailbox',
  samples: [
    { text: 'Bonjour,\n\nLe devis est parti hier.\n\nCordialement', surface: 'email', register: 'professional' },
    { text: 'Salut,\n\nTu passes ce soir ?\n\nBises', surface: 'message', register: 'personal' },
  ],
};

function sandbox(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-stylometry-'));
  const file = path.join(dir, 'samples.json');
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return { dir, file };
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('with no argument it prints how it is called and changes nothing', () => {
  const out = run([]);
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /stylometry\.js <samples\.json>/);
});

test('it writes analysis.json and exemplars.md and names them on the way out', () => {
  const { dir, file } = sandbox(SAMPLES);
  const out = path.join(dir, 'report');
  const result = run([file, '--out', out]);

  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /2 samples, \d+ words, lang fr/);
  assert.match(result.stdout, /analysis\.json/);
  assert.match(result.stdout, /exemplars\.md/);

  const analysis = JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8'));
  assert.strictEqual(analysis.corpus.samples, 2);
  assert.strictEqual(analysis.corpus.source, 'one mailbox');
  assert.match(fs.readFileSync(path.join(out, 'exemplars.md'), 'utf8'), /^# Exemplars/);
});

test('without --out the two files land beside the samples', () => {
  const { dir, file } = sandbox(SAMPLES);
  assert.strictEqual(run([file]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'analysis.json')));
  assert.ok(fs.existsSync(path.join(dir, 'exemplars.md')));
});

test('--lang overrides the language the samples file declares', () => {
  const { dir, file } = sandbox(SAMPLES);
  const out = path.join(dir, 'report');
  assert.strictEqual(run([file, '--out', out, '--lang', 'en']).status, 0);
  const analysis = JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8'));
  assert.strictEqual(analysis.corpus.lang, 'en');
  // English draws no familiar and formal second person, so the same samples
  // measured as English say so instead of counting tu against vous.
  assert.strictEqual(analysis.overall.second_person.applicable, false);
});

test('a samples file that is not JSON is refused, and nothing is written', () => {
  const { dir, file } = sandbox('not json at all');
  const result = run([file]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /cannot be read as JSON/);
  assert.ok(!fs.existsSync(path.join(dir, 'analysis.json')));
});

test('a samples file with nothing in it is refused rather than measured', () => {
  const { dir, file } = sandbox({ lang: 'fr', samples: [] });
  const result = run([file]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /holds no sample/);
  assert.ok(!fs.existsSync(path.join(dir, 'analysis.json')));
});

test('a samples file that does not exist is refused', () => {
  const result = run([path.join(os.tmpdir(), 'voicemd-no-such-file.json')]);
  assert.strictEqual(result.status, 1);
});

test('the two files it writes carry no character the typography table rewrites', () => {
  const { dir, file } = sandbox({
    lang: 'fr',
    samples: [{ text: 'Bonjour,\n\nJe m\u2019en occupe \u2014 aujourd\u2019hui\u2026\n\nCordialement' }],
  });
  assert.strictEqual(run([file, '--out', dir]).status, 0);
  for (const name of ['analysis.json', 'exemplars.md']) {
    const written = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(written, /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0]/, name);
  }
});

test('a destination that cannot be written is one line on the error channel', () => {
  const { dir, file } = sandbox(SAMPLES);
  const taken = path.join(dir, 'taken');
  fs.writeFileSync(taken, 'already a file\n');

  const result = run([file, '--out', taken]);

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /taken/);
  assert.doesNotMatch(result.stderr, /at Object|node:internal/);
});

// The setup hands the model four blocks carrying VOICE_LANG, and a run where one
// of them was left on the language of the example measures English documents as
// French: the second person comes back as hard zeros rather than as "this
// language draws none", and a model writes those into the profile as facts. The
// inputs already declare what they are, so the disagreement is said out loud.
test('measuring a corpus as a language it does not declare says so', () => {
  const { dir, file } = sandbox(Object.assign({}, SAMPLES, { lang: 'en' }));
  const result = run([file, '--lang', 'fr', '--out', path.join(dir, 'report')]);

  assert.strictEqual(result.status, 0, 'the run still happens, --lang is the answer that was given');
  assert.match(result.stderr, /declare en/);
  assert.match(result.stderr, /fr/);
});

test('a corpus measured as the language it declares says nothing', () => {
  const { dir, file } = sandbox(SAMPLES);
  const result = run([file, '--lang', 'fr', '--out', path.join(dir, 'report')]);
  assert.strictEqual(result.stderr, '');
});
