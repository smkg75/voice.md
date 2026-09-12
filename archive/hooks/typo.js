'use strict';

// The typography hook, archived. Nothing loads it: the plugin ships no
// hooks.json at its root, and this directory is here so the work is not lost
// and so turning it back on is one file move. See README.md beside this file.
//
// It is the same table as the live command; the library is required from
// scripts/typo.js and never copied, so a character added to the specification
// reaches the archive too.
//
// The rule that governs everything below: this hook runs on every Write, every
// Edit and every MCP call, so it must never block the agent. Any internal error
// leaves through the catch at the bottom with exit 0 and no output.

const fs = require('node:fs');
const path = require('node:path');

const { normalize, resolveLang, isBinary } = require('../../scripts/typo.js');

const USAGE = [
  'voice.md typography hook, archived and loaded by nothing',
  '',
  '  node archive/hooks/typo.js pre            PreToolUse, hook JSON on stdin',
  '  node archive/hooks/typo.js post-bash      PostToolUse on Bash, hook JSON on stdin',
  '',
  '  The command that ships is scripts/typo.js. See archive/hooks/README.md.',
].join('\n');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (err) {
    return '';
  }
}

// A hook replaces or does nothing: it has no channel to report a construction
// on and no way to ask for a sentence back, which is the whole reason it was
// archived. So it asks for the behaviour it had when it was written, where a
// dash is replaced like any other character.
const ARCHIVED_TYPOGRAPHY = { Dashes: 'replace' };

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Rewrites every string in a structure, leaving numbers, booleans and nulls as
// they are. Used for MCP tools, whose tool_input shape is not known in advance:
// a mail draft, a message, a CRM note all arrive as strings somewhere inside it.
function normalizeDeep(value, lang, report) {
  if (typeof value === 'string') {
    const result = normalize(value, lang, ARCHIVED_TYPOGRAPHY);
    if (result.text !== value) report.changed = true;
    return result.text;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeDeep(item, lang, report));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = normalizeDeep(item, lang, report);
    return out;
  }
  return value;
}

// Where the text is destined decides the language: the file being written, or
// the working directory for a tool that names no file.
function anchorOf(payload, input) {
  for (const key of ['file_path', 'notebook_path']) {
    if (typeof input[key] === 'string' && input[key]) return input[key];
  }
  return typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
}

function runPre(payload) {
  if (!isPlainObject(payload)) return null;
  const input = payload.tool_input;
  if (!isPlainObject(input)) return null;
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';

  const lang = resolveLang(anchorOf(payload, input));
  const report = { changed: false };
  const fix = (text) => normalizeDeep(text, lang, report);

  let updatedInput;
  if (toolName === 'Write') {
    if (typeof input.content !== 'string') return null;
    updatedInput = Object.assign({}, input, { content: fix(input.content) });
  } else if (toolName === 'Edit') {
    // new_string only. old_string is the text already on disk; rewriting it
    // would make the edit fail to match and the tool call fail.
    if (typeof input.new_string !== 'string') return null;
    updatedInput = Object.assign({}, input, { new_string: fix(input.new_string) });
  } else if (toolName === 'MultiEdit') {
    if (!Array.isArray(input.edits)) return null;
    updatedInput = Object.assign({}, input, {
      edits: input.edits.map((edit) => (
        isPlainObject(edit) && typeof edit.new_string === 'string'
          ? Object.assign({}, edit, { new_string: fix(edit.new_string) })
          : edit
      )),
    });
  } else if (toolName === 'NotebookEdit') {
    if (typeof input.new_source !== 'string') return null;
    updatedInput = Object.assign({}, input, { new_source: fix(input.new_source) });
  } else if (toolName.startsWith('mcp__')) {
    updatedInput = normalizeDeep(input, lang, report);
  } else {
    return null;
  }

  if (!report.changed) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } };
}

// --- Redirections ---------------------------------------------------------
//
// PostToolUse is read only, so the command cannot be rewritten; what it wrote
// can. Only >, >> and tee are recognized. A > inside a quoted string is not a
// redirection, which is why this walks the command tracking quote state rather
// than matching a regular expression.

const TOKEN_END = new Set([' ', '\t', '\n', '|', '&', ';', '<', '>', '(', ')']);

function readToken(command, start) {
  let i = start;
  while (i < command.length && (command[i] === ' ' || command[i] === '\t')) i += 1;
  if (i >= command.length) return null;
  const quote = command[i];
  if (quote === '"' || quote === "'") {
    const end = command.indexOf(quote, i + 1);
    if (end === -1) return null;
    return { value: command.slice(i + 1, end), next: end + 1 };
  }
  let end = i;
  while (end < command.length && !TOKEN_END.has(command[end])) end += 1;
  if (end === i) return null;
  return { value: command.slice(i, end), next: end };
}

function redirectionTargets(command) {
  if (typeof command !== 'string') return [];
  const targets = [];
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') {
      let at = i + 1;
      if (command[at] === '>') at += 1;
      const token = readToken(command, at);
      if (token) { targets.push(token.value); i = token.next - 1; }
      continue;
    }
    // tee, as a word, then the paths that follow it until a control character.
    if (ch === 't' && command.startsWith('tee', i)
        && (i === 0 || TOKEN_END.has(command[i - 1]))
        && (i + 3 >= command.length || TOKEN_END.has(command[i + 3]))) {
      let at = i + 3;
      for (;;) {
        const token = readToken(command, at);
        if (!token) break;
        if (!token.value.startsWith('-')) targets.push(token.value);
        at = token.next;
        if (at < command.length && TOKEN_END.has(command[at]) && command[at] !== ' ' && command[at] !== '\t') break;
      }
      i = at - 1;
    }
  }
  return targets;
}

// Fixes one file in place. Returns the number of characters changed, and 0 for
// anything that is not a readable regular text file, which is how a device, a
// directory and a binary are all left alone.
function fixFile(file, lang) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return 0;
  }
  if (!stat.isFile()) return 0;

  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (err) {
    return 0;
  }
  if (isBinary(buffer)) return 0;

  const text = buffer.toString('utf8');
  const result = normalize(text, lang || resolveLang(file), ARCHIVED_TYPOGRAPHY);
  const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  if (!total) return 0;

  try {
    fs.writeFileSync(file, result.text);
  } catch (err) {
    return 0;
  }
  return total;
}

function runPostBash(payload) {
  if (!isPlainObject(payload)) return;
  const input = payload.tool_input;
  if (!isPlainObject(input)) return;
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  for (const target of redirectionTargets(input.command)) {
    if (target.startsWith('/dev/')) continue;
    fixFile(path.resolve(cwd, target), null);
  }
}

function main(argv) {
  const mode = argv[0];
  if (mode === 'pre') {
    let payload;
    try {
      payload = JSON.parse(readStdin());
    } catch (err) {
      return 0;
    }
    const answer = runPre(payload);
    if (answer) process.stdout.write(JSON.stringify(answer) + '\n');
    return 0;
  }
  if (mode === 'post-bash') {
    let payload;
    try {
      payload = JSON.parse(readStdin());
    } catch (err) {
      return 0;
    }
    runPostBash(payload);
    return 0;
  }
  // Any other argument, including none: say what this is and stop. It never
  // walks a directory, which is the live command's job.
  process.stdout.write(USAGE + '\n');
  return 0;
}

module.exports = {
  runPre, runPostBash, redirectionTargets, fixFile, normalizeDeep, USAGE, main,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    // Never block the agent, whatever happened.
    process.exitCode = 0;
  }
}
