'use strict';

// The command line seam. No flag reports what would change, counted per
// character and per file, and lists what has to be rewritten by hand; --fix
// writes the replacements and never the rewrites; --check writes nothing and
// exits 1 if either list has anything in it.
//
// Every run below names its language or its profile. That is not politeness: a
// run that names neither and finds no VOICE.md exits 2 on purpose, and a test
// that left the resolution to the machine would pass or fail depending on
// whether the person running it had a profile in their home directory.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TYPO = path.join(__dirname, '..', 'scripts', 'typo.js');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-cli-'));
}

function write(dir, name, text) {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function profile(dir, name, front) {
  return write(dir, name, '---\nname: T\nkind: person\n' + front + '\n---\n');
}

// HOME is set to a directory with nothing in it, so the last resort of the
// resolution, ~/.agents/VOICE.md, answers nothing unless a test puts one there.
function run(args, options) {
  const home = (options && options.home) || sandbox();
  return spawnSync(process.execPath, [TYPO, ...args], {
    encoding: 'utf8',
    cwd: (options && options.cwd) || undefined,
    env: Object.assign({}, process.env, { HOME: home }),
  });
}

test('with no flag it reports what would change and writes nothing', () => {
  const dir = sandbox();
  const file = write(dir, 'a.md', 'a \u2010 b\u00A0c\u2010d');
  const before = fs.readFileSync(file, 'utf8');

  const out = run(['--lang', 'en', file]);

  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /a\.md/);
  assert.match(out.stdout, /U\+2010/);
  assert.match(out.stdout, /U\+00A0/);
  assert.match(out.stdout, /2/, 'the count per character is reported');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'the file is untouched');
});

test('a file with nothing to change is not reported as changing', () => {
  const dir = sandbox();
  const file = write(dir, 'clean.md', 'plain ascii only\n');
  const out = run(['--lang', 'en', file]);
  assert.strictEqual(out.status, 0);
  assert.doesNotMatch(out.stdout, /U\+/);
});

test('--fix writes the normalized text back', () => {
  const dir = sandbox();
  const file = write(dir, 'a.md', 'a \u2010 b\u00A0c');
  const out = run(['--fix', '--lang', 'en', file]);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b c');
});

test('--check writes nothing and exits 1 when something would change', () => {
  const dir = sandbox();
  const file = write(dir, 'a.md', 'a \u2010 b');
  const before = fs.readFileSync(file, 'utf8');
  const out = run(['--check', '--lang', 'en', file]);
  assert.strictEqual(out.status, 1);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('--check exits 0 when nothing would change', () => {
  const dir = sandbox();
  const file = write(dir, 'a.md', 'nothing to do here\n');
  assert.strictEqual(run(['--check', '--lang', 'en', file]).status, 0);
});

test('--check over several files exits 1 if any one of them would change', () => {
  const dir = sandbox();
  const clean = write(dir, 'clean.md', 'fine\n');
  const dirty = write(dir, 'dirty.md', 'a\u2010b');
  const out = run(['--check', '--lang', 'en', clean, dirty]);
  assert.strictEqual(out.status, 1);
  assert.match(out.stdout, /dirty\.md/);
  assert.doesNotMatch(out.stdout, /clean\.md/);
});

test('--lang fr turns a double quote into guillemets, --lang en into a straight quote', () => {
  const dir = sandbox();
  const fr = write(dir, 'fr.md', 'il dit \u201Coui\u201D');
  const en = write(dir, 'en.md', 'he said \u201Cyes\u201D');
  run(['--fix', '--lang', 'fr', fr]);
  run(['--fix', '--lang', 'en', en]);
  assert.strictEqual(fs.readFileSync(fr, 'utf8'), 'il dit \u00AB oui \u00BB');
  assert.strictEqual(fs.readFileSync(en, 'utf8'), 'he said "yes"');
});

// --- Resolution -----------------------------------------------------------

test('without a designation it reads the VOICE.md nearest the file', () => {
  const dir = sandbox();
  profile(dir, 'VOICE.md', 'lang: fr');
  const file = write(dir, 'deep/letter.md', 'il dit \u201Coui\u201D');
  const out = run(['--fix', file]);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'il dit \u00AB oui \u00BB');
});

test('--voice names the profile and comes before the nearest one', () => {
  const dir = sandbox();
  profile(dir, 'VOICE.md', 'lang: en');
  const chosen = profile(dir, 'other/VOICE.md', 'lang: fr');
  const file = write(dir, 'letter.md', 'il dit \u201Coui\u201D');
  run(['--fix', '--voice', chosen, file]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'il dit \u00AB oui \u00BB');
});

test('the last resort is ~/.agents/VOICE.md', () => {
  const home = sandbox();
  profile(home, '.agents/VOICE.md', 'lang: fr');
  const dir = sandbox();
  const file = write(dir, 'letter.md', 'il dit \u201Coui\u201D');
  run(['--fix', file], { home });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'il dit \u00AB oui \u00BB');
});

test('no profile and no --lang reads nothing, says so, and exits 2', () => {
  const dir = sandbox();
  const file = write(dir, 'letter.md', 'a \u2010 b');
  const before = fs.readFileSync(file, 'utf8');

  const out = run(['--fix', file]);

  assert.strictEqual(out.status, 2);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'nothing is written');
  // Written for the model that reads it: what was looked for, where, and the
  // two ways out.
  assert.match(out.stderr, /no VOICE\.md found walking up from /);
  assert.match(out.stderr, /nor at ~\/\.agents\/VOICE\.md/);
  assert.match(out.stderr, /pass --voice <path> or create one/);
});

test('--voice pointing at nothing exits 2 rather than falling back', () => {
  const dir = sandbox();
  const file = write(dir, 'letter.md', 'a \u2010 b');
  const out = run(['--fix', '--voice', path.join(dir, 'absent.md'), file]);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /cannot be read as a VOICE\.md/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a \u2010 b');
});

// --- The two natures ------------------------------------------------------

test('a construction is reported with its file, its line and its whole sentence', () => {
  const dir = sandbox();
  const file = write(dir, 'letter.md', [
    'Une note.',
    '',
    'La phrase \u2014 celle-ci \u2014 porte une incise',
    'et se termine ici. Une autre suit.',
    '',
  ].join('\n'));
  const before = fs.readFileSync(file, 'utf8');

  const out = run(['--lang', 'fr', file]);

  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /to rewrite/);
  assert.match(out.stdout, /letter\.md:3\s+U\+2014/);
  // The sentence, whole, across the line the prose is wrapped on, and not the
  // sentence after it.
  assert.match(out.stdout, /La phrase \u2014 celle-ci \u2014 porte une incise et se termine ici\./);
  assert.doesNotMatch(out.stdout, /Une autre suit/);
  assert.doesNotMatch(out.stdout, /Une note/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('one sentence is listed once, however many dashes it carries', () => {
  const dir = sandbox();
  // An aside has two, and it is one rewrite. A line per character would make a
  // writer read the same sentence twice and count the work wrong.
  const file = write(dir, 'letter.md', 'Le devis \u2014 celui de mars \u2014 attend. Et ceci \u2013 aussi.');

  const out = run(['--lang', 'fr', file]);

  const listed = out.stdout.split('\n').filter((line) => /letter\.md:\d/.test(line));
  assert.strictEqual(listed.length, 2, 'two sentences, not three characters');
  assert.match(out.stdout, /2 sentences to rewrite/);
  assert.match(listed[0], /U\+2014\s+Le devis/);
  assert.match(listed[1], /U\+2013\s+Et ceci/);
});

test('a line that opens on a dash is a sentence of its own', () => {
  const dir = sandbox();
  // A list item and a line of dialogue end with their line. A paragraph hard
  // wrapped across two lines, which is how markdown prose is written, does not.
  const file = write(dir, 'letter.md', [
    'Un paragraphe qui tient',
    'sur deux lignes avec une incise \u2014 celle-ci \u2014 dedans.',
    '',
    '\u2014 un item en debut de ligne',
    'Attention : ceci est une autre phrase.',
    '',
  ].join('\n'));

  const out = run(['--lang', 'fr', file]);
  const listed = out.stdout.split('\n').filter((line) => /letter\.md:\d/.test(line));

  assert.strictEqual(listed.length, 2);
  assert.match(listed[0], /:1\s+U\+2014\s+Un paragraphe qui tient sur deux lignes avec une incise/);
  assert.ok(listed[0].endsWith('dedans.'), 'the wrapped paragraph is one sentence');
  assert.ok(listed[1].endsWith('\u2014 un item en debut de ligne'),
    'the dash line stops at its line and does not swallow the one under it');
});

test('over one file the totals are not printed again under the file', () => {
  const dir = sandbox();
  const one = write(dir, 'one.md', 'a\u2010b\u2010c');

  const single = run(['--lang', 'en', one]);
  assert.strictEqual(single.stdout.match(/U\+2010/g).length, 1, 'named once, not twice');
  assert.match(single.stdout, /2 characters in 1 of 1 files/);

  write(dir, 'two.md', 'd\u2010e');
  const both = run(['--lang', 'en', dir]);
  assert.strictEqual(both.stdout.match(/U\+2010/g).length, 3, 'two files, plus the total');
});

test('--fix replaces the glyphs, lists the constructions, and exits 0', () => {
  const dir = sandbox();
  const file = write(dir, 'letter.md', 'Il l\u2019a dit \u2014 deux fois.');

  const out = run(['--fix', '--lang', 'fr', file]);

  assert.strictEqual(out.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Il l\'a dit \u2014 deux fois.',
    'the apostrophe is repaired and the dash is left for the writer');
  assert.match(out.stdout, /U\+2019/);
  assert.match(out.stdout, /to rewrite/);
  assert.match(out.stdout, /1 sentence to rewrite/);
});

test('--check exits 1 on a construction alone, with nothing to replace', () => {
  const dir = sandbox();
  const file = write(dir, 'letter.md', 'Rien a reprendre \u2014 sauf ceci.');
  const out = run(['--check', '--lang', 'fr', file]);
  assert.strictEqual(out.status, 1);
  assert.match(out.stdout, /to rewrite/);
});

test('a dash between two digits is a range, replaced and never reported', () => {
  const dir = sandbox();
  const file = write(dir, 'dates.md', 'Correspondance 1914\u20131918, p. 3\u20144.');
  const out = run(['--fix', '--lang', 'fr', file]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Correspondance 1914-1918, p. 3-4.');
  assert.doesNotMatch(out.stdout, /to rewrite/);
});

test('the typography key of the resolved profile decides what a class does', () => {
  const dir = sandbox();
  profile(dir, 'VOICE.md', 'lang: fr\ntypography:\n  Dashes: replace');
  const file = write(dir, 'letter.md', 'Il l\u2019a dit \u2014 deux fois.');

  const out = run(['--fix', file]);

  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Il l\'a dit - deux fois.');
  assert.doesNotMatch(out.stdout, /to rewrite/, 'a class asked to replace reports nothing');
});

test('a class the profile keeps is left alone and never reported', () => {
  const dir = sandbox();
  profile(dir, 'VOICE.md', 'lang: fr\ntypography:\n  Dashes: keep\n  Spaces: keep');
  const file = write(dir, 'letter.md', 'Il l\u2019a dit\u00A0\u2014 deux fois.');

  const out = run(['--check', file]);

  assert.strictEqual(out.status, 1, 'the apostrophe is still a glyph');
  assert.match(out.stdout, /U\+2019/);
  assert.doesNotMatch(out.stdout, /U\+00A0/);
  assert.doesNotMatch(out.stdout, /to rewrite/);
});

test('a class name the table does not define is ignored, and the table applies', () => {
  const dir = sandbox();
  profile(dir, 'VOICE.md', 'lang: fr\ntypography:\n  Emdashes: keep\n  Spaces: sometimes');
  const file = write(dir, 'letter.md', 'a\u00A0b');
  run(['--fix', file]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a b');
});

// --- Files ----------------------------------------------------------------

test('a file it cannot read is reported and does not stop the others', () => {
  const dir = sandbox();
  const missing = path.join(dir, 'no-such-file.md');
  const real = write(dir, 'real.md', 'a\u2010b');
  const out = run(['--fix', '--lang', 'en', missing, real]);
  assert.strictEqual(fs.readFileSync(real, 'utf8'), 'a-b', 'the readable file was still fixed');
  assert.match(out.stderr, /cannot be read/);
});

test('called with no file it explains itself and exits 0', () => {
  const out = run([]);
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /--check|--fix|usage/i);
  assert.match(out.stdout, /--voice/, 'the usage names the designation that comes first');
});

test('a directory argument is walked, skipping .git and node_modules', () => {
  const dir = sandbox();
  write(dir, 'sub/deep.md', 'a\u2010b');
  write(dir, '.git/config.md', 'a\u2010b');
  write(dir, 'node_modules/dep.md', 'a\u2010b');

  const out = run(['--check', '--lang', 'en', dir]);

  assert.strictEqual(out.status, 1);
  assert.match(out.stdout, /deep\.md/);
  assert.doesNotMatch(out.stdout, /config\.md/, '.git is not walked');
  assert.doesNotMatch(out.stdout, /dep\.md/, 'node_modules is not walked');
});

test('a binary file is left alone rather than corrupted', () => {
  const dir = sandbox();
  const binary = path.join(dir, 'image.png');
  // A NUL byte is what tells a binary from text, and a byte that is not valid
  // UTF-8 would come back as a replacement character and be written back wrong.
  fs.writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x14, 0x20]));
  const before = fs.readFileSync(binary);

  const out = run(['--fix', '--lang', 'en', dir]);

  assert.deepStrictEqual(fs.readFileSync(binary), before, 'the bytes are untouched');
  assert.doesNotMatch(out.stdout, /image\.png/);
});

test('a directory holding machine-managed copies is not walked', () => {
  const dir = sandbox();
  // Each of these holds files nobody authored: a package store, a build output,
  // a cache. Counting them makes a dry run report a number that has nothing to
  // do with what the agent writes.
  const skipped = ['.pnpm-store', '.yarn', '.next', '.turbo', 'dist', 'build', 'coverage', '__pycache__', '.venv'];
  for (const name of skipped) write(dir, name + '/file.md', 'a\u2010b');
  write(dir, 'source.md', 'a\u2010b');

  const out = run(['--check', '--lang', 'en', dir]);

  assert.strictEqual(out.status, 1);
  assert.match(out.stdout, /source\.md/);
  for (const name of skipped) {
    assert.doesNotMatch(out.stdout, new RegExp(name.replace('.', '\\.') + '/'), name + ' is not walked');
  }
});

test('the report totals each character across the files, not only the grand total', () => {
  const dir = sandbox();
  write(dir, 'one.md', 'a\u2010b\u2010c');
  write(dir, 'two.md', 'd\u2010e\u2026f');

  const out = run(['--lang', 'en', dir]);

  // Three hyphen variants over two files, and the per-character total says so.
  assert.match(out.stdout, /U\+2010\s+3/, 'the total for U+2010 across both files');
  assert.match(out.stdout, /U\+2026\s+1/);
  assert.match(out.stdout, /4 characters in 2 of 2 files/);
});

test('a worktrees directory is skipped only when it sits under .claude', () => {
  const dir = sandbox();
  // The agent's own copies of a repository, which duplicate its source.
  write(dir, '.claude/worktrees/branch/copy.md', 'a\u2010b');
  // The rest of .claude is text the agent writes, and a worktrees directory
  // anywhere else is an ordinary directory.
  write(dir, '.claude/settings.md', 'a\u2010b');
  write(dir, 'worktrees/mine.md', 'a\u2010b');

  const out = run(['--check', '--lang', 'en', dir]);

  assert.doesNotMatch(out.stdout, /copy\.md/, '.claude/worktrees is skipped');
  assert.match(out.stdout, /settings\.md/, 'the rest of .claude is walked');
  assert.match(out.stdout, /mine\.md/, 'a worktrees directory elsewhere is walked');
});
