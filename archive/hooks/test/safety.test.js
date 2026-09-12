'use strict';

// The absolute rule of handoff section 6: any internal error exits 0 with no
// output. A hook that throws, hangs or writes malformed JSON stops the agent
// working, and this one runs on every Write, every Edit and every MCP call.
// Every case below is a way the hook could have blocked the agent.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TYPO = path.join(__dirname, '..', 'typo.js');

function run(mode, input) {
  return spawnSync(process.execPath, [TYPO, mode], { encoding: 'utf8', input, timeout: 10000 });
}

function neverBlocks(mode, input, what) {
  const out = run(mode, input);
  assert.strictEqual(out.status, 0, what + ': exit code must be 0');
  assert.strictEqual(out.signal, null, what + ': must not be killed');
  if (out.stdout.trim()) {
    assert.doesNotThrow(() => JSON.parse(out.stdout), what + ': any output must be valid JSON');
  }
}

const BROKEN_INPUTS = [
  ['malformed JSON', '{ not json at all'],
  ['empty stdin', ''],
  ['whitespace only', '   \n  '],
  ['a JSON string rather than an object', '"hello"'],
  ['a JSON array', '[1, 2, 3]'],
  ['null', 'null'],
  ['an object with no tool_input', '{"tool_name":"Write","cwd":"/tmp"}'],
  ['a tool_input that is a string', '{"tool_name":"Write","tool_input":"nope","cwd":"/tmp"}'],
  ['a tool_input that is null', '{"tool_name":"Write","tool_input":null,"cwd":"/tmp"}'],
  ['no tool_name', '{"tool_input":{"content":"a"},"cwd":"/tmp"}'],
  ['a tool_name that is a number', '{"tool_name":42,"tool_input":{"content":"a"},"cwd":"/tmp"}'],
  ['a cwd that does not exist', '{"tool_name":"Write","tool_input":{"content":"a \u2014 b","file_path":"/no/such/dir/f.md"},"cwd":"/no/such/dir"}'],
  ['edits that are not an array', '{"tool_name":"MultiEdit","tool_input":{"edits":"nope"},"cwd":"/tmp"}'],
  ['an edit entry that is null', '{"tool_name":"MultiEdit","tool_input":{"edits":[null]},"cwd":"/tmp"}'],
];

for (const [what, input] of BROKEN_INPUTS) {
  test('pre survives ' + what, () => neverBlocks('pre', input, what));
  test('post-bash survives ' + what, () => neverBlocks('post-bash', input, what));
}

test('pre survives a deeply nested MCP payload without running out of stack', () => {
  let nested = { text: 'a \u2014 b' };
  for (let i = 0; i < 200; i += 1) nested = { deeper: nested };
  neverBlocks('pre', JSON.stringify({
    tool_name: 'mcp__x__y', cwd: os.tmpdir(), tool_input: nested,
  }), 'deep nesting');
});

test('pre survives a payload with a cycle-shaped repetition and a large string', () => {
  const big = 'a \u2014 b '.repeat(20000);
  neverBlocks('pre', JSON.stringify({
    tool_name: 'Write', cwd: os.tmpdir(), tool_input: { file_path: 'big.md', content: big },
  }), 'large content');
});

test('pre does not touch a file on disk, ever', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-safe-'));
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, 'a \u2014 b');
  run('pre', JSON.stringify({
    tool_name: 'Write', cwd: dir, tool_input: { file_path: file, content: 'c \u2014 d' },
  }));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a \u2014 b', 'pre answers, it does not write');
});

test('post-bash ignores a redirection inside a quoted string', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-safe-'));
  const file = path.join(dir, 'quoted.md');
  fs.writeFileSync(file, 'a \u2014 b');
  const out = run('post-bash', JSON.stringify({
    tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo "a > quoted.md is not a redirection"' },
  }));
  assert.strictEqual(out.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a \u2014 b');
});

test('post-bash leaves a directory alone when a redirection names one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-safe-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  const out = run('post-bash', JSON.stringify({
    tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo x > sub' },
  }));
  assert.strictEqual(out.status, 0);
});

test('an unknown mode says nothing and exits 0', () => {
  const out = run('not-a-mode', '{}');
  assert.strictEqual(out.status, 0);
});
