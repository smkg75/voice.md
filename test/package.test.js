'use strict';

// The command ships twice: inside the plugin, where a skill calls it by path,
// and on npm, where anyone can call it with npx and no plugin at all. The two
// manifests carry a version each, and a release that moved one and not the
// other would put two different programs behind the same number.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const PACKAGE = read('package.json');
const PLUGIN = read('.claude-plugin/plugin.json');
const MARKETPLACE = read('.claude-plugin/marketplace.json');

test('the package and the plugin carry the same version', () => {
  assert.strictEqual(PACKAGE.version, PLUGIN.version);
  assert.strictEqual(MARKETPLACE.plugins[0].version, PLUGIN.version);
});

test('every file the package ships is in the repository', () => {
  for (const entry of PACKAGE.files) {
    const target = path.join(ROOT, entry.replace(/\/$/, ''));
    assert.ok(fs.existsSync(target), entry + ' is listed in files and is not there');
  }
});

test('the package declares no dependency and no build', () => {
  assert.strictEqual(PACKAGE.dependencies, undefined);
  assert.strictEqual(PACKAGE.devDependencies, undefined);
  assert.strictEqual(PACKAGE.scripts, undefined, 'node --test needs no script entry');
});

test('both names point at the one dispatcher, which is executable', () => {
  const names = Object.keys(PACKAGE.bin);
  assert.deepStrictEqual(names.sort(), ['voice.md', 'voicemd']);
  for (const name of names) assert.strictEqual(PACKAGE.bin[name], 'bin/voice.md.js');
  const mode = fs.statSync(path.join(ROOT, 'bin', 'voice.md.js')).mode;
  assert.ok(mode & 0o111, 'the dispatcher is executable');
});

function bin(args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'bin', 'voice.md.js'), ...args], { encoding: 'utf8' });
}

test('the dispatcher hands typo its arguments and its exit code', () => {
  const out = bin(['typo', '--check', '--lang', 'en', path.join(ROOT, 'docs', 'spec.md')]);
  assert.strictEqual(out.status, 0, 'the specification holds itself to its own table');
});

test('the dispatcher explains itself with no argument and refuses an unknown one', () => {
  assert.strictEqual(bin([]).status, 0);
  assert.match(bin([]).stdout, /npx voice\.md typo/);
  const unknown = bin(['lint']);
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /no subcommand named/);
});
