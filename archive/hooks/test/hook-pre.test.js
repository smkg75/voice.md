'use strict';

// PreToolUse, from handoff section 6. The hook reads the tool call on stdin and
// answers with the complete tool_input rewritten, never a fragment, and never
// touching permissionDecision. The rule that matters most: Edit's old_string is
// never rewritten, because the text it matches is the text already on disk.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TYPO = path.join(__dirname, '..', 'typo.js');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-pre-'));
}

function pre(payload) {
  const out = spawnSync(process.execPath, [TYPO, 'pre'], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
  return {
    status: out.status,
    stdout: out.stdout,
    json: out.stdout.trim() ? JSON.parse(out.stdout) : null,
  };
}

function updated(result) {
  assert.ok(result.json, 'the hook answered something');
  assert.strictEqual(result.json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(result.json.hookSpecificOutput.permissionDecision, undefined);
  return result.json.hookSpecificOutput.updatedInput;
}

test('Write has its content normalized', () => {
  const dir = sandbox();
  const result = pre({
    tool_name: 'Write',
    cwd: dir,
    tool_input: { file_path: path.join(dir, 'a.md'), content: 'a \u2014 b' },
  });
  assert.strictEqual(result.status, 0);
  const input = updated(result);
  assert.strictEqual(input.content, 'a - b');
  assert.strictEqual(input.file_path, path.join(dir, 'a.md'), 'the whole tool_input comes back');
});

test('Edit has new_string normalized and old_string left exactly as it was', () => {
  const dir = sandbox();
  const old = 'the \u2014 text already on disk';
  const result = pre({
    tool_name: 'Edit',
    cwd: dir,
    tool_input: { file_path: path.join(dir, 'a.md'), old_string: old, new_string: 'a \u2014 b' },
  });
  const input = updated(result);
  assert.strictEqual(input.new_string, 'a - b');
  assert.strictEqual(input.old_string, old, 'old_string must match the file on disk, so it is never rewritten');
});

test('MultiEdit normalizes every new_string and no old_string', () => {
  const dir = sandbox();
  const result = pre({
    tool_name: 'MultiEdit',
    cwd: dir,
    tool_input: {
      file_path: path.join(dir, 'a.md'),
      edits: [
        { old_string: 'one \u2014 here', new_string: 'one \u2014 there' },
        { old_string: 'two \u2014 here', new_string: 'two \u2014 there' },
      ],
    },
  });
  const input = updated(result);
  assert.strictEqual(input.edits[0].new_string, 'one - there');
  assert.strictEqual(input.edits[1].new_string, 'two - there');
  assert.strictEqual(input.edits[0].old_string, 'one \u2014 here');
  assert.strictEqual(input.edits[1].old_string, 'two \u2014 here');
});

test('NotebookEdit has its new_source normalized', () => {
  const dir = sandbox();
  const result = pre({
    tool_name: 'NotebookEdit',
    cwd: dir,
    tool_input: { notebook_path: path.join(dir, 'n.ipynb'), new_source: 'x = "a \u2014 b"' },
  });
  assert.strictEqual(updated(result).new_source, 'x = "a - b"');
});

test('an MCP tool has every string value normalized, however deep', () => {
  const dir = sandbox();
  const result = pre({
    tool_name: 'mcp__gmail__create_draft',
    cwd: dir,
    tool_input: {
      subject: 'a \u2014 b',
      body: { html: 'c \u2014 d', parts: ['e \u2014 f'] },
      count: 3,
      flagged: true,
      empty: null,
    },
  });
  const input = updated(result);
  assert.strictEqual(input.subject, 'a - b');
  assert.strictEqual(input.body.html, 'c - d');
  assert.strictEqual(input.body.parts[0], 'e - f');
  assert.strictEqual(input.count, 3, 'a number is carried through unchanged');
  assert.strictEqual(input.flagged, true);
  assert.strictEqual(input.empty, null);
});

test('a tool the hook does not handle is left alone', () => {
  const result = pre({ tool_name: 'Read', cwd: os.tmpdir(), tool_input: { file_path: 'a \u2014 b.md' } });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '', 'nothing to say, nothing said');
});

test('nothing to change means empty output and exit 0', () => {
  const dir = sandbox();
  const result = pre({
    tool_name: 'Write',
    cwd: dir,
    tool_input: { file_path: path.join(dir, 'a.md'), content: 'plain ascii' },
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '');
});

test('the language comes from the VOICE.md nearest the file being written', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'VOICE.md'), '---\nname: T\nkind: person\nlang: fr\n---\n');
  const result = pre({
    tool_name: 'Write',
    cwd: os.tmpdir(),
    tool_input: { file_path: path.join(dir, 'letter.md'), content: 'il dit \u201Coui\u201D' },
  });
  assert.strictEqual(updated(result).content, 'il dit \u00AB oui \u00BB');
});

test('a tool with no file takes its language from cwd', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'VOICE.md'), '---\nname: T\nkind: person\nlang: fr\n---\n');
  const result = pre({
    tool_name: 'mcp__mail__send',
    cwd: dir,
    tool_input: { body: 'il dit \u201Coui\u201D' },
  });
  assert.strictEqual(updated(result).body, 'il dit \u00AB oui \u00BB');
});
