'use strict';

// Typography normalizer for voice.md.
//
// The table below is the one in docs/spec.md, which is normative. A code point
// appears here in exactly the class the specification gives it, and a test
// parses the specification and compares the two, so they cannot drift apart.
//
// Characters are named by code point rather than typed, because this file lives
// in a repository that holds itself to its own table.
//
// Two natures, as the specification says. A glyph has a straight equivalent and
// is replaced. A construction carries the shape of a sentence, so it is reported
// with the whole sentence around it and left exactly where it is: a hyphen in
// place of an aside leaves a sentence nobody wrote.

const LIGATURE_EXPANSIONS = ['ff', 'fi', 'fl', 'ffi', 'ffl', 'ft', 'st'];

function range(first, last) {
  const points = [];
  for (let point = first; point <= last; point += 1) points.push(point);
  return points;
}

// Which side a double quote sits on is a property of the character, not of the
// text around it: U+201C, U+201E and U+201F open, U+201D and U+2033 close. The
// rule is per character and holds no state, which is what the specification
// means by "applied character by character".
const OPENING_DOUBLE_QUOTES = [0x201c, 0x201e, 0x201f];

// The three characters that are a range between two digits and an aside
// everywhere else. They appear in two classes, and the context decides which.
const DASH_POINTS = [0x2013, 0x2014, 0x2015];

const TABLE = {
  Hyphens: {
    points: [0x2010, 0x2011, 0x2012, 0x2212, 0xfe58, 0xfe63, 0xff0d],
    replace: () => '-',
  },
  // Ranges is declared before Dashes: the first class whose condition holds owns
  // the character, so a dash between two digits is a range and never an aside.
  Ranges: {
    points: DASH_POINTS,
    betweenDigits: true,
    replace: () => '-',
  },
  Apostrophes: {
    points: [0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc, 0xff07],
    replace: () => "'",
  },
  'Double quotes': {
    points: [0x201c, 0x201d, 0x201e, 0x201f],
    replace: (point, lang) => {
      if (lang !== 'fr') return '"';
      return OPENING_DOUBLE_QUOTES.includes(point) ? '\u00ab ' : ' \u00bb';
    },
  },
  // A double prime measures rather than quotes: 5'10" is a height. It follows
  // U+2032, which becomes a straight apostrophe, and never takes the guillemet
  // branch, which would make a French file say something the author did not.
  'Double primes': {
    points: [0x2033],
    replace: () => '"',
  },
  Spaces: {
    points: [0x00a0, 0x1680, ...range(0x2000, 0x200a), 0x202f, 0x205f, 0x3000],
    replace: () => ' ',
  },
  Invisibles: {
    points: [0x200b, 0x2060, 0x00ad, ...range(0x2061, 0x2064), 0xfeff],
    // U+FEFF is a byte order mark at offset 0 of the file and a zero width
    // no-break space everywhere else. Only the second is removed.
    replace: (point, lang, offset) => (point === 0xfeff && offset === 0 ? null : ''),
  },
  Ellipsis: {
    points: [0x2026],
    replace: () => '...',
  },
  Ligatures: {
    points: range(0xfb00, 0xfb06),
    replace: (point) => LIGATURE_EXPANSIONS[point - 0xfb00],
  },
  'Fraction slashes': {
    points: [0x2044, 0x2215],
    replace: () => '/',
  },
  // Reported, never rewritten. The replacement below is unreachable unless a
  // profile asks for it by name with `Dashes: replace`, which is the one way
  // someone can decide an aside is worth a hyphen in their own text.
  Dashes: {
    points: DASH_POINTS,
    reported: true,
    replace: () => '-',
  },
};

// Named so a reader can see they were considered, and so the test can hold the
// specification to them. Nothing in normalize touches a character that is not
// in TABLE, so this list is documentation with a test behind it.
const PRESERVED = [
  0x200c, 0x200d, 0xfe0e, 0xfe0f, 0x200e, 0x200f, 0x00b7, 0x0153, 0x00e6,
  0x2022, 0x2192, 0x00d7, 0x00ab, 0x00bb,
];

// A point can sit in two classes, so this holds every class that claims it, in
// the order the table declares them.
const CLASSES_OF = new Map();
for (const [name, entry] of Object.entries(TABLE)) {
  for (const point of entry.points) {
    if (!CLASSES_OF.has(point)) CLASSES_OF.set(point, []);
    CLASSES_OF.get(point).push({ name, entry });
  }
}

// 'U+2014' for 0x2014: the label a report and a count are keyed by.
function label(point) {
  return 'U+' + point.toString(16).toUpperCase().padStart(4, '0');
}

function isDigit(point) {
  return point !== undefined && point >= 0x30 && point <= 0x39;
}

// The class that owns this character here. Order decides: Ranges before Dashes.
function classOf(point, before, after) {
  const candidates = CLASSES_OF.get(point);
  if (!candidates) return null;
  for (const candidate of candidates) {
    if (candidate.entry.betweenDigits && !(isDigit(before) && isDigit(after))) continue;
    return candidate;
  }
  return null;
}

// normalize(text, lang, typography) -> { text, counts, constructions }. Pure,
// and the only place a character is rewritten. Consecutive spaces are never
// merged: one character in, one character out, which is what protects the
// indentation of code. `typography` is the front matter key of the resolved
// profile, a class name to 'replace' or 'keep'; an absent class keeps the
// nature the table gives it.
function normalize(text, lang, typography) {
  const declared = typography || {};
  const counts = {};
  const constructions = [];
  let out = '';
  let offset = 0;
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    const width = point > 0xffff ? 2 : 1;
    const found = classOf(point, text.codePointAt(offset - 1), text.codePointAt(offset + width));
    if (found) {
      // Three states: the profile says keep, the profile says replace, or the
      // profile is silent and the class keeps the nature the table gives it.
      const asked = declared[found.name];
      if (asked === 'keep') {
        // Left alone, and nothing said about it, which is what keep means.
      } else if (asked !== 'replace' && found.entry.reported) {
        constructions.push({ point, index: offset });
      } else {
        const replacement = found.entry.replace(point, lang, offset);
        if (replacement !== null) {
          out += replacement;
          counts[label(point)] = (counts[label(point)] || 0) + 1;
          offset += width;
          continue;
        }
      }
    }
    out += text.slice(offset, offset + width);
    offset += width;
  }
  return { text: out, counts, constructions };
}

// --- Resolution -----------------------------------------------------------
//
// "Where a file lives" in docs/spec.md: an explicit designation first, then the
// nearest file walking up from where the text is destined, looking at VOICE.md
// then .agents/VOICE.md at each level, then the one under the home directory.
// Nothing is merged along the way: the first file found is the whole profile,
// so a profile that declares no lang answers 'en' rather than letting the next
// one up answer for it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LANG = 'en';

function frontMatterOf(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? match[1] : '';
}

// The one nested key the format defines. Read by hand rather than with a YAML
// parser, because a dependency here would have to be installed before a hook or
// a one-off npx call could straighten a single apostrophe.
function readTypography(front) {
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => /^typography:[ \t]*$/.test(line));
  if (start === -1) return {};
  const declared = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^[ \t]+\S/.test(line)) break;
    const entry = /^[ \t]+["']?(.+?)["']?[ \t]*:[ \t]*(\w+)[ \t]*$/.exec(line);
    if (!entry) continue;
    const [, name, value] = entry;
    // A class the table does not define, or a value that is neither, is ignored
    // and the class keeps the nature the table gives it.
    if (TABLE[name] && (value === 'replace' || value === 'keep')) declared[name] = value;
  }
  return declared;
}

function readProfile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return null;
  }
  const front = frontMatterOf(text);
  const lang = /^lang:[ \t]*([A-Za-z][A-Za-z0-9-]*)/m.exec(front);
  return { file, lang: lang ? lang[1] : DEFAULT_LANG, typography: readTypography(front) };
}

function startingDirectory(start) {
  try {
    if (fs.statSync(start).isDirectory()) return path.resolve(start);
  } catch (err) {
    // A path that does not exist is read as a file path, which is what a tool
    // sees when the agent is creating a file rather than editing one.
  }
  return path.resolve(path.dirname(start));
}

// The profile that governs a path, or null. The home fallback is last, and is
// the reason a machine with no VOICE.md anywhere gets an error rather than a
// silent default.
function resolveProfile(start, home) {
  const ceiling = home || os.homedir();
  let current = startingDirectory(start);
  for (;;) {
    for (const candidate of [path.join(current, 'VOICE.md'), path.join(current, '.agents', 'VOICE.md')]) {
      const profile = readProfile(candidate);
      if (profile) return profile;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return readProfile(path.join(ceiling, '.agents', 'VOICE.md'));
}

// The lenient reading, for a caller that has to answer something whatever it
// finds. The command line uses resolveProfile and refuses instead.
function resolveLang(start, home) {
  const profile = resolveProfile(start, home);
  return profile ? profile.lang : DEFAULT_LANG;
}

// --- Files ----------------------------------------------------------------

// Directories holding files nobody authored: a version control store, a package
// store, a build output, a cache. Walking them makes a report a number about
// someone else's code.
const SKIP_DIRECTORIES = new Set([
  '.git', 'node_modules', '.pnpm-store', '.yarn', '.next', '.turbo', '.cache',
  'dist', 'build', 'coverage', '__pycache__', '.venv', 'vendor',
]);

// A NUL byte is what tells a binary from text. Reading a binary as UTF-8 and
// writing it back would replace every invalid sequence with U+FFFD, which is
// the one way this tool could destroy something it was pointed at.
function isBinary(buffer) {
  return buffer.includes(0);
}

function collect(target, found) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    return { missing: [target] };
  }
  if (!stat.isDirectory()) {
    found.push(target);
    return { missing: [] };
  }
  const missing = [];
  for (const item of fs.readdirSync(target, { withFileTypes: true })) {
    if (item.isDirectory() && SKIP_DIRECTORIES.has(item.name)) continue;
    // The agent's own copies of a repository duplicate its source. The rest of
    // .claude is text the agent writes, and a worktrees directory anywhere else
    // is an ordinary directory.
    if (item.isDirectory() && item.name === 'worktrees' && path.basename(target) === '.claude') continue;
    if (item.isSymbolicLink()) continue;
    const child = path.join(target, item.name);
    const result = collect(child, found);
    missing.push(...result.missing);
  }
  return { missing };
}

// --- The sentence around a construction -----------------------------------
//
// What the second half of the report shows. A construction is handed back with
// the sentence it sits in, because that sentence is the unit being rewritten,
// and a line number alone sends the reader back to the file to find out what
// the character was doing.

const SENTENCE_CAP = 320;

// What opens a block rather than continuing a paragraph: a list marker, a
// heading, a quotation, a table row, a numbered item, and a dash at the head of
// a line, which is a list item in markdown and a turn of speech in French.
const BLOCK_MARKER = /^[ \t]*([-*+>#|\u2013\u2014\u2015]|\d+[.)])[ \t]/;

// A newline is a soft wrap inside a paragraph and a boundary before a blank line
// or a block marker. Markdown prose is hard wrapped, so treating every newline
// as a boundary would cut most sentences in half.
function blockBoundary(text, index) {
  if (text[index] !== '\n') return false;
  const rest = text.slice(index + 1, index + 12);
  return /^[ \t]*(\r?\n|$)/.test(rest) || BLOCK_MARKER.test(rest);
}

function endOfLine(text, from) {
  const at = text.indexOf('\n', from);
  return at === -1 ? text.length : at;
}

// The span is what identifies a sentence, and an aside has two dashes in it:
// keyed by the span, one sentence is listed once however many characters in it
// asked for the rewrite.
function sentenceSpan(text, index) {
  let start = 0;
  for (let i = index - 1; i > 0; i -= 1) {
    if (blockBoundary(text, i)) { start = i + 1; break; }
    if ('.!?'.includes(text[i]) && /[\s]/.test(text[i + 1] || ' ')) { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = index + 1; i < text.length; i += 1) {
    if (blockBoundary(text, i)) { end = i; break; }
    if ('.!?'.includes(text[i]) && /[\s]/.test(text[i + 1] || ' ')) { end = i + 1; break; }
  }
  // Past the blank line or the indent the boundary landed on, so the line
  // reported is the one the sentence is actually written on.
  while (start < index && /\s/.test(text[start])) start += 1;

  // A line that opens on a marker is a sentence of its own and ends with its
  // line: a list item and a line of dialogue do not run on into the paragraph
  // under them the way a hard-wrapped one does.
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const opensTheLine = /^[ \t]*$/.test(text.slice(lineStart, start));
  if (opensTheLine && BLOCK_MARKER.test(text.slice(start, start + 12))) {
    end = Math.min(end, endOfLine(text, start));
  }
  return { start, end };
}

function sentenceAround(text, index) {
  const { start, end } = sentenceSpan(text, index);
  const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (sentence.length <= SENTENCE_CAP) return sentence;
  // A minified line or a table row is not a sentence; show the neighbourhood.
  const at = Math.max(0, index - start - SENTENCE_CAP / 2);
  return '... ' + sentence.slice(at, at + SENTENCE_CAP).trim() + ' ...';
}

function lineNumbers(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

// --- Command line ---------------------------------------------------------

const USAGE = [
  'voice.md typography normalizer',
  '',
  '  npx voice.md typo [--check | --fix] [--voice <VOICE.md>] [--lang <code>] <files or directories>',
  '',
  '  no flag   report what would be replaced, and what has to be rewritten',
  '  --fix     write the replacements back; constructions are listed, never written',
  '  --check   write nothing, exit 1 if either list has anything in it',
  '  --voice   the profile to read: its lang and its typography key',
  '  --lang    a language and the whole table, for a tree with no profile in it',
  '',
  '  Without --voice and without --lang, the nearest VOICE.md walking up from',
  '  each file decides, then ~/.agents/VOICE.md. With neither, nothing is read',
  '  and the exit code is 2.',
].join('\n');

function parseArgs(argv) {
  const options = { mode: 'report', lang: null, voice: null, targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fix') options.mode = 'fix';
    else if (arg === '--check') options.mode = 'check';
    else if (arg === '--lang') { i += 1; options.lang = argv[i] || null; }
    else if (arg.startsWith('--lang=')) options.lang = arg.slice('--lang='.length);
    else if (arg === '--voice') { i += 1; options.voice = argv[i] || null; }
    else if (arg.startsWith('--voice=')) options.voice = arg.slice('--voice='.length);
    else options.targets.push(arg);
  }
  return options;
}

function missingProfile(directory) {
  return 'no VOICE.md found walking up from ' + directory
    + ', nor at ~/.agents/VOICE.md; pass --voice <path> or create one';
}

function runCli(argv, write, writeError) {
  const options = parseArgs(argv);
  if (!options.targets.length) {
    write(USAGE);
    return 0;
  }

  // The designation, resolved once. --lang alone means this language and the
  // whole table, and reads no profile at all: a tree with no VOICE.md in it,
  // a continuous integration run, a one-off on a file that belongs to nobody.
  let designated = null;
  if (options.voice) {
    designated = readProfile(options.voice);
    if (!designated) {
      writeError(options.voice + ': cannot be read as a VOICE.md');
      return 2;
    }
  }

  const files = [];
  const missing = [];
  for (const target of options.targets) {
    missing.push(...collect(target, files).missing);
  }
  for (const target of missing) writeError(target + ': cannot be read');

  // Resolved per directory rather than per file, since the answer is the same
  // for every file beside it and a walk costs a stat at each level.
  const byDirectory = new Map();
  function profileFor(file) {
    if (designated) return designated;
    if (options.lang) return null;
    const directory = startingDirectory(file);
    if (!byDirectory.has(directory)) byDirectory.set(directory, resolveProfile(file));
    return byDirectory.get(directory);
  }

  const report = [];
  const rewrite = [];
  const totals = {};
  let changedFiles = 0;
  let changedCharacters = 0;

  for (const file of files) {
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (err) {
      writeError(file + ': cannot be read');
      continue;
    }
    if (isBinary(buffer)) continue;

    const profile = profileFor(file);
    if (!profile && !options.lang) {
      writeError(missingProfile(startingDirectory(file)));
      return 2;
    }
    const lang = options.lang || profile.lang;
    const text = buffer.toString('utf8');
    const result = normalize(text, lang, profile ? profile.typography : {});

    if (result.constructions.length) {
      const lineOf = lineNumbers(text);
      const sentences = new Map();
      for (const found of result.constructions) {
        const { start } = sentenceSpan(text, found.index);
        if (!sentences.has(start)) {
          sentences.set(start, { line: lineOf(start), text: sentenceAround(text, found.index), points: new Set() });
        }
        sentences.get(start).points.add(label(found.point));
      }
      for (const one of sentences.values()) {
        rewrite.push(file + ':' + one.line + '  ' + [...one.points].sort().join(' ') + '  ' + one.text);
      }
    }

    const counted = Object.entries(result.counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!counted.length) continue;

    changedFiles += 1;
    report.push(file);
    for (const [name, count] of counted) {
      report.push('  ' + name + '  ' + count);
      totals[name] = (totals[name] || 0) + count;
      changedCharacters += count;
    }

    if (options.mode === 'fix') {
      try {
        fs.writeFileSync(file, result.text);
      } catch (err) {
        writeError(file + ': cannot be written');
      }
    }
  }

  if (report.length) {
    // Over one file the totals are the file's own block again, word for word.
    if (changedFiles > 1) {
      report.push('');
      for (const [name, count] of Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        report.push(name + '  ' + count);
      }
    }
    report.push('');
    report.push(changedCharacters + ' characters in ' + changedFiles + ' of ' + files.length + ' files');
    write(report.join('\n'));
  }

  if (rewrite.length) {
    write([
      '',
      'to rewrite, one sentence each: a hyphen in place of an aside leaves a sentence nobody wrote',
      '',
      ...rewrite,
      '',
      rewrite.length + (rewrite.length === 1 ? ' sentence' : ' sentences') + ' to rewrite',
    ].join('\n'));
  }

  return options.mode === 'check' && (changedCharacters || rewrite.length) ? 1 : 0;
}

function main(argv) {
  return runCli(
    argv,
    (text) => process.stdout.write(text + '\n'),
    (text) => process.stderr.write(text + '\n')
  );
}

module.exports = {
  TABLE, PRESERVED, normalize, label, DEFAULT_LANG,
  readProfile, resolveProfile, resolveLang, startingDirectory,
  parseArgs, runCli, isBinary, USAGE, sentenceAround, sentenceSpan, SKIP_DIRECTORIES, main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
