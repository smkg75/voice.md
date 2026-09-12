'use strict';

// Rebuilds the corpus the VOICE.md in this folder was measured on, and the
// register table that run needs. The corpus itself is never stored here: it is
// 200 letters of a public domain edition, downloaded again each time.
//
//   node prepare.js <work-directory>
//
// It writes <work>/letters/<tome>-<number>.txt, one letter each, and
// <work>/registers.json, the table scripts/stylometry.js reads with --registers.
// REPLAY.md carries the two commands that come after it.
//
// Three kinds of editorial furniture are taken out, because they belong to the
// edition and not to the writer, and because a folder of plain text cannot tell
// the collector about any of them: the heading naming the recipient, the note
// lines the editor hangs under a letter, each opening with U+2191, and the
// question mark the editor sets inside a conjectural dateline, "[1836 ?]",
// which is the editor's doubt about a date and not a question the writer asked.

const fs = require('node:fs');
const path = require('node:path');

const API = 'https://fr.wikisource.org/w/api.php';
const AGENT = 'voice.md-example-replay/1.0 (public domain corpus, run locally)';
const TITLE = 'Correspondance de Gustave Flaubert/Tome ';
// 200 letters, spread evenly over the seven volumes of the Conard edition.
const PER_TOME = { 1: 29, 2: 29, 3: 29, 4: 29, 5: 28, 6: 28, 7: 28 };
const NOTE = '\u2191';
const TABLE = path.join(__dirname, 'recipients.json');
const TAG = 'lettres';

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// One request at a time, half a second apart, and a wait as long as the server
// asks for when it answers 429. A replay that hammers Wikisource gets refused.
async function api(params) {
  const url = API + '?' + new URLSearchParams(params).toString();
  for (let attempt = 0; ; attempt += 1) {
    await wait(500);
    const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
    if (response.ok) return response.json();
    if (attempt >= 5) throw new Error(url + ': HTTP ' + response.status);
    const asked = Number(response.headers.get('retry-after'));
    await wait(Math.max(asked > 0 ? asked * 1000 : 0, 5000 * (attempt + 1)));
  }
}

// Every letter page of one volume, by its number.
async function numbersOf(tome) {
  const numbers = [];
  let cont = null;
  do {
    const params = {
      action: 'query', list: 'allpages', apprefix: TITLE + tome + '/', aplimit: '500', format: 'json',
    };
    if (cont) params.apcontinue = cont;
    const data = await api(params);
    for (const page of data.query.allpages) {
      const leaf = page.title.split('/').pop();
      if (/^\d+$/.test(leaf)) numbers.push(Number(leaf));
    }
    cont = data.continue ? data.continue.apcontinue : null;
  } while (cont);
  return numbers.sort((a, b) => a - b);
}

// n items evenly spaced over a sorted list, both ends kept. Half way between two
// indexes the even one wins, so that two runs of this file pick the same letters.
function evenly(list, n) {
  if (n >= list.length) return list.slice();
  const last = list.length - 1;
  const seen = new Set();
  for (let i = 0; i < n; i += 1) {
    const exact = (i * last) / (n - 1);
    const floor = Math.floor(exact);
    const at = Math.abs(exact - floor - 0.5) < 1e-9
      ? (floor % 2 === 0 ? floor : floor + 1)
      : Math.round(exact);
    seen.add(list[at]);
  }
  return [...seen];
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', laquo: '«', raquo: '»',
};

function toText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|sup|table)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<hr\b[^>]*\/?>|<\/p>|<\/div>|<div\b[^>]*>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (hit, name) => (name in ENTITIES ? ENTITIES[name] : hit));
}

// The editor's doubt about a date, and the space French typography sets before
// it, taken out of the brackets it stands in. Nothing else on the line moves.
function undoubt(line) {
  return line.replace(/\[[^\]]*\]/g, (span) => span
    .replace(/\s*(?:\(\s*\?\s*\)|\?)\s*/g, ' ')
    .replace(/\[\s+/, '[')
    .replace(/\s+\]/, ']'));
}

// The heading of letter <number> names the recipient; the letter is what follows
// it, down to the first note line.
function letterOf(html, number) {
  const text = toText(html);
  const heading = new RegExp('(?:^|\\n)\\s*' + number + '\\.\\s+(.+?)\\s*(?:\\n|$)').exec(text);
  if (!heading) return null;

  const lines = [];
  for (const line of text.slice(heading.index + heading[0].length).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(NOTE)) break;
    // One blank line between paragraphs, never two, and none at the head.
    if (trimmed || (lines.length && lines[lines.length - 1])) lines.push(trimmed);
  }

  const body = lines.join('\n').trim().split('\n');
  body[0] = undoubt(body[0]);
  return {
    recipient: heading[1].trim().replace(/\.+$/, '').replace(/^[AÀ]\s+/, '').trim(),
    body: body.join('\n'),
  };
}

async function main(work) {
  if (!work) throw new Error('usage: node prepare.js <work-directory>');
  const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
  const letters = path.join(work, 'letters');
  fs.mkdirSync(letters, { recursive: true });

  const written = [];
  for (let tome = 1; tome <= 7; tome += 1) {
    for (const number of evenly(await numbersOf(tome), PER_TOME[tome])) {
      const page = TITLE + tome + '/' + String(number).padStart(4, '0');
      const data = await api({
        action: 'parse', page, prop: 'text', formatversion: '2', format: 'json',
      });
      const letter = letterOf(data.parse.text, number);
      if (!letter) throw new Error(page + ': no heading for letter ' + number);
      const name = tome + '-' + String(number).padStart(4, '0');
      fs.writeFileSync(path.join(letters, name + '.txt'), letter.body + '\n');
      written.push({ name, recipient: letter.recipient });
    }
  }

  // collect.js numbers the samples in the order it walks the folder, which is the
  // sorted order of these names, so the table it is handed is keyed the same way.
  written.sort((a, b) => (a.name < b.name ? -1 : 1));
  const registers = {};
  for (const [index, letter] of written.entries()) {
    const who = table.same_as[letter.name] || letter.recipient;
    const register = table.register_of[who];
    if (!register) throw new Error(letter.name + ': recipients.json places nobody named ' + who);
    registers[TAG + '-' + String(index + 1).padStart(4, '0')] = register;
  }
  fs.writeFileSync(path.join(work, 'registers.json'), JSON.stringify(registers, null, 1) + '\n');
  process.stdout.write(written.length + ' letters in ' + letters
    + ', register table in ' + path.join(work, 'registers.json') + '\n');
}

main(process.argv[2]).catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exitCode = 1;
});
