'use strict';

// PostToolUse on Bash, from handoff section 6. PostToolUse is read only, so the
// hook cannot rewrite the command; it fixes the files the command redirected
// into. Only >, >> and tee are recognized, and every other form is ignored.
// There is deliberately no PreToolUse on Bash: rewriting a command would break
// a grep looking for the very characters this table removes.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TYPO = path.join(__dirname, '..', 'typo.js');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-post-'));
}

function postBash(command, cwd) {
  return spawnSync(process.execPath, [TYPO, 'post-bash'], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }),
  });
}

function seed(dir, name) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, 'a \u2014 b');
  return full;
}

test('a file written with > is normalized', () => {
  const dir = sandbox();
  const file = seed(dir, 'out.md');
  const result = postBash('echo hello > out.md', dir);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b');
});

test('a file appended to with >> is normalized', () => {
  const dir = sandbox();
  const file = seed(dir, 'log.md');
  postBash('echo hello >> log.md', dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b');
});

test('a file written through tee is normalized', () => {
  const dir = sandbox();
  const file = seed(dir, 'teed.md');
  postBash('echo hello | tee teed.md', dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b');
});

test('a quoted path is understood', () => {
  const dir = sandbox();
  const file = seed(dir, 'with space.md');
  postBash('echo hello > "with space.md"', dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b');
});

test('an absolute path is understood', () => {
  const dir = sandbox();
  const file = seed(dir, 'abs.md');
  postBash('echo hello > ' + file, os.tmpdir());
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a - b');
});

test('several redirections in one command are all normalized', () => {
  const dir = sandbox();
  const one = seed(dir, 'one.md');
  const two = seed(dir, 'two.md');
  postBash('echo a > one.md && echo b >> two.md', dir);
  assert.strictEqual(fs.readFileSync(one, 'utf8'), 'a - b');
  assert.strictEqual(fs.readFileSync(two, 'utf8'), 'a - b');
});

test('a command with no redirection changes nothing', () => {
  const dir = sandbox();
  const file = seed(dir, 'untouched.md');
  const result = postBash('grep -rn "x" .', dir);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a \u2014 b');
});

test('a redirection to a device is ignored', () => {
  const dir = sandbox();
  const result = postBash('echo hello > /dev/null', dir);
  assert.strictEqual(result.status, 0);
});

test('a redirection to a file that does not exist is ignored quietly', () => {
  const dir = sandbox();
  const result = postBash('echo hello > never-created.md', dir);
  assert.strictEqual(result.status, 0);
});

test('the command itself is never rewritten, since PostToolUse cannot', () => {
  const dir = sandbox();
  const result = postBash('grep -n "\u2014" file.md', dir);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '');
});

test('a binary written by a redirection is left alone', () => {
  const dir = sandbox();
  const binary = path.join(dir, 'out.bin');
  fs.writeFileSync(binary, Buffer.from([0x00, 0xff, 0x14, 0x20]));
  const before = fs.readFileSync(binary);
  postBash('cat something > out.bin', dir);
  assert.deepStrictEqual(fs.readFileSync(binary), before);
});
