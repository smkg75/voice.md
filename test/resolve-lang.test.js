'use strict';

// The resolution order is the one in the "Where a file lives" section of
// docs/spec.md: the nearest file walking up from where the text is destined,
// looking at VOICE.md then .agents/VOICE.md at each level, then the one under
// the home directory. Nothing is merged: the first file found is the profile.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveLang } = require('../scripts/typo.js');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-'));
  return {
    root,
    // A home that holds no profile unless a test puts one there, so the real
    // one on the machine running the tests never decides the answer.
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-home-')),
    write(relative, lang) {
      const full = path.join(root, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `---\nname: T\nkind: person\nlang: ${lang}\n---\n`);
      return full;
    },
    dir(relative) {
      const full = path.join(root, relative);
      fs.mkdirSync(full, { recursive: true });
      return full;
    },
  };
}

test('reads lang from a VOICE.md beside the file', () => {
  const box = sandbox();
  box.write('VOICE.md', 'fr');
  assert.strictEqual(resolveLang(path.join(box.root, 'letter.md'), box.home), 'fr');
});

test('looks under .agents at a level that has no VOICE.md of its own', () => {
  const box = sandbox();
  box.write('.agents/VOICE.md', 'de');
  assert.strictEqual(resolveLang(path.join(box.root, 'letter.md'), box.home), 'de');
});

test('a VOICE.md beats a .agents/VOICE.md at the same level', () => {
  const box = sandbox();
  box.write('VOICE.md', 'fr');
  box.write('.agents/VOICE.md', 'de');
  assert.strictEqual(resolveLang(path.join(box.root, 'letter.md'), box.home), 'fr');
});

test('walks up until it finds one', () => {
  const box = sandbox();
  box.write('VOICE.md', 'fr');
  const deep = box.dir('a/b/c');
  assert.strictEqual(resolveLang(path.join(deep, 'letter.md'), box.home), 'fr');
});

test('the nearest one wins, without merging', () => {
  const box = sandbox();
  box.write('VOICE.md', 'fr');
  box.write('a/b/VOICE.md', 'es');
  const deep = box.dir('a/b/c');
  assert.strictEqual(resolveLang(path.join(deep, 'letter.md'), box.home), 'es');
});

test('falls back to the profile under the home directory', () => {
  const box = sandbox();
  fs.mkdirSync(path.join(box.home, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(box.home, '.agents', 'VOICE.md'), '---\nlang: it\n---\n');
  assert.strictEqual(resolveLang(path.join(box.dir('a/b'), 'letter.md'), box.home), 'it');
});

test('answers English when no profile is found anywhere', () => {
  const box = sandbox();
  assert.strictEqual(resolveLang(path.join(box.root, 'letter.md'), box.home), 'en');
});

test('answers English when the profile declares no lang', () => {
  const box = sandbox();
  fs.writeFileSync(path.join(box.root, 'VOICE.md'), '---\nname: T\n---\n');
  assert.strictEqual(resolveLang(path.join(box.root, 'letter.md'), box.home), 'en');
});

test('accepts a directory as the starting point', () => {
  const box = sandbox();
  box.write('VOICE.md', 'fr');
  assert.strictEqual(resolveLang(box.dir('a/b'), box.home), 'fr');
});

test('answers English rather than throwing on a path that does not exist', () => {
  const box = sandbox();
  assert.strictEqual(resolveLang(path.join(box.root, 'no', 'such', 'file.md'), box.home), 'en');
});
