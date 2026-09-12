'use strict';

// Sample collection, handoff section 7. Every mailbox below is synthetic, and
// every address in it is at example.com or example.fr, which no one owns.
//
// Fixtures name a character by escape and never carry it, for the reason
// fixtures.test.js states: a literal one would be rewritten by the typography
// hook and the test holding it would then pass without checking anything.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const collect = require('../scripts/collect.js');
const COLLECT = path.join(__dirname, '..', 'scripts', 'collect.js');

const ME = 'writer@example.com';

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-collect-'));
}

// One mbox message: the envelope line, the headers as given, a blank line, the
// body, and the blank line that separates it from the next envelope line.
function message(headers, body) {
  return ['From - Wed Mar  4 10:00:00 2026', headers.trim(), '', body, ''].join('\n');
}

function mailbox(dir, name, messages) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, Buffer.concat(messages.map((part) => (
    Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8')
  ))));
  return full;
}

// partText reads a message the way collectMbox hands it over: one code unit per
// byte, so that each part can be decoded in the charset its own header names.
function asBytes(text) {
  return Buffer.from(text, 'utf8').toString('latin1');
}
function fromMe(extra) {
  return ['From: The Writer <' + ME + '>', 'To: Client <client@example.fr>',
    'Date: Wed, 4 Mar 2026 10:00:00 +0100'].concat(extra || []).join('\n');
}

function run(dir, name, messages, args) {
  const file = mailbox(dir, name, messages);
  return collect.collectMbox(file, Object.assign({ tag: 'pro', me: [ME] }, args || {}));
}

// --- The mbox and MIME parser ---------------------------------------------

test('messages are separated on the From line, and an escaped one in a body is restored', () => {
  const raw = message(fromMe(), 'first\n>From the top of the hill, all is fine')
    + '\n' + message(fromMe(), 'second');
  const messages = collect.splitMbox(raw);
  assert.strictEqual(messages.length, 2);
  assert.match(messages[0], /^From the top of the hill/m);
  assert.doesNotMatch(messages[0], /^>From/m);
});

test('a folded header is read as one line', () => {
  const raw = message([
    'From: The Writer <' + ME + '>',
    'To: Client <client@example.fr>,',
    '\tSecond <second@example.fr>',
    'Subject: a subject that runs',
    ' over two lines',
    'Date: Wed, 4 Mar 2026 10:00:00 +0100',
  ].join('\n'), 'body');
  const { headers } = collect.splitMessage(collect.splitMbox(raw)[0]);
  assert.strictEqual(headers.subject, 'a subject that runs over two lines');
  assert.deepStrictEqual(
    collect.addressesOf(headers.to),
    ['client@example.fr', 'second@example.fr']
  );
});

test('a multipart message keeps the plain text part and leaves the HTML one', () => {
  const body = [
    '--sep', 'Content-Type: text/plain; charset=utf-8', '', 'the plain words',
    '--sep', 'Content-Type: text/html; charset=utf-8', '', '<p>the html words</p>',
    '--sep--', '',
  ].join('\n');
  const raw = message(fromMe(['Content-Type: multipart/alternative; boundary="sep"']), body);
  const part = collect.partText(asBytes(collect.splitMbox(raw)[0]), 0);
  assert.strictEqual(part.type, 'text/plain');
  assert.strictEqual(part.text.trim(), 'the plain words');
});

test('a message with nothing but HTML is reduced to text', () => {
  const html = '<div><p>Bonjour,</p><p>le devis part demain.<br>Merci.</p>'
    + '<ul><li>un</li><li>deux</li></ul><span>&amp; voil\u00E0</span></div>';
  const raw = message(fromMe(['Content-Type: text/html; charset=utf-8']), html);
  const part = collect.partText(asBytes(collect.splitMbox(raw)[0]), 0);
  assert.strictEqual(part.type, 'text/html');
  assert.match(part.text, /Bonjour,/);
  assert.match(part.text, /- un/);
  assert.match(part.text, /& voil\u00E0/);
  assert.doesNotMatch(part.text, /<[a-z]/i);
});

test('a base64 body is decoded', () => {
  const payload = Buffer.from('Bonjour,\n\nle devis part demain.\n', 'utf8').toString('base64');
  const raw = message(fromMe([
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ]), payload);
  const part = collect.partText(asBytes(collect.splitMbox(raw)[0]), 0);
  assert.match(part.text, /le devis part demain\./);
});

test('a quoted-printable body is decoded, soft line breaks included', () => {
  const raw = message(fromMe([
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ]), 'R=C3=A9union pr=C3=A9vue jeudi, le dossier est pr=C3=AAt =\net sign=C3=A9.');
  const part = collect.partText(asBytes(collect.splitMbox(raw)[0]), 0);
  assert.match(part.text, /R\u00E9union pr\u00E9vue jeudi/);
  assert.match(part.text, /pr\u00EAt et sign\u00E9\./);
});

test('a latin1 body is read in its own charset', () => {
  const dir = sandbox();
  const raw = message(fromMe(['Content-Type: text/plain; charset=iso-8859-1']),
    'R\u00E9union pr\u00E9vue jeudi, tr\u00E8s bien.');
  const file = mailbox(dir, 'latin1.mbox', [Buffer.from(raw, 'latin1')]);
  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });
  assert.strictEqual(result.samples.length, 1);
  assert.match(result.samples[0].text, /R\u00E9union pr\u00E9vue jeudi, tr\u00E8s bien\./);
});

test('an encoded word in a header is decoded', () => {
  assert.strictEqual(
    collect.decodeEncodedWords('=?UTF-8?B?' + Buffer.from('R\u00E9union', 'utf8').toString('base64') + '?='),
    'R\u00E9union'
  );
  assert.strictEqual(collect.decodeEncodedWords('=?ISO-8859-1?Q?R=E9union?='), 'R\u00E9union');
});

// --- windows-125x ----------------------------------------------------------
//
// The family Outlook and Apple Mail declare when they send smart punctuation.
// Its apostrophe, its dashes, its quotation marks and its ellipsis live in the
// bytes 0x80 to 0x9F, where latin1 has invisible controls and nothing else. Read
// as latin1 they leave no character to count and no word boundary either, which
// is exactly the one statistic the setup keeps apart from the voice.

// The body of a message an Outlook user sent: an apostrophe (0x92), an ellipsis
// (0x85), two dashes (0x97), a pair of quotation marks (0x93 and 0x94) and a
// currency sign (0x80), each named by the byte that carries it.
const CP1252_BODY = [
  'Bonjour,',
  '',
  'L\u0092affaire avance\u0085 le devis \u0097 trois semaines de travaux \u0097 part',
  'demain, \u0093 sans surprise \u0094 comme convenu. Le budget tient : 480 \u0080 de marge.',
  '',
  'Cordialement,',
].join('\n');

function cp1252Mailbox(dir, name, body) {
  const raw = message(fromMe(['Content-Type: text/plain; charset=windows-1252']), body);
  return mailbox(dir, name, [Buffer.from(raw, 'latin1')]);
}

// Every string the document holds, whatever the shape of the object around it.
function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

// No control reaches a sample, and neither does a replacement character. The C1
// range is what a cp1252 body carries when it is read as latin1; the C0 range,
// NUL and DEL are what a utf-16 or utf-32 body carries when it is read as
// anything else; U+FFFD is what a lenient decoder writes where it gave up. A
// negative class this wide is cheap to state and each piece of it has been seen.
const C1 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/;

test('a windows-1252 body comes back with the punctuation those bytes encode', () => {
  const dir = sandbox();
  const file = cp1252Mailbox(dir, 'outlook.mbox', CP1252_BODY);

  const sample = collect.collectMbox(file, { tag: 'pro', me: [ME] }).samples[0];

  assert.ok(sample.text.includes('L\u2019affaire avance\u2026'), sample.text);
  assert.ok(sample.text.includes('\u2014 trois semaines de travaux \u2014'), sample.text);
  assert.ok(sample.text.includes('\u201c sans surprise \u201d'), sample.text);
  assert.ok(sample.text.includes('\u20ac'), sample.text);
});

test('no C1 control travels into the document a windows-1252 mailbox produces', () => {
  const dir = sandbox();
  const file = cp1252Mailbox(dir, 'outlook.mbox', CP1252_BODY);

  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.samples.length, 1);
  for (const text of strings(result)) assert.doesNotMatch(text, C1, JSON.stringify(text));
});

// The number stylometry reports as typographic_base. It is counted here with the
// table of the repository itself rather than through the stylometry, so that
// this file measures what collect.js hands over and nothing further down.
const TYPOGRAPHIC = new Set(Object.values(require('../scripts/typo.js').TABLE)
  .flatMap((entry) => entry.points));

function typographicCount(text) {
  let found = 0;
  for (const ch of text) if (TYPOGRAPHIC.has(ch.codePointAt(0))) found += 1;
  return found;
}

test('the typographic base of a windows-1252 mailbox is not zero', () => {
  const dir = sandbox();
  const file = cp1252Mailbox(dir, 'outlook.mbox', CP1252_BODY);

  const sample = collect.collectMbox(file, { tag: 'pro', me: [ME] }).samples[0];

  // One apostrophe, one ellipsis, two dashes and two quotation marks.
  assert.strictEqual(typographicCount(sample.text), 6);
});

test('the cp1252 map covers the whole 0x80 to 0x9F range, and only that charset', () => {
  const range = Array.from({ length: 32 }, (all, index) => String.fromCharCode(0x80 + index)).join('');

  for (const name of ['windows-1252', 'WINDOWS-1252', 'cp1252', 'x-cp1252',
    'cp-1252', 'windows_1252', 'iso-8859-1', 'latin1', 'us-ascii']) {
    const decoded = collect.decodeCharset(range, name);
    // No C1 control survives the map, which is what it is for.
    assert.doesNotMatch(decoded, /[\u0080-\u009f]/, name);
    assert.ok(decoded.includes('\u20ac'), name);
    assert.ok(decoded.includes('\u2019'), name);
    assert.ok(decoded.includes('\u0153'), name);
    // The five positions the charset leaves undefined answer U+FFFD, which is
    // how undecoded() sees that the label was wrong.
    assert.strictEqual((decoded.match(/\ufffd/g) || []).length, 5, name);
  }

  // 8859-1 calls that range controls, and the Encoding Standard makes it an
  // alias of windows-1252 for exactly this reason: the clients that declare the
  // one write the bytes of the other. A letter sits outside the map either way.
  assert.strictEqual(collect.decodeCharset('R\u00E9union', 'iso-8859-1'), 'R\u00E9union');
  assert.doesNotMatch(collect.decodeCharset(range, 'iso-8859-1'), /[\u0080-\u009f]/);
});

test('an encoded word declaring windows-1252 is decoded in that charset', () => {
  assert.strictEqual(
    collect.decodeEncodedWords('=?windows-1252?Q?L=92affaire?='),
    'L\u2019affaire'
  );
});

// A declaration is a claim about the bytes, and a mailbox that spans ten years
// holds messages whose claim is wrong in both directions. Every row below
// carries the same six characters a Windows client typed, and none of them may
// put a C1 control into the document or lose a character on the way.
// The prose every row carries, written once here and compared against what comes
// back. A negative assertion ("no control got through") passes over a body that
// came back as mojibake; only the text the sender typed, set beside the text the
// decoder returned, catches a character invented or lost on the way.
const CP1252_PROSE = 'L\u2019affaire avance\u2026 le devis \u2014 trois semaines \u2014 part demain.';

// The map read backwards, out of the decoder itself: the byte a Windows client
// writes for each of these characters. The five positions the charset leaves
// undefined come back as a space and are left out, so that a space in the prose
// still travels as a space.
function cp1252Bytes(text) {
  const back = new Map();
  for (let index = 0; index < 32; index += 1) {
    const decoded = collect.decodeCharset(String.fromCharCode(0x80 + index), 'windows-1252');
    if (decoded !== ' ') back.set(decoded, 0x80 + index);
  }
  return Buffer.from(Array.from(text, (ch) => (back.has(ch) ? back.get(ch) : ch.charCodeAt(0))));
}

const LATIN9_PROSE = 'Le c\u0153ur du sujet, c\'est que 1200 \u20ac reste ferme.';

// latin-9 is latin1 with eight positions moved: 0xBD is the oe ligature and 0xA4
// the euro sign, where windows-1252 puts a fraction and a currency sign.
function latin9Bytes(text) {
  const moved = new Map([['\u0153', 0xbd], ['\u20ac', 0xa4]]);
  return Buffer.from(Array.from(text, (ch) => (moved.has(ch) ? moved.get(ch) : ch.charCodeAt(0))));
}

const CHARSET_ROWS = [
  ['windows-1252', 'Content-Type: text/plain; charset=windows-1252', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['cp1252', 'Content-Type: text/plain; charset="cp1252"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['cp-1252', 'Content-Type: text/plain; charset="cp-1252"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['windows_1252', 'Content-Type: text/plain; charset="windows_1252"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['iso-8859-1', 'Content-Type: text/plain; charset="iso-8859-1"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['latin1', 'Content-Type: text/plain; charset="latin1"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['us-ascii', 'Content-Type: text/plain; charset="us-ascii"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['utf-8 over cp1252 bytes', 'Content-Type: text/plain; charset="utf-8"', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['no charset parameter', 'Content-Type: text/plain', cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  ['no content type at all', null, cp1252Bytes(CP1252_PROSE), CP1252_PROSE],
  // The codepage French mail used for the euro through the 2000s. It is in the
  // 8859 family and it is not an alias of windows-1252: read as one, the oe
  // ligature comes back a fraction and the euro sign a currency sign.
  ['latin-9 declared', 'Content-Type: text/plain; charset="iso-8859-15"', latin9Bytes(LATIN9_PROSE), LATIN9_PROSE],
  // One byte of another codepage in an otherwise utf-8 body. The sniff is
  // all-or-nothing, so this one byte used to send the whole message through the
  // cp1252 map and fabricate the punctuation of every sequence in it.
  ['utf-8 with one stray byte', 'Content-Type: text/plain; charset="utf-8"',
    Buffer.concat([Buffer.from(CP1252_PROSE, 'utf8'), Buffer.from([0x92])]),
    CP1252_PROSE + '\u2019'],
];

function charsetMailbox(dir, header, bytes) {
  const head = ['From - Wed Mar  4 10:00:00 2026', fromMe(header ? [header] : []).trim(), '', 'Bonjour,', ''].join('\n') + '\n';
  return mailbox(dir, 'outlook.mbox', [
    Buffer.from(head, 'latin1'), bytes, Buffer.from('\n\nCordialement,\n', 'latin1'),
  ]);
}

test('every declaration a mail client writes gives back the text that was written', () => {
  for (const [name, header, bytes, written] of CHARSET_ROWS) {
    const dir = sandbox();
    const file = charsetMailbox(dir, header, bytes);

    const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

    assert.strictEqual(result.samples.length, 1, name);
    for (const text of strings(result)) assert.doesNotMatch(text, C1, name + ': ' + JSON.stringify(text));
    assert.ok(result.samples[0].text.includes(written), name + ': ' + JSON.stringify(result.samples[0].text));
  }
});

// A width no narrower read approximates. Half the bytes of a utf-16 body are
// NUL, so a body whose declared width its own bytes refuse is not a message
// anything downstream can measure: it is counted as unreadable and dropped,
// rather than handed over as a sample with a word between every letter.
test('a body declared in a width its bytes do not fit is refused, not measured', () => {
  const dir = sandbox();
  const body = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('Bonjour, le devis part demain matin et la commande suit.', 'utf16le'),
  ]);
  const head = ['From - Wed Mar  4 10:00:00 2026',
    fromMe(['Content-Type: text/plain; charset="utf-16"']).trim(), '', ''].join('\n');
  // One byte short, the way the mbox cutter leaves a tail it split on a line
  // ending: an odd count of bytes fits no width of two.
  const file = mailbox(dir, 'exported.mbox', [Buffer.from(head, 'latin1'), body.subarray(0, -1)]);

  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.samples.length, 0);
  assert.strictEqual(result.counts.dropped.unreadable, 1);
  assert.strictEqual(result.decoding.doubtful, 1);
  assert.deepStrictEqual(result.decoding.charsets, ['utf-16']);
});

// An exporter that cuts a body mid-sequence loses the character it cut and
// nothing else: the message before the cut is still the message the person sent.
test('a body cut mid-sequence keeps everything that stood before the cut', () => {
  const dir = sandbox();
  const whole = Buffer.from(CP1252_PROSE + ' \u00e9', 'utf8');
  const file = charsetMailbox(dir, 'Content-Type: text/plain; charset="utf-8"', whole.subarray(0, -1));

  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.samples.length, 1);
  for (const text of strings(result)) assert.doesNotMatch(text, C1, JSON.stringify(text));
  assert.ok(result.samples[0].text.includes(CP1252_PROSE), JSON.stringify(result.samples[0].text));
});

// The other direction of the same mislabelling: a part that declares a single
// byte charset and carries utf-8. Reading its bytes one by one hands the
// stylometry a quotation mark nobody typed, which the normalizer then rewrites
// into a guillemet, and the count says the person writes with them.
test('a windows-1252 declaration over utf-8 bytes invents no punctuation', () => {
  const written = 'L\u2019affaire avance\u2026 le devis \u2014 trois semaines \u2014 part demain.';

  const decoded = collect.decodeCharset(Buffer.from(written, 'utf8').toString('latin1'), 'windows-1252');

  assert.strictEqual(decoded, written);
  assert.doesNotMatch(decoded, /[\u201c\u201d]/);
});

// A byte no charset defines is not a character the writer typed, it is the sign
// that the label was wrong. It used to become a space, which read as text and
// was measured; it now answers U+FFFD, and undecoded() counts the whole message
// unreadable rather than measuring what is left of it.
test('a byte the charset leaves undefined marks the message rather than passing for a space', () => {
  const decoded = collect.decodeCharset('mot\u0081suite', 'windows-1252');
  assert.strictEqual(decoded, 'mot\ufffdsuite');
  assert.ok(collect.undecoded(decoded));
  assert.ok(!collect.undecoded('mot suite'));
});

// A Windows client writes its punctuation as the cp1252 code number rather than
// as the unicode one: &#146; for the apostrophe, &#151; for the dash. Expanding
// those numbers literally manufactures the controls the charset decode just
// took out.
test('a numeric entity naming a cp1252 position is the punctuation it stands for', () => {
  assert.strictEqual(
    collect.htmlToText('&#146;&#150;&#133;&#151;&#147;&#148;'),
    '\u2019\u2013\u2026\u2014\u201c\u201d'
  );
  assert.strictEqual(collect.htmlToText('&#x92;'), '\u2019');
  // Everything outside that range is left where it stands.
  assert.strictEqual(collect.htmlToText('&#8217;&#233;'), '\u2019\u00E9');
});

// The same expansion, handed a number that names no character. A generator
// counting in the wrong base, a truncated run of figures and a stray '&#0;'
// all reach a real mailbox, and what they name is either past the last code
// point Unicode has, half of a surrogate pair, or a control nobody types.
// Expanding the first by hand throws, and a run that dies on one message loses
// the whole mailbox; the other two write a control into the sample, which is
// the defect the charset decode was fixed for, arriving by the other door. The
// number is read the way the charset reads a byte it leaves undefined: a
// space, which keeps the boundary between the two words it stood between.
const C0 = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]');
const REPLACEMENT = new RegExp('\\ufffd');

test('a numeric entity naming no character is a space, and never a crash', () => {
  assert.strictEqual(collect.htmlToText('mot&#1114112;suite'), 'mot suite');
  assert.strictEqual(collect.htmlToText('mot&#x110000;suite'), 'mot suite');
  assert.strictEqual(collect.htmlToText('mot&#99999999999;suite'), 'mot suite');
  assert.strictEqual(collect.htmlToText('mot&#55296;suite'), 'mot suite');
  assert.strictEqual(collect.htmlToText('mot&#xd800;suite'), 'mot suite');
  assert.strictEqual(collect.htmlToText('mot&#0;suite'), 'mot suite');
  // A tab is a character someone typed and a line break is the shape of the
  // message: both are text, and both stay.
  assert.strictEqual(collect.htmlToText('mot&#9;suite'), 'mot\tsuite');
  assert.strictEqual(collect.htmlToText('deux&#10;lignes'), 'deux\nlignes');
});

test('an html body carries no control of either range into the document', () => {
  const dir = sandbox();
  const body = '<p>L&#146;affaire&#0; avance&#133; le devis part demain&#1114112; sans'
    + ' surprise, &#147; comme convenu &#148; avec le budget dont nous avions parl\u00E9.</p>';
  const raw = message(fromMe(['Content-Type: text/html; charset=windows-1252']), body);
  const file = mailbox(dir, 'outlook.mbox', [Buffer.from(raw, 'latin1')]);

  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.samples.length, 1);
  for (const text of strings(result)) {
    assert.doesNotMatch(text, C1, JSON.stringify(text));
    assert.doesNotMatch(text, C0, JSON.stringify(text));
    assert.doesNotMatch(text, REPLACEMENT, JSON.stringify(text));
  }
  assert.strictEqual(typographicCount(result.samples[0].text), 4);
});

test('an html body a Windows client sent carries no C1 control into the document', () => {
  const dir = sandbox();
  const body = '<p>L&#146;affaire avance&#133; le devis &#151; trois semaines de travaux &#151; part'
    + ' demain, &#147; sans surprise &#148; comme convenu.</p>';
  const raw = message(fromMe(['Content-Type: text/html; charset=windows-1252']), body);
  const file = mailbox(dir, 'outlook.mbox', [Buffer.from(raw, 'latin1')]);

  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.samples.length, 1);
  for (const text of strings(result)) assert.doesNotMatch(text, C1, JSON.stringify(text));
  assert.strictEqual(typographicCount(result.samples[0].text), 6);
});

// The folder adapter reads the samples the header calls the closest thing to
// what the user approves. A letter saved by an older editor is not utf-8, and a
// lenient read turns every high byte into a replacement character while the
// sample is kept, weighed and counted all the same.
const LETTER_BYTES = [
  'Cher Monsieur,',
  '',
  'L\u0092affaire avance\u0085 le devis \u0097 trois semaines de travaux \u0097 part',
  'demain, \u0093 sans surprise \u0094 comme convenu. Je vous \u00E9crirai d\u00E8s lundi.',
  '',
  'Cordialement,',
].join('\n');

const LETTER_TEXT = [
  'Cher Monsieur,',
  '',
  'L\u2019affaire avance\u2026 le devis \u2014 trois semaines de travaux \u2014 part',
  'demain, \u201c sans surprise \u201d comme convenu. Je vous \u00E9crirai d\u00E8s lundi.',
  '',
  'Cordialement,',
].join('\n');

test('a letter saved in cp1252 reads as the letter, exactly as its utf-8 twin does', () => {
  const dir = sandbox();
  const folder = path.join(dir, 'letters');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, '2026-03-lettre-a.txt'), Buffer.from(LETTER_BYTES, 'latin1'));
  fs.writeFileSync(path.join(folder, '2026-03-lettre-b.txt'), Buffer.from(LETTER_TEXT, 'utf8'));

  const samples = collect.collectFolder(folder, { tag: 'letters' }).samples;

  assert.strictEqual(samples.length, 2);
  for (const sample of samples) {
    assert.doesNotMatch(sample.text, /\ufffd/, sample.text);
    assert.doesNotMatch(sample.text, C1, sample.text);
    assert.ok(sample.text.includes('\u00E9crirai d\u00E8s'), sample.text);
    assert.strictEqual(typographicCount(sample.text), 6);
  }
  assert.strictEqual(samples[0].text, samples[1].text);
});

// --- A bank identifier, whatever its case ---------------------------------

// The country code of an IBAN is two letters and the bank code four more, and
// half of Europe types both in lower case. A rule that reads any run of four
// lower case letters as a word of the sentence refuses every one of those.
test('a bank identifier typed in lower case is masked like any other', () => {
  assert.strictEqual(
    collect.mask('le compte est gb29 nwbk 6016 1331 9268 19 depuis mars'),
    'le compte est [iban] depuis mars'
  );
  assert.strictEqual(
    collect.mask('le compte est GB29 NWBK 6016 1331 9268 19 depuis mars'),
    'le compte est [iban] depuis mars'
  );
  assert.strictEqual(collect.mask('ch93 0076 2011 6238 5295 7 est ferme'), '[iban] est ferme');
});

test('a run of figures that is not an account number is prose and stays', () => {
  for (const line of ['il 12 ans sans rien dire du tout', 'le 15 mars nous irons',
    'de 12 mois avec deux ans encore']) {
    assert.strictEqual(collect.mask(line), line);
  }
});

test('an amount is masked whole, with no tail of the word left standing', () => {
  assert.strictEqual(
    collect.mask('la facture 2026-0031 porte sur 480 euros, 1 250 EUR, 12 euro, 300 USD et 20 GBP'),
    'la facture [reference] porte sur [amount], [amount], [amount], [amount] et [amount]'
  );
});

// --- Only what the user sent ----------------------------------------------

test('a message from someone else is dropped', () => {
  const dir = sandbox();
  const mine = message(fromMe(), 'Bonjour, le devis part demain. Merci pour votre patience.');
  const theirs = message([
    'From: Someone Else <other@example.fr>',
    'To: The Writer <' + ME + '>',
    'Date: Wed, 4 Mar 2026 11:00:00 +0100',
  ].join('\n'), 'Bonjour, merci pour le devis, nous revenons vers vous vite.');

  const result = run(dir, 'sent.mbox', [mine + '\n' + theirs]);

  assert.strictEqual(result.counts.read, 2);
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.not_from_the_user, 1);
  assert.match(result.samples[0].text, /le devis part demain/);
});

test('the address is matched whatever the case and the display name', () => {
  const dir = sandbox();
  const raw = message([
    'From: "Writer, The" <WRITER@Example.com>',
    'To: client@example.fr',
    'Date: Wed, 4 Mar 2026 10:00:00 +0100',
  ].join('\n'), 'Bonjour, le devis part demain et le reste suit la semaine prochaine.');
  assert.strictEqual(run(dir, 'case.mbox', [raw]).counts.kept, 1);
});

// --- Quoted replies and forwards ------------------------------------------

test('a quoted reply is stripped, the answer between the quotations is kept', () => {
  const text = [
    'Oui, jeudi me va.',
    '',
    '> Est-ce que jeudi vous convient ?',
    '> Nous pouvons aussi vendredi.',
    '',
    'Vendredi non, je suis en d\u00E9placement.',
    '',
    'Le 3 mars 2026 \u00E0 09:12, Someone <other@example.fr> a \u00E9crit :',
    '',
    'Bonjour, quand pouvons-nous nous voir ?',
  ].join('\n');
  const stripped = collect.stripQuoted(text);
  assert.strictEqual(stripped.quoted, true);
  assert.match(stripped.text, /Oui, jeudi me va\./);
  assert.match(stripped.text, /Vendredi non/);
  assert.doesNotMatch(stripped.text, /Est-ce que jeudi/);
  assert.doesNotMatch(stripped.text, /quand pouvons-nous/);
});

test('an attribution line folded over two lines still opens the quoted block', () => {
  const text = ['Oui.', '', 'Le 3 mars 2026 \u00E0 09:12, Someone',
    '<other@example.fr> a \u00E9crit :', 'Bonjour.'].join('\n');
  assert.strictEqual(collect.stripQuoted(text).text, 'Oui.');
});

test('an English attribution, a separator and a repeated header block all cut', () => {
  const cases = [
    ['On Mar 3, 2026, at 09:12, Someone <other@example.fr> wrote:', 'On ... wrote:'],
    ['-----Original Message-----', 'the Outlook separator'],
    ['-----Message d\u2019origine-----', 'the French Outlook separator'],
  ];
  for (const [line, what] of cases) {
    const text = ["Merci, c'est not\u00E9.", '', line, "Bonjour, une question."].join("\n");
    assert.strictEqual(collect.stripQuoted(text).text, "Merci, c'est not\u00E9.", what);
  }

  const pasted = ['Merci.', '', 'De : Someone <other@example.fr>', 'Envoy\u00E9 : mardi 3 mars 2026',
    '\u00C0 : The Writer', 'Objet : le devis', '', 'Bonjour, une question.'].join('\n');
  assert.strictEqual(collect.stripQuoted(pasted).text, 'Merci.');
});

test('one header line in the middle of a sentence is not a pasted header block', () => {
  const text = ['Bonjour,', 'Objet : le devis de mars, que voici.', 'Merci.'].join('\n');
  assert.match(collect.stripQuoted(text).text, /Objet : le devis de mars/);
});

test('a forward that carries no text of the user is dropped', () => {
  const dir = sandbox();
  const body = [
    '---------- Forwarded message ---------',
    'De : Someone <other@example.fr>',
    'Date: mar. 3 mars 2026',
    '',
    'Bonjour, voici le contrat sign\u00E9, merci de nous le retourner avant vendredi.',
  ].join('\n');
  const result = run(dir, 'fwd.mbox', [message(fromMe(), body)]);
  assert.strictEqual(result.counts.kept, 0);
  assert.strictEqual(result.counts.dropped.nothing_of_their_own, 1);
});

test('a forward the user wrote a line above is kept, with that line only', () => {
  const dir = sandbox();
  const body = [
    'Pour information, le contrat est arriv\u00E9 ce matin et il faut le signer avant vendredi.',
    '',
    '---------- Forwarded message ---------',
    'De : Someone <other@example.fr>',
    '',
    'Bonjour, voici le contrat.',
  ].join('\n');
  const result = run(dir, 'fwd2.mbox', [message(fromMe(), body)]);
  assert.strictEqual(result.counts.kept, 1);
  assert.match(result.samples[0].text, /^Pour information/);
  assert.doesNotMatch(result.samples[0].text, /voici le contrat/);
});

// --- Sign-off and signature -----------------------------------------------

test('the sign-off and the signature are separated from the body, not deleted', () => {
  const parted = collect.splitSignature([
    'Bonjour,', '', 'Le devis part demain.', '', 'Cordialement,', 'The Writer',
    'Direction', '06 12 34 56 78',
  ].join('\n'));
  assert.strictEqual(parted.body, 'Bonjour,\n\nLe devis part demain.');
  assert.strictEqual(parted.signoff, 'Cordialement,');
  assert.strictEqual(parted.signature, 'The Writer\nDirection\n06 12 34 56 78');
});

test('a formula running over several lines is one sign-off, and the name under it is not', () => {
  const parted = collect.splitSignature([
    'Madame, Monsieur,', '', 'Je conteste la mise en demeure du 3 mars.', '',
    'Je vous prie d\u2019agr\u00E9er, Madame, Monsieur,',
    'l\u2019expression de mes salutations distingu\u00E9es.',
    'The Writer',
  ].join('\n'));
  assert.match(parted.body, /Je conteste la mise en demeure/);
  assert.match(parted.signoff, /^Je vous prie d\u2019agr\u00E9er.*salutations distingu\u00E9es\.$/);
  assert.strictEqual(parted.signature, 'The Writer');
});

test('the two dash delimiter opens the signature', () => {
  const parted = collect.splitSignature([
    'Bonjour,', 'Le devis part demain.', '', '-- ', 'The Writer', 'example.fr',
  ].join('\n'));
  assert.strictEqual(parted.body, 'Bonjour,\nLe devis part demain.');
  assert.strictEqual(parted.signature, 'The Writer\nexample.fr');
});

test('a message with no sign-off keeps its whole body', () => {
  const parted = collect.splitSignature('Oui, jeudi me va.');
  assert.strictEqual(parted.body, 'Oui, jeudi me va.');
  assert.strictEqual(parted.signoff, '');
  assert.strictEqual(parted.signature, '');
});

// --- Masking ---------------------------------------------------------------

test('a mail address is masked', () => {
  assert.strictEqual(
    collect.mask('Ecris a jean.dupont@example.fr ou a moi.'),
    'Ecris a [email] ou a moi.'
  );
});

test('a phone number is masked, in the national and the international form', () => {
  assert.strictEqual(collect.mask('Appelle au 06 12 34 56 78.'), 'Appelle au [phone].');
  assert.strictEqual(collect.mask('Appelle au 06.12.34.56.78.'), 'Appelle au [phone].');
  assert.strictEqual(collect.mask('Appelle au +33 6 12 34 56 78.'), 'Appelle au [phone].');
});

test('a date is not taken for a phone number', () => {
  assert.strictEqual(collect.mask('Le 03.03.2026 tout est parti.'), 'Le 03.03.2026 tout est parti.');
});

test('a bank identifier is masked', () => {
  assert.strictEqual(
    collect.mask('Le virement part sur FR76 3000 6000 0112 3456 7890 189 demain.'),
    'Le virement part sur [iban] demain.'
  );
});

test('an amount travelling with a case number is masked, and the number with it', () => {
  const masked = collect.mask('Le solde de 1 250,00 EUR sur le dossier 2024-00123 reste du.');
  assert.match(masked, /\[amount\]/);
  assert.match(masked, /dossier \[reference\]/);
  assert.doesNotMatch(masked, /1 250/);
  assert.doesNotMatch(masked, /2024-00123/);
});

test('an amount on its own is left where the stylometry can count it', () => {
  assert.strictEqual(collect.mask('Le menu est a 12 EUR.'), 'Le menu est a 12 EUR.');
});

test('every sample field goes through the mask, signature included', () => {
  const dir = sandbox();
  const body = [
    'Bonjour,', '', 'Le devis part demain, ecris-moi a jean.dupont@example.fr si besoin.', '',
    'Cordialement,', 'The Writer', '06 12 34 56 78',
  ].join('\n');
  const sample = run(dir, 'mask.mbox', [message(fromMe(), body)]).samples[0];
  assert.match(sample.text, /\[email\]/);
  assert.strictEqual(sample.signature, 'The Writer\n[phone]');
  assert.doesNotMatch(JSON.stringify(sample), /jean\.dupont|06 12/);
});

// --- What each sample records ---------------------------------------------

test('a sample records the tag, the date, the recipient domain and the adapter', () => {
  const dir = sandbox();
  const sample = run(dir, 'meta.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine, comme convenu ensemble.')]).samples[0];
  assert.strictEqual(sample.mailbox, 'pro');
  assert.strictEqual(sample.date, '2026-03-04');
  assert.strictEqual(sample.recipient_domain, 'example.fr');
  assert.strictEqual(sample.adapter, 'mbox');
  assert.strictEqual(sample.source, 'meta.mbox');
});

// The tag and the adapter are what a reader of the samples has to select on,
// now that no figure ranks them: they travel on every sample of either adapter.
test('no sample carries a weight, and every one carries its tag and its adapter', () => {
  const dir = sandbox();
  const mail = run(dir, 'noweight.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine, comme convenu.')]);
  fs.writeFileSync(path.join(dir, 'lettre.txt'),
    'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines pleines.\n\nCordialement,\n');
  const letters = collect.collectFolder(dir, { tag: 'gold' });

  assert.ok(mail.samples.length && letters.samples.length);
  for (const sample of mail.samples.concat(letters.samples)) {
    assert.ok(!('weight' in sample), 'no sample is ranked by a figure nobody can recompute');
    assert.ok(sample.mailbox, 'the tag travels');
    assert.ok(sample.adapter, 'the adapter name travels');
  }
  assert.strictEqual(mail.samples[0].adapter, 'mbox');
  assert.strictEqual(mail.samples[0].mailbox, 'pro');
  assert.strictEqual(letters.samples[0].adapter, 'folder');
  assert.strictEqual(letters.samples[0].mailbox, 'gold');
  assert.doesNotMatch(collect.USAGE, /weight/i);
});

test('the surface is guessed from the length and the extension', () => {
  assert.strictEqual(collect.guessSurface('mbox', '', 3), 'message');
  assert.strictEqual(collect.guessSurface('mbox', '', 300), 'email');
  assert.strictEqual(collect.guessSurface('folder', '.txt', 300), 'letter');
  assert.strictEqual(collect.guessSurface('folder', '.tex', 300), 'letter');
  assert.strictEqual(collect.guessSurface('mbox', '.pdf', 300), 'letter');
  assert.strictEqual(collect.guessSurface('folder', '.txt', 3), 'message');
});

test('the register is guessed administrative from the recipient domain', () => {
  const generic = 'Bonjour, le dossier avance et la reponse suit la semaine prochaine.';
  assert.strictEqual(collect.guessRegister('impots.gouv.fr', generic), 'administrative');
  assert.strictEqual(collect.guessRegister('tribunal.example.fr', generic), 'administrative');
  assert.strictEqual(collect.guessRegister('agency.gov.uk', generic), 'administrative');
  assert.strictEqual(collect.isPublicBody('example.fr'), false);
  assert.strictEqual(collect.isPublicBody('governance-partners.com'), false);
});

test('the register is guessed administrative from the markers of the text', () => {
  const text = [
    'Madame, Monsieur,',
    'Je conteste la mise en demeure recue le 3 mars, dossier 2024-00123.',
    'Je vous prie d\u2019agr\u00E9er, Madame, Monsieur, mes salutations distingu\u00E9es.',
  ].join('\n');
  assert.strictEqual(collect.guessRegister('service-client.example.fr', text), 'administrative');
});

test('the register is guessed personal when the familiar second person dominates', () => {
  const familiar = 'Salut, tu viens jeudi ? Dis-moi si ton frere passe, je te garde ta place.';
  assert.strictEqual(collect.guessRegister('example.fr', familiar), 'personal');
  const formal = 'Bonjour, pouvez-vous confirmer votre venue jeudi ? Vos places sont gardees.';
  assert.strictEqual(collect.guessRegister('example.fr', formal), 'professional');
});

// --- The folder adapter ----------------------------------------------------

test('the folder adapter reads text, markdown and TeX', () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-03-lettre.txt'),
    'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines pleines, sauf si la livraison des\nmenuiseries prend du retard, auquel cas je vous previens le jour meme par telephone.\n\nCordialement,\nThe Writer\n');
  fs.writeFileSync(path.join(dir, 'sub', 'note.md'), 'Oui, jeudi me va.\n');
  fs.writeFileSync(path.join(dir, 'lettre.tex'),
    '% a comment\n\\documentclass{letter}\n\\begin{document}\n\\textbf{Madame,} le chantier commence lundi et il dure trois semaines pleines et entieres.\n\\end{document}\n');
  fs.writeFileSync(path.join(dir, 'scan.png'), 'not text');

  const result = collect.collectFolder(dir, { tag: 'letters' });

  assert.strictEqual(result.counts.read, 3, 'the png is not a sample');
  assert.strictEqual(result.counts.kept, 3);
  const byName = Object.fromEntries(result.samples.map((sample) => [sample.source, sample]));
  assert.deepStrictEqual(Object.keys(byName).sort(), ['2026-03-lettre.txt', 'lettre.tex', path.join('sub', 'note.md')]);
  assert.strictEqual(byName['2026-03-lettre.txt'].date, '2026-03');
  assert.strictEqual(byName['2026-03-lettre.txt'].signoff, 'Cordialement,');
  assert.strictEqual(byName['2026-03-lettre.txt'].surface, 'letter');
  assert.strictEqual(byName[path.join('sub', 'note.md')].surface, 'message');
  assert.match(byName['lettre.tex'].text, /^Madame, le chantier commence lundi/);
  assert.doesNotMatch(byName['lettre.tex'].text, /documentclass|textbf|a comment/);
});

test('a folder file with nothing in it is dropped rather than counted as a sample', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'empty.txt'), '\n\n');
  const result = collect.collectFolder(dir, { tag: 'letters' });
  assert.strictEqual(result.counts.kept, 0);
  assert.strictEqual(result.counts.dropped.nothing_of_their_own, 1);
});

// --- The command line ------------------------------------------------------

function cli(args) {
  return spawnSync(process.execPath, [COLLECT, ...args], { encoding: 'utf8' });
}

// The document is only ever written to a file now, so a test that wants to read
// it names a destination and reads it back.
function document(args, dir) {
  const target = path.join(dir, 'doc-' + Math.abs(args.join('').length) + '-' + args.length + '.json');
  const out = cli([...args, '--out', target]);
  return { out, json: out.status === 0 ? JSON.parse(fs.readFileSync(target, 'utf8')) : null };
}

// The destination is named or the run does not happen. A forgotten flag used to
// print the corpus, which in a Claude Code session means printing every private
// message into the context of the model, the one thing the consent step of the
// setup promises never happens.
test('without --out it refuses, and prints none of the corpus', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'lettre.txt'),
    'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines.\n');

  const out = cli(['folder', dir, '--tag', 'letters']);

  assert.strictEqual(out.status, 1);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /--out/);
  assert.strictEqual(out.stderr.trim().split('\n').length, 1);
  assert.doesNotMatch(out.stderr, /chantier/);
});

test('mbox without a destination refuses too, before it reads the mailbox', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'sent.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.')]);

  const out = cli(['mbox', file, '--me', ME, '--tag', 'pro']);

  assert.strictEqual(out.status, 1);
  assert.strictEqual(out.stdout, '');
  assert.doesNotMatch(out.stderr, /devis/);
});

// There is no flag that prints the corpus. A documented way to print it is still
// a way to print it, and in an agent session stdout is the context of the model.
test('no flag prints the corpus, whatever is asked for', () => {
  const dir = sandbox();
  const secret = 'Le chantier commence lundi et les travaux durent trois semaines.';
  fs.writeFileSync(path.join(dir, 'lettre.txt'), `Madame,\n\n${secret}\n\nCordialement,\nThe Writer\n`);
  const target = path.join(dir, 'samples.json');

  for (const args of [
    ['folder', dir, '--tag', 'letters'],
    ['folder', dir, '--tag', 'letters', '--stdout'],
    ['folder', dir, '--tag', 'letters', '--out', target],
  ]) {
    const out = cli(args);
    assert.doesNotMatch(out.stdout, /chantier/, args.join(' '));
    assert.doesNotMatch(out.stderr, /chantier/, args.join(' '));
  }
  // and --stdout is not a flag any more, so it is refused rather than ignored
  assert.strictEqual(cli(['folder', dir, '--tag', 'letters', '--stdout', '--out', target]).status, 1);
});

test('a sample carries the fields stylometry reads, and the signature apart from the text', () => {
  const dir = sandbox();
  const body = [
    'Bonjour,', '', 'Le devis part demain et le chantier suit la semaine prochaine, comme convenu.', '',
    'Cordialement,', 'The Writer', 'Direction',
  ].join('\n');

  const sample = run(dir, 'shape.mbox', [message(fromMe(), body)]).samples[0];

  assert.strictEqual(sample.salutation, 'Bonjour,');
  assert.strictEqual(sample.signoff, 'Cordialement,');
  assert.strictEqual(sample.signature, 'The Writer\nDirection');
  assert.match(sample.text, /^Bonjour,/, 'the salutation stays inside the text');
  assert.match(sample.text, /Cordialement,$/, 'and so does the sign-off');
  assert.doesNotMatch(sample.text, /Direction/, 'the signature does not, it would weigh on every length');
  assert.strictEqual(sample.words, collect.wordCount(sample.text));
});

test('a first line that is not a greeting is not taken for one', () => {
  assert.strictEqual(collect.salutationOf('Bonjour Madame,\nle devis part demain.'), 'Bonjour Madame,');
  assert.strictEqual(collect.salutationOf('Le devis part demain, comme convenu la semaine passee.'), '');
});

test('a greeting under the place and date line of a letter is still the greeting', () => {
  const letter = ['Moissy, le 4 mars 2026', '', 'Cher Ami,', '', 'Le chantier commence lundi.'].join('\n');
  assert.strictEqual(collect.salutationOf(letter), 'Cher Ami,');
});

test('--lang is carried through to the stylometry rather than guessed', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'lettre.txt'), 'Madame,\n\nLe chantier commence lundi.\n');
  const withLang = path.join(dir, 'with-lang.json');
  const without = path.join(dir, 'without.json');
  cli(['folder', dir, '--lang', 'fr', '--out', withLang]);
  cli(['folder', dir, '--out', without]);
  assert.strictEqual(JSON.parse(fs.readFileSync(withLang, 'utf8')).lang, 'fr');
  assert.strictEqual(JSON.parse(fs.readFileSync(without, 'utf8')).lang, null);
});
test('--out writes the document to a file and says how many samples it holds', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'sent.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.')]);
  const target = path.join(dir, 'samples.json');

  const out = cli(['mbox', file, '--me', ME, '--tag', 'pro', '--out', target]);

  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /1 samples of 1 read/);
  const document = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.strictEqual(document.samples[0].mailbox, 'pro');
});

test('--me takes several addresses, separated by commas or repeated', () => {
  const dir = sandbox();
  const second = message([
    'From: The Writer <other-box@example.com>',
    'To: client@example.fr',
    'Date: Wed, 4 Mar 2026 12:00:00 +0100',
  ].join('\n'), 'Bonjour, le devis part demain et le chantier suit la semaine prochaine.');
  const file = mailbox(dir, 'two.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.') + '\n' + second]);

  const joined = document(['mbox', file, '--me', ME + ',other-box@example.com'], dir).json;
  const repeated = document(['mbox', file, '--me', ME, '--me', 'other-box@example.com'], dir).json;

  assert.strictEqual(joined.counts.kept, 2);
  assert.strictEqual(repeated.counts.kept, 2);
});

test('mbox without --me refuses rather than guessing which messages are the user', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'sent.mbox', [message(fromMe(), 'Bonjour.')]);
  const out = document(['mbox', file], dir).out;
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /--me/);
});

// The setup tells the model these flags are what the scripts accept and nothing
// else is. A flag nobody claimed used to fall through the chain and take its
// value with it: --langue fr wrote a document whose lang is null and said
// nothing, and a second mailbox on the line was read by no adapter.
test('an argument no flag claims stops the run rather than being dropped', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'sent.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.')]);

  const unknownFlag = document(['mbox', file, '--me', ME, '--langue', 'fr'], dir).out;
  assert.strictEqual(unknownFlag.status, 1);
  assert.match(unknownFlag.stderr, /--langue/);
  assert.strictEqual(unknownFlag.stdout, '');

  const extra = document(['mbox', file, file, '--me', ME], dir).out;
  assert.strictEqual(extra.status, 1);
  assert.match(extra.stderr, /unknown/);
});

// A mistyped address keeps nothing and used to exit 0, so the stylometry ran on
// a corpus that was the other sources alone and announced three of them.
test('a run that kept nothing exits 1 and says why', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'sent.mbox', [message(fromMe(),
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.')]);
  const target = path.join(dir, 'samples.json');

  const out = cli(['mbox', file, '--me', 'nobody@example.net', '--out', target]);

  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /0 samples of 1 read/);
  assert.match(out.stderr, /nobody@example\.net/);
  assert.doesNotMatch(out.stderr, /devis/);

  const empty = document(['folder', fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-empty-'))], sandbox()).out;
  assert.strictEqual(empty.status, 1);
});

// Every corrupted mailbox used to exit 0 on a clean line, so a subject following
// the setup had no signal at all that their profile was built on mojibake.
test('a decode the bytes refused is one line on the error channel', () => {
  const dir = sandbox();
  const body = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('Bonjour, le devis part demain matin et la commande suit.', 'utf16le'),
  ]);
  const head = ['From - Wed Mar  4 10:00:00 2026',
    fromMe(['Content-Type: text/plain; charset="utf-16"']).trim(), '', ''].join('\n');
  const readable = message(fromMe(), 'Bonjour, le devis part demain et le chantier suit lundi.');
  const file = mailbox(dir, 'exported.mbox', [
    Buffer.from(readable + '\n', 'latin1'), Buffer.from(head, 'latin1'), body.subarray(0, -1),
  ]);

  const out = cli(['mbox', file, '--me', ME, '--out', path.join(dir, 'samples.json')]);

  assert.strictEqual(out.status, 0);
  assert.match(out.stderr, /did not decode as declared/);
  assert.match(out.stderr, /utf-16/);
});

test('an unknown adapter and a missing source are reported', () => {
  const dir = sandbox();
  assert.strictEqual(document(['imap', 'somewhere'], dir).out.status, 1);
  const missing = document(['folder', path.join(dir, 'no-such-directory')], dir).out;
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /no-such-directory/);
});

test('called with nothing it explains itself and exits 0', () => {
  const out = cli([]);
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /mbox|folder/);
});

// --- What a real mailbox throws at the parser ------------------------------

test('a body paragraph opening on "From " does not cut the message in two', () => {
  const dir = sandbox();
  const body = [
    'Bonjour Claire,', '',
    'From the start we agreed on the same three milestones, and the third one',
    'is the only one still open.', '',
    'Cordialement,',
  ].join('\n');

  const result = run(dir, 'prose.mbox', [message(fromMe(), body)]);

  assert.strictEqual(result.counts.read, 1);
  assert.strictEqual(result.counts.kept, 1);
  assert.match(result.samples[0].text, /three milestones/);
});

test('a part whose header area is empty keeps its first paragraph', () => {
  assert.deepStrictEqual(
    collect.splitMessage('\nBonjour Claire,\n\nLe corps.\n'),
    { headers: {}, body: 'Bonjour Claire,\n\nLe corps.\n' }
  );
});

test('a boundary is a boundary at column zero only, and the epilogue stays out', () => {
  const parts = collect.splitMultipart([
    '--B', 'Content-Type: text/plain', '', 'vrai corps', '  --B', 'toujours le corps',
    '--B--', 'epilogue ignore', '--B', 'texte qui ne devrait pas revenir',
  ].join('\n'), 'B');

  assert.strictEqual(parts.length, 1);
  assert.match(parts[0], /vrai corps/);
  assert.match(parts[0], /toujours le corps/);
  assert.doesNotMatch(parts[0], /epilogue|ne devrait pas revenir/);
});

test('a body line equal to the boundary is put back rather than cutting the message', () => {
  const parts = collect.splitMultipart([
    '--SEP42', 'Content-Type: text/plain', '', 'Voici le fichier de configuration :',
    '--SEP42', 'option = true', '', 'Dis-moi si cela te convient.', '--SEP42--',
  ].join('\n'), 'SEP42');

  assert.strictEqual(parts.length, 1);
  assert.match(parts[0], /Dis-moi si cela te convient/);
});

test('an address inside a display name does not win over the one in brackets', () => {
  const dir = sandbox();
  const headers = [
    'From: "notifications@lists.example" <' + ME + '>',
    'To: "Service, Client" <client@example.fr>',
    'Date: Wed, 4 Mar 2026 10:00:00 +0100',
  ].join('\n');

  const result = run(dir, 'display.mbox', [message(headers,
    'Bonjour, le devis part demain et le chantier suit la semaine prochaine.')]);

  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.samples[0].recipient_domain, 'example.fr');
});

test('a part that declares utf-8 and does not hold it is read for its words', () => {
  const declared = ['Content-Type: text/plain; charset=utf-8', '', ''].join('\n');
  const raw = declared + Buffer.from('La r\u00E9union de mardi \u00E9tait utile.', 'latin1').toString('latin1');
  assert.strictEqual(collect.partText(raw, 0).text.trim(), 'La r\u00E9union de mardi \u00E9tait utile.');
  assert.doesNotMatch(collect.partText(raw, 0).text, /\ufffd/);
});

test('a message with no blank line under its headers is counted for what it is', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'noblank.mbox', [
    ['From - Wed Mar  4 10:00:00 2026', fromMe(), 'Bonjour, le devis part demain.', ''].join('\n'),
  ]);
  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.counts.kept, 0);
  assert.strictEqual(result.counts.dropped.no_body, 1);
  assert.strictEqual(result.counts.dropped.nothing_of_their_own, 0);
});

test('a telephone number written the North American way is masked too', () => {
  assert.strictEqual(collect.mask('Donne mon numero, (415) 555-2671, et rappelle.'),
    'Donne mon numero, [phone], et rappelle.');
  assert.strictEqual(collect.mask('Donne mon numero, 415-555-2671, et rappelle.'),
    'Donne mon numero, [phone], et rappelle.');
});

test('a reference opening on letters is a reference, and the amount beside it goes', () => {
  const masked = collect.mask('Facture n\u00B0 F-2026-0031 : 480 euros a regler.');
  assert.match(masked, /\[reference\]/);
  assert.doesNotMatch(masked, /F-2026-0031/);
  assert.doesNotMatch(masked, /480 euros/);
  assert.match(collect.mask('Dossier 2026/4471 en cours.'), /Dossier \[reference\]/);
});

test('a bank identifier in lower case is masked, and the prose after it is not eaten', () => {
  assert.strictEqual(
    collect.mask('Le virement part sur fr76 3000 6000 0112 3456 7890 189 demain.'),
    'Le virement part sur [iban] demain.'
  );
  assert.strictEqual(
    collect.mask('Le compte BE68 5390 0754 7034 chez la banque.'),
    'Le compte [iban] chez la banque.'
  );
});

test('the day of a message is the day its sender wrote, not the day in UTC', () => {
  assert.strictEqual(collect.dateOf('Sun, 1 Mar 2026 00:30:00 +0200'), '2026-03-01');
  assert.strictEqual(collect.dateOf('Wed, 4 Mar 2026 23:45:00 -0500'), '2026-03-04');
});

test('a letter saved with Windows line endings carries none of them into the sample', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'crlf.txt'),
    'Bonjour Claire,\r\n\r\nVoici le compte rendu de la reunion de mardi, comme convenu.\r\n\r\nCordialement\r\n');
  const sample = collect.collectFolder(dir, { tag: 'letters' }).samples[0];
  assert.doesNotMatch(sample.text, /\r/);
  assert.strictEqual(sample.salutation, 'Bonjour Claire,');
});

test('the document names its source by its tag, never by the name of the file', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'lettre.txt'),
    'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines.\n');
  const doc = document(['folder', path.join(dir), '--tag', 'gold'], dir).json;
  assert.strictEqual(doc.source, 'one folder tagged gold');
  assert.doesNotMatch(JSON.stringify(doc.source), /lettre|voicemd-collect/);
});

test('the usage names every flag a caller has to pass, --lang included', () => {
  assert.match(collect.USAGE, /--lang/);
  const synopsis = collect.USAGE.split('\n').filter((line) => /collect\.js (mbox|folder)/.test(line));
  assert.strictEqual(synopsis.length, 2);
  for (const line of synopsis) assert.match(line, /--lang/);
});

// --- Reading the mailbox in chunks -----------------------------------------
//
// A Google Takeout export, the one the setup skill sends people to, passes the
// half gigabyte a single JavaScript string holds. The mailbox is read in chunks
// and cut on the envelope line, one message in memory at a time, so these tests
// hold the chunked reader to what the whole string reader said.

// Two messages separated by the blank line a mailbox puts between them.
function mailboxText(messages) {
  return messages.join('\n');
}

function bigMailbox(dir, name, bodyBytes) {
  const lines = [];
  for (let index = 0, size = 0; size < bodyBytes; index += 1) {
    const line = 'Ligne ' + index + ' du compte rendu, ecrite pour occuper la place dans un vrai message long.';
    lines.push(line);
    size += line.length + 1;
  }
  const raw = mailboxText([
    message(fromMe(), 'Bonjour, le devis part demain et le chantier suit la semaine prochaine.'),
    message(fromMe(), 'Bonjour Claire,\n\n' + lines.join('\n') + '\n\nCordialement,'),
    message(fromMe(), 'Bonjour, la reunion de mardi tient toujours, meme heure et meme salle.'),
  ]);
  return { file: mailbox(dir, name, [raw]), raw, lines: lines.length };
}

test('the mailbox is read in chunks, and a chunk boundary cuts no message', () => {
  const dir = sandbox();
  const raw = mailboxText([
    message(fromMe(), 'Bonjour, le devis part demain.\n\nCordialement,'),
    message(fromMe(), 'first\n>From the top of the hill, all is fine'),
    message(fromMe(), 'Bonjour Claire,\n\nLe compte rendu suit.\n\nCordialement,'),
  ]);
  const file = mailbox(dir, 'chunks.mbox', [raw]);
  const whole = collect.splitMbox(raw);

  assert.strictEqual(whole.length, 3);
  for (const size of [1, 2, 3, 5, 7, 13, 16, 31, 64, 127, 256, 1024, raw.length, raw.length * 2]) {
    assert.deepStrictEqual(
      Array.from(collect.streamMbox(file, size)), whole,
      'chunks of ' + size + ' bytes read the mailbox as one string does'
    );
  }
});

test('an envelope line falling exactly on a chunk boundary still opens a message', () => {
  const dir = sandbox();
  const raw = mailboxText([
    message(fromMe(), 'Bonjour, le devis part demain.'),
    message(fromMe(), 'Bonjour Claire,\n\nLe compte rendu suit.'),
  ]);
  const file = mailbox(dir, 'boundary.mbox', [raw]);
  const whole = collect.splitMbox(raw);
  const envelope = raw.indexOf('From - Wed Mar  4 10:00:00 2026', 1);

  assert.ok(envelope > 0);
  assert.strictEqual(whole.length, 2);
  // The boundary on the first byte of the envelope line, inside it, on its last
  // byte, and on the newline that ends it.
  for (const size of [envelope - 1, envelope, envelope + 1, envelope + 15, envelope + 31]) {
    assert.deepStrictEqual(
      Array.from(collect.streamMbox(file, size)), whole,
      'a boundary at byte ' + size + ' keeps the two messages'
    );
  }
});

test('a message larger than one chunk comes back whole', () => {
  const dir = sandbox();
  const { file, raw, lines } = bigMailbox(dir, 'long.mbox', 3 * 1024 * 1024);

  assert.ok(raw.length > 3 * 1024 * 1024, 'the mailbox crosses several default boundaries');
  const messages = Array.from(collect.streamMbox(file));
  assert.deepStrictEqual(messages, collect.splitMbox(raw));
  assert.strictEqual(messages.length, 3);
  assert.strictEqual(messages[1].split('\n').filter((line) => /^Ligne \d+ du compte rendu/.test(line)).length, lines);
  assert.match(messages[1], /Ligne 0 du compte rendu/);
  assert.match(messages[1], /Cordialement,\s*$/);
});

test('a mailbox too large to hold as one string is collected message by message', () => {
  const dir = sandbox();
  const { file, lines } = bigMailbox(dir, 'takeout.mbox', 3 * 1024 * 1024);
  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });

  assert.strictEqual(result.counts.read, 3);
  assert.strictEqual(result.counts.kept, 3);
  const long = result.samples[1];
  assert.strictEqual(long.salutation, 'Bonjour Claire,');
  assert.strictEqual(long.signoff, 'Cordialement,');
  assert.strictEqual(long.text.split('\n').filter((line) => /^Ligne \d+ du compte rendu/.test(line)).length, lines);
});

// Zero tolerance, settled by the author: a message that does not decode is not
// measured at all. Losing one real message in a thousand to a bad byte is a
// known price; measuring rubbish is not.
//
// A raw 0x92 is not such a byte: with no declaration it is cp1252's apostrophe
// and the decoder is right to read it as one. What cannot be decoded is a NUL,
// which is half of a utf-16 text read in the wrong width, and a U+FFFD, which is
// what a decoder leaves where it gave up.
test('a message that does not decode is counted unreadable and never measured', () => {
  const dir = sandbox();
  for (const [name, code] of [['nul', 0], ['replacement', 0xfffd]]) {
    const mark = String.fromCharCode(code);
    const bad = mailbox(dir, name + '.mbox', [
      message(fromMe(), 'Bonjour,' + mark + ' le secret du chantier tient en une ligne.'),
    ]);

    const result = collect.collectMbox(bad, { tag: 'pro', me: [ME] });

    assert.strictEqual(result.counts.dropped.unreadable, 1, name);
    assert.strictEqual(result.samples.length, 0, name);
    assert.doesNotMatch(JSON.stringify(result), /secret/, name);
  }

  // The same mailbox without the bad byte is measured as it always was.
  const good = mailbox(dir, 'good.mbox', [
    message(fromMe(), 'Bonjour, le devis part demain et le chantier suit la semaine prochaine.'),
  ]);
  const clean = collect.collectMbox(good, { tag: 'pro', me: [ME] });
  assert.strictEqual(clean.counts.dropped.unreadable, 0);
  assert.strictEqual(clean.samples.length, 1);
});

test('a byte that decodes is kept, whatever range it came from', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'cp.mbox', [
    message(fromMe(), 'Bonjour, l' + String.fromCharCode(0x92) + 'affaire avance et le devis part demain.'),
  ]);
  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });
  assert.strictEqual(result.counts.dropped.unreadable, 0);
  assert.match(result.samples[0].text, /l\u2019affaire/);
});

test('a tab, a newline and a carriage return are layout, not a broken decode', () => {
  const dir = sandbox();
  const body = 'Bonjour,\n\n\tLe devis part demain et le chantier suit la semaine prochaine.\r\n';
  const file = mailbox(dir, 'layout.mbox', [message(fromMe(), body)]);
  const result = collect.collectMbox(file, { tag: 'pro', me: [ME] });
  assert.strictEqual(result.counts.dropped.unreadable, 0);
  assert.strictEqual(result.samples.length, 1);
});

test('the summary says how many did not decode, and nothing else about them', () => {
  const dir = sandbox();
  const file = mailbox(dir, 'mixed.mbox', [
    message(fromMe(), 'Bonjour, le devis part demain et le chantier suit la semaine prochaine.'
      + String.fromCharCode(10) + String.fromCharCode(10) + 'Cordialement,'),
  ]);
  const bad = mailbox(dir, 'bad.mbox', [
    message(fromMe(), 'Bonjour,' + String.fromCharCode(0) + ' le secret du chantier est ici.'),
  ]);
  const target = path.join(dir, 'out.json');

  const good = cli(['mbox', file, '--me', ME, '--tag', 'pro', '--out', target]);
  assert.strictEqual(good.status, 0);
  assert.doesNotMatch(good.stdout, /did not decode/, 'nothing is said when nothing failed');

  const out = cli(['mbox', bad, '--me', ME, '--tag', 'pro', '--out', path.join(dir, 'bad.json')]);
  assert.strictEqual(out.status, 1, 'a run that kept nothing exits 1');
  assert.doesNotMatch(out.stdout + out.stderr, /secret/);
});
