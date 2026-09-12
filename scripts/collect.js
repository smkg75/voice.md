'use strict';

// Sample collection for the voice.md setup, handoff section 7.
//
//   node scripts/collect.js mbox <file.mbox> --me <address>[,<address>] --tag pro --out <file> [--lang fr]
//   node scripts/collect.js folder <directory> [--tag letters] --out <file> [--lang fr]
//
// One run reads one source and writes one JSON document to the file --out
// names, then prints a one line summary. There is no way to print the document
// itself: its reader is scripts/stylometry.js, whose header states the contract
// this document keeps:
//
//   { "lang": "fr", "source": "...", "samples": [ { "text": "...", "mailbox": "pro",
//     "date": "2026-03-04", "recipient_domain": "example.org", "surface": "email",
//     "register": "professional", "salutation": "Bonjour,", "signoff": "Cordialement," } ] }
//
// text is the message as the user wrote it, salutation and sign-off included and
// the signature kept apart in its own field.
//
// mbox    a mailbox exported from a mail client, one file per mailbox, tagged by
//         the user ('pro', 'perso'). Only the messages the user sent are kept,
//         which means those whose From is one of the addresses given with --me.
// folder  .txt, .md and .tex files: letters the user corrected by hand: the
//         samples closest to what the user actually approves. No sample carries
//         a rank here; what tells these apart is their adapter and their tag,
//         which travel on every one of them and are what the stylometry selects
//         its extracts on.
//
// This script writes one file on the disk it was pointed at, and nothing else.
// What the setup skill then shows the model is the stylometry summary, never
// this document. In an agent session stdout is the context of the model, so
// printing the samples there is the one thing the consent step promises never
// happens, and there is no flag that does it: a documented way to print a corpus
// is still a way to print it. --out is required for the same reason. Even so,
// every sample here is masked before it is written: mail addresses, phone
// numbers, bank identifiers and the figures that travel with a case number.
//
// The MIME parser below is written by hand and has no dependency: the 'From '
// separator that opens each message, folded headers, multipart split on its
// boundary, text/plain preferred over HTML, base64 and quoted-printable, utf-8
// and the single byte codepages through Buffer and the windows-125x map below.
//
// Characters are named by escape rather than typed, because this repository
// applies its own typography table to itself.

const fs = require('node:fs');
const path = require('node:path');

// --- Mbox and MIME --------------------------------------------------------

// A message opens on an envelope line at the start of the file or after a blank
// line. The envelope shape is required, not just the word: a paragraph opening
// on 'From the start we agreed' is prose, and reading it as a separator cuts a
// real message in two and keeps both halves. Thunderbird's 'From - Mon Jan 01'
// and 'From MAILER-DAEMON Tue Mar  4' both still match. The envelope line itself
// belongs to the mailbox, not to the message, and a body line the exporter
// escaped as '>From ' is restored.
const ENVELOPE = /^From \S+ +\w{3} \w{3} [ \d]\d /;

// The cut, line by line, so that the whole mailbox and a chunk of it are read by
// the same rule. Feeding a line gives back the message that line closed, or
// null; end() gives back the message the end of the file closes.
function messageCutter() {
  let current = null;
  let afterBlank = true;
  return {
    line(line) {
      let closed = null;
      if (afterBlank && ENVELOPE.test(line)) {
        if (current) closed = current.join('\n');
        current = [];
      } else if (current) {
        current.push(/^>+From /.test(line) ? line.slice(1) : line);
      }
      afterBlank = line === '';
      return closed;
    },
    end() {
      const closed = current ? current.join('\n') : null;
      current = null;
      return closed;
    },
  };
}

function splitMbox(text) {
  const messages = [];
  const cutter = messageCutter();
  for (const line of text.split(/\r?\n/)) {
    const closed = cutter.line(line);
    if (closed !== null) messages.push(closed);
  }
  const last = cutter.end();
  if (last !== null) messages.push(last);
  return messages;
}

// A mailbox held as one string throws above roughly half a gigabyte, and a
// Google Takeout export of a sent mailbox reaches it: the setup skill sends
// people to Takeout, so that size is the ordinary case, not the exotic one. The
// file is read a chunk at a time and cut on the envelope line, which is what
// makes the mailbox streamable at all, and only one message is held.
//
// A chunk ends where the read ended, in the middle of a line as often as not, so
// the tail after the last newline waits for the chunk that finishes it: a
// separator split across a boundary is read whole, on the next pass. Reading
// latin1 is one code unit per byte, so no boundary ever cuts a character either.
// chunkSize is here for the tests, which cross a boundary at every byte of a
// separator rather than on a mailbox large enough to reach the default.
const CHUNK = 1 << 20;

function* streamMbox(file, chunkSize) {
  const size = chunkSize || CHUNK;
  const buffer = Buffer.allocUnsafe(size);
  const cutter = messageCutter();
  const handle = fs.openSync(file, 'r');
  let pending = '';
  try {
    for (;;) {
      const read = fs.readSync(handle, buffer, 0, size, null);
      if (!read) break;
      pending += buffer.toString('latin1', 0, read);
      const cut = pending.lastIndexOf('\n');
      if (cut === -1) continue;
      const lines = pending.slice(0, cut + 1).split(/\r?\n/);
      // What follows the last newline is the unfinished line, not a line.
      lines.pop();
      pending = pending.slice(cut + 1);
      for (const line of lines) {
        const closed = cutter.line(line);
        if (closed !== null) yield closed;
      }
    }
  } finally {
    fs.closeSync(handle);
  }
  // The remainder is the last line of the file, empty when the file ends on a
  // newline, and split() counts that empty one too.
  const closed = cutter.line(pending);
  if (closed !== null) yield closed;
  const last = cutter.end();
  if (last !== null) yield last;
}

// Headers up to the first blank line, folded continuations joined back onto the
// line they belong to, names lowercased. A header seen twice keeps both values,
// which is what a message with two To lines means.
function splitMessage(raw) {
  // RFC 2046 allows a body part whose header area is empty: the delimiter, a
  // blank line, then the content. Looking for the first double newline in that
  // part would swallow its first paragraph as a header block.
  if (/^\r?\n/.test(raw)) return { headers: {}, body: raw.replace(/^\r?\n/, '') };
  const separator = /\r?\n\r?\n/.exec(raw);
  const head = separator ? raw.slice(0, separator.index) : raw;
  const body = separator ? raw.slice(separator.index + separator[0].length) : '';
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    headers[name] = headers[name] === undefined ? match[2] : headers[name] + ', ' + match[2];
  }
  return { headers, body };
}

function parseContentType(value) {
  const parts = String(value || 'text/plain').split(';');
  const params = {};
  for (const part of parts.slice(1)) {
    const match = /^\s*([\w-]+)\s*=\s*"?([^";]*)"?/.exec(part);
    if (match) params[match[1].toLowerCase()] = match[2].trim();
  }
  return { type: parts[0].trim().toLowerCase(), params };
}

// RFC 2047, so a Subject or a display name is readable rather than a code.
function decodeEncodedWords(value) {
  return String(value || '').replace(
    /=\?([\w-]+)\?([BbQq])\?([^?]*)\?=/g,
    (all, charset, kind, payload) => {
      const binary = kind.toUpperCase() === 'B'
        ? Buffer.from(payload, 'base64').toString('latin1')
        : decodeQuotedPrintable(payload.replace(/_/g, ' '));
      return decodeCharset(binary, charset);
    }
  );
}

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (all, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// The 32 characters the windows-125x family puts where latin1 has its C1
// controls. That range is where every mail client on Windows keeps its smart
// punctuation: the apostrophe at 0x92, the dashes at 0x96 and 0x97, the
// quotation marks at 0x93 and 0x94, the ellipsis at 0x85. Read as latin1 they
// turn into invisible controls, which join the two words around them into one
// and leave the typographic count of a message full of curly punctuation at
// zero, for exactly the clients that produce it.
//
// The five positions the charset leaves undefined become a space: a byte that
// encodes no character is not something a person typed, and deleting it would
// join the two words it stood between, which is the same defect as the control
// it replaces, only invisible. A space keeps the boundary and the word count.
const CP1252 = [
  '\u20ac', '\ufffd', '\u201a', '\u0192', '\u201e', '\u2026', '\u2020', '\u2021',
  '\u02c6', '\u2030', '\u0160', '\u2039', '\u0152', '\ufffd', '\u017d', '\ufffd',
  '\ufffd', '\u2018', '\u2019', '\u201c', '\u201d', '\u2022', '\u2013', '\u2014',
  '\u02dc', '\u2122', '\u0161', '\u203a', '\u0153', '\ufffd', '\u017e', '\u0178',
];

// The five positions cp1252 leaves undefined answer U+FFFD, and a control no
// keyboard sends is left standing. Both used to become a space, which read as
// text and was measured: a body read in the wrong width, where every other byte
// of a utf-16 text is a NUL, came back as a message full of spaces. They are
// kept so that undecoded() below can see them and count the message unreadable.
function fromCp1252(text) {
  return text.replace(/[\u0080-\u009f]/g, (ch) => CP1252[ch.charCodeAt(0) - 0x80]);
}

// A part is decoded to bytes first, and then the bytes are asked what they are.
// A declaration inside the windows-1252 family is not believed: a mailbox that
// spans ten years holds messages that declare one of those and carry another, in
// both directions, and latin1 reads all of them. A run of bytes that decodes as
// utf-8 without error is utf-8 whatever the header said, and what is left is a
// single byte codepage read as latin1. A genuine latin1 or cp1252 text is almost
// never accidentally valid utf-8, a lone 0xE9 being no sequence at all, which is
// what makes the bytes the better witness of those two.
//
// A declaration outside that family is believed, because latin1 cannot read
// those bytes at all and no sniff recovers them: iso-8859-15 is in the 8859
// family and is not an alias of windows-1252, it is the codepage French mail
// used for the euro through the 2000s and it differs at eight positions, so read
// as latin1 its oe ligature comes back a fraction and its euro sign a currency
// sign, silently, with nothing in either output file able to show the loss.
//
// The sniff is taken sequence by sequence rather than on the whole part. All or
// nothing, one byte of another codepage anywhere in an otherwise utf-8 body, or
// a tail an exporter cut mid-sequence, sent the entire message through the
// cp1252 map: every apostrophe came back as three characters, the em dashes and
// the ellipses were reported at zero after being typed, and quotation marks
// nobody wrote were counted. Fabricating punctuation is worse than losing it,
// because the count of it is what this corpus is measured for.
//
// The map is the single exit, so that no path through here lets a C1 control
// out. It is the 1252 one and it is applied to every single byte codepage,
// because none of the 8859 family nor of the windows-125x one puts a character
// in 0x80 to 0x9F: 8859 calls that range controls, and the Encoding Standard
// makes iso-8859-1, latin1, cp819 and us-ascii aliases of windows-1252 for
// exactly this reason, that the clients declaring the one write the bytes of the
// other. Mapping it costs nothing and recovers the punctuation a Windows client
// puts there. Applied to a utf-8 result it takes out the same range, which no
// keyboard produces either.
// The declarations clients get wrong, kept on the sniff. Everything the Encoding
// Standard makes an alias of windows-1252 is here, and so is utf-8: those are
// the names a mail client writes over bytes of the other kind.
const LATIN_LABELS = new Set([
  '', 'windows-1252', 'cp1252', 'x-cp1252', 'cp-1252', 'windows_1252', 'windows-1252-1',
  'iso-8859-1', 'iso8859-1', 'iso_8859-1', 'iso-ir-100', 'latin1', 'l1', 'cp819', 'ibm819',
  'us-ascii', 'ascii', 'ansi_x3.4-1968',
  'utf-8', 'utf8', 'unicode-1-1-utf-8', 'x-unicode-1-1-utf-8',
]);

// A width no single byte read can approximate: half the bytes of a utf-16 text
// are NUL, and a text read in the wrong width is not a message a person can be
// measured from. When the label names one of these and the bytes do not fit it,
// the part is refused rather than measured.
const WIDE_LABELS = new Set([
  'utf-16', 'utf-16le', 'utf-16be', 'utf16', 'utf16le', 'utf16be', 'unicodefeff', 'unicodefffe',
  'ucs-2', 'ucs2', 'iso-10646-ucs-2', 'utf-32', 'utf-32le', 'utf-32be', 'utf32', 'utf32le', 'utf32be',
]);

function charsetLabel(charset) {
  return String(charset || '').trim().toLowerCase().replace(/^"|"$/g, '');
}

function sequenceLength(byte) {
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 1;
}

// Sequence by sequence: what decodes as utf-8 is utf-8, and a byte that opens no
// sequence is the codepage, one byte at a time. A body that is wholly one or
// wholly the other comes out of this exactly as the two whole reads would give
// it; only a body that is neither is changed, and it is changed into the part of
// itself that is readable.
function decodeMixed(buffer) {
  const strict = new TextDecoder('utf-8', { fatal: true });
  let out = '';
  let at = 0;
  while (at < buffer.length) {
    const length = sequenceLength(buffer[at]);
    if (length > 1 && at + length <= buffer.length) {
      try {
        out += strict.decode(buffer.subarray(at, at + length));
        at += length;
        continue;
      } catch (err) {
        // Not a sequence after all, so the lead byte is read as a byte.
      }
    }
    out += String.fromCharCode(buffer[at]);
    at += 1;
  }
  return out;
}

// The optional report is how a doubtful decode reaches the caller: a run that
// silently measures mojibake is a profile nobody can tell is wrong, so the
// messages whose declaration their own bytes refused are counted and named.
function decodeCharset(binary, charset, report) {
  const buffer = Buffer.from(binary, 'latin1');
  const label = charsetLabel(charset);
  if (!LATIN_LABELS.has(label)) {
    try {
      return fromCp1252(new TextDecoder(label, { fatal: true }).decode(buffer));
    } catch (err) {
      // An unknown label, or bytes that do not fit the one it names.
      if (report) {
        report.doubtful += 1;
        report.charsets.add(label);
        if (WIDE_LABELS.has(label)) report.refused += 1;
      }
    }
  }
  try {
    return fromCp1252(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch (err) {
    return fromCp1252(decodeMixed(buffer));
  }
}

function decodeReport() {
  return { doubtful: 0, refused: 0, charsets: new Set() };
}

function decoded(report) {
  return { doubtful: report.doubtful, refused: report.refused, charsets: [...report.charsets].sort() };
}

// A part opens on a header line or on the blank line of an empty header area. A
// part that opens on anything else was never a part: it is the rest of the one
// before it, cut in two by a body line the sender did not escape. It is put back
// with its delimiter line, rather than counted as a message that stops there.
function isPartHead(raw) {
  const first = raw.split(/\r?\n/, 1)[0];
  return first === '' || /^[!-9;-~]+:/.test(first);
}

function rejoinParts(parts, marker) {
  const out = [];
  for (const part of parts) {
    if (out.length && !isPartHead(part)) out[out.length - 1] += '\n' + marker + '\n' + part;
    else out.push(part);
  }
  return out;
}

// RFC 2046 section 5.1.1 puts the delimiter at column 0. Whitespace before it
// means a line of body text, so the raw line is tested and not the trimmed one,
// and the closing delimiter ends the read: what follows it is the epilogue.
function splitMultipart(body, boundary) {
  const marker = '--' + boundary;
  const delimiter = new RegExp('^' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \t]*(--)?[ \t]*$');
  const parts = [];
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const match = delimiter.exec(line);
    if (match) {
      if (current) parts.push(current.join('\n'));
      current = null;
      if (match[1]) break;
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join('\n'));
  return rejoinParts(parts, marker);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// A numeric entity is a code point written as a number, and a number is not
// always a character. A Windows client writes its punctuation as the cp1252
// position rather than the unicode one, &#146; for the apostrophe and &#151;
// for the dash, so the expansion goes through the same map as the bytes do:
// everything outside 0x80 to 0x9F, &#8217; included, comes out of it
// untouched. What the map cannot answer for is a number naming no character:
// past the last code point Unicode has, inside the surrogate range, or a
// control no keyboard sends. Expanding the first by hand throws, and a run
// that dies on one message loses the whole mailbox; the others hand the sample
// the control the charset decode was written to keep out. All three are read
// the way the charset reads a byte it leaves undefined, as a space, which
// keeps the boundary between the two words the entity stood between. A tab and
// a line break are text, and stay.
function fromNumericEntity(code) {
  const layout = code === 0x09 || code === 0x0a || code === 0x0d;
  if (!Number.isFinite(code) || code > 0x10ffff) return ' ';
  if (code >= 0xd800 && code <= 0xdfff) return ' ';
  if (!layout && (code < 0x20 || code === 0x7f)) return ' ';
  return fromCp1252(String.fromCodePoint(code));
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (all, code) => fromNumericEntity(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (all, code) => fromNumericEntity(parseInt(code, 16)))
    .replace(/&(\w+);/g, (all, name) => (ENTITIES[name.toLowerCase()] === undefined ? all : ENTITIES[name.toLowerCase()]))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The readable text of one part, recursively. text/plain wins; HTML is reduced
// to text only when there is nothing else; an attachment carries no text.
function partText(raw, depth, report) {
  const { headers, body } = splitMessage(raw);
  const { type, params } = parseContentType(headers['content-type']);
  const encoding = String(headers['content-transfer-encoding'] || '7bit').trim().toLowerCase();

  if (type.startsWith('multipart/') && params.boundary && depth < 8) {
    const found = splitMultipart(body, params.boundary)
      .map((part) => partText(part, depth + 1, report))
      .filter((part) => part.text.trim());
    return found.find((part) => part.type === 'text/plain')
      || found.find((part) => part.type === 'text/html')
      || found[0]
      || { type: 'text/plain', text: '' };
  }

  let binary = body;
  if (encoding === 'base64') binary = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('latin1');
  else if (encoding === 'quoted-printable') binary = decodeQuotedPrintable(body);
  const text = decodeCharset(binary, params.charset, report);

  if (type === 'text/html') return { type: 'text/html', text: htmlToText(text) };
  if (type === 'text/plain') return { type: 'text/plain', text };
  return { type, text: '' };
}

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function addressesOf(value) {
  const found = String(value || '').match(ADDRESS);
  return found ? found.map((address) => address.toLowerCase()) : [];
}

// The one address a header names. Exchange and several list managers write the
// display name as a quoted address of their own, so the last thing in angle
// brackets wins; a header with no brackets falls back to its first bare address.
function addressOf(value) {
  const text = String(value || '');
  const bracketed = text.match(/<[^<>]*>/g);
  if (bracketed) {
    const inner = addressesOf(bracketed[bracketed.length - 1]);
    if (inner.length) return inner[0];
  }
  return addressesOf(text)[0];
}

// One address per recipient, in the order the header lists them, so that the
// first recipient is the one the register is guessed from.
function addressesIn(value) {
  return String(value || '').split(',').map(addressOf).filter(Boolean);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const SENT_DAY = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b/;

// The day the sender's own clock showed, read from the header as sent. Going
// through UTC first files an evening message on the next morning and a
// small-hours one on the day before, which shifts a whole corpus by a day.
function dateOf(value) {
  const text = String(value || '');
  const sent = SENT_DAY.exec(text);
  const month = sent ? MONTHS.indexOf(sent[2].toLowerCase()) : -1;
  if (month !== -1) {
    return sent[3] + '-' + String(month + 1).padStart(2, '0') + '-' + sent[1].padStart(2, '0');
  }
  const when = new Date(text);
  return Number.isNaN(when.getTime()) ? null : when.toISOString().slice(0, 10);
}

// --- Quoted replies -------------------------------------------------------
//
// A line opening with '>' is someone else's, wherever it sits, so an inline
// reply keeps the answers between the quotations. An attribution line, a
// separator or a repeated header block opens a block that runs to the end of the
// message, so everything after it is dropped.

const ATTRIBUTION = /^\s*(le|on)\b[\s\S]{0,300}?(a écrit|a ecrit|wrote)\s*:\s*$/i;

const SEPARATOR = /^\s*[-_]{2,}\s*(original message|message d[\u2019']origine|forwarded message|message transféré|begin forwarded message)/i;

const FORWARD = /^\s*(begin forwarded message\s*:|-+\s*forwarded message|-+\s*message transféré)/i;

const HEADER_LINE = /^\s*(de|from|expéditeur|to|à|cc|copie|objet|subject|date|sent|envoyé|envoye)\s*:/i;

function isAttribution(lines, index) {
  for (let span = 1; span <= 3 && index + span <= lines.length; span += 1) {
    if (ATTRIBUTION.test(lines.slice(index, index + span).join(' '))) return true;
  }
  return false;
}

// One header line is prose ('Objet : le devis'); two in a row is the head of a
// message someone else wrote, pasted below the reply.
function isHeaderBlock(lines, index) {
  return HEADER_LINE.test(lines[index]) && HEADER_LINE.test(lines[index + 1] || '');
}

// A decoded message holds no control character. Tab, newline and carriage return
// are text; every other C0, every C1, DEL and U+FFFD are what a wrong charset
// leaves behind, and a message carrying one did not decode, whatever its header
// claimed. It is counted unreadable and never measured: losing one real message
// in a thousand to a bad byte is a known price, measuring rubbish is not. The
// count is reported per source and nothing else about it is, since the path and
// the text of a message nobody could read are still the user's.
const UNDECODED = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/;

function undecoded(text) {
  return UNDECODED.test(text);
}

function stripQuoted(text) {
  const lines = text.split('\n');
  const kept = [];
  const marks = { quoted: false, forwarded: false };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FORWARD.test(line)) { marks.forwarded = true; marks.quoted = true; break; }
    if (isAttribution(lines, index) || SEPARATOR.test(line) || isHeaderBlock(lines, index)) {
      marks.quoted = true;
      break;
    }
    if (/^\s*>/.test(line)) { marks.quoted = true; continue; }
    kept.push(line);
  }
  return { text: kept.join('\n').trim(), quoted: marks.quoted, forwarded: marks.forwarded };
}

// --- Sign-off and signature -----------------------------------------------
//
// Both are measurements, not rubbish: which formula someone closes with, and
// what they carry under it, are two of the things a profile has to say. They are
// separated from the body rather than deleted.

const SIGNOFF = new RegExp(
  '^\\s*(cordialement|bien cordialement|très cordialement|bien à (vous|toi)'
  + '|sincères salutations|salutations( distinguées)?|respectueusement'
  + '|je vous prie d[\u2019\']agréer|veuillez agréer|dans l[\u2019\']attente'
  + '|merci (d[\u2019\']avance|beaucoup|encore)|bonne (journée|soirée|réception)'
  + '|à (bientôt|demain|tout à l[\u2019\']heure)|amitiés|amicalement'
  + '|bises|bisous|je t[\u2019\']embrasse|tendrement'
  + '|adieu|tout à (toi|vous)|mille (choses|amitiés|baisers|tendresses)'
  + '|(best|kind|warm) regards|regards|sincerely|yours( sincerely| faithfully| truly)?'
  + '|cheers|thanks( again)?|thank you|talk soon|best)\\b',
  'i'
);

// The long formal French formula runs over several lines; a name under the
// sign-off does not, so only these words continue the formula.
const SIGNOFF_CONTINUATION = /agréer|salutations|sentiments|considération|expression|distingu|dévoué/i;

const SIGNATURE_DELIMITER = /^--\s*$/;

function splitSignature(text) {
  const lines = text.split('\n');
  let signature = [];

  const delimiter = lines.findIndex((line) => SIGNATURE_DELIMITER.test(line));
  if (delimiter !== -1) {
    signature = lines.slice(delimiter + 1);
    lines.length = delimiter;
  }

  let signoff = [];
  for (let index = lines.length - 1; index >= 0 && lines.length - index <= 12; index -= 1) {
    if (!lines[index].trim()) continue;
    if (!SIGNOFF.test(lines[index])) continue;
    let end = index;
    while (end + 1 < lines.length && SIGNOFF_CONTINUATION.test(lines[end + 1])) end += 1;
    signoff = lines.slice(index, end + 1);
    signature = lines.slice(end + 1).concat(signature);
    lines.length = index;
    break;
  }

  return {
    body: lines.join('\n').trim(),
    signoff: signoff.join(' ').trim(),
    signature: signature.join('\n').trim(),
  };
}

// A greeting is one short line, either punctuated like a greeting or opening with
// a word a language greets with. It stays inside the text and is named here as
// well, since which greeting goes to whom is one of the things a profile says.
const SALUTATION_OPENERS = /^(bonjour|bonsoir|salut|coucou|cher|chère|chers|chères|madame|monsieur|messieurs|mesdames|hello|hi|hey|dear|good (morning|afternoon|evening))\b/i;

const SALUTATION_WORDS = 8;

// The first lines only: a letter opens on a place and a date above its greeting,
// and a mail client sometimes prints a line of its own, but no one greets in the
// fourth paragraph.
const SALUTATION_LINES = 3;

function salutationOf(text) {
  const opening = String(text).split('\n').map((line) => line.trim())
    .filter((line) => line.length).slice(0, SALUTATION_LINES);
  for (const line of opening) {
    if (wordCount(line) > SALUTATION_WORDS) continue;
    if (SALUTATION_OPENERS.test(line)) return line;
    // Whatever the language, a greeting is a few words ending in a comma: a name,
    // a title, an endearment. Four words at most, so that a short sentence that
    // happens to end in a comma is not taken for one.
    if (/[,:]$/.test(line) && wordCount(line) <= 4) return line;
  }
  return '';
}

// --- Masking --------------------------------------------------------------

const MASK_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Two letters and two check digits, then groups of four. Every letter is matched
// in either case, because a bank identifier gets typed in lower case as often as
// not, bank code included: refusing a group of four lower case letters refused
// every British, Irish, Dutch and Maltese account along with the prose it was
// aimed at. The prose guard is the digit count, applied in the replacer, so that
// a shape holding none of an account number is left where it stands.
const MASK_IBAN = /\b[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]{4}){2,7}(?:[ ]?[A-Za-z0-9]{1,3})?\b/g;

const IBAN_DIGITS = 8;

// International, then the French national form, then the North American form
// with or without its parentheses, then any run of at least four groups of
// digits. Three groups are left alone: that shape is a date.
const MASK_PHONE = /\+\d{1,3}(?:[\s.-]?\d){6,14}|\b0\d(?:[\s.-]?\d{2}){4}\b|\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{2,3}(?:[\s.-]\d{2,3}){3,5}\b/g;

// The reference may open on letters: F-2026-0031 is the commonest shape a French
// invoice carries, and refusing it leaves both the reference and the amount
// beside it in the clear.
const MASK_CASE = /\b(dossier|référence|reference|ref|case|file|facture|invoice|contrat|contract)\b\s*(?:n[°o]?\s*)?[:.]?\s*([A-Za-z]{0,4}[-\/.]?\d[A-Za-z0-9./-]{2,})/gi;

// Longest first, and the word closed on a boundary: read in the other order, a
// case insensitive EUR matches three letters of 'euros' and leaves the other two
// standing beside the placeholder.
const MASK_AMOUNT = /\d[\d .,]*\s?(?:€|£|\$|(?:euros?|EUR|USD|GBP)\b)/gi;

// An account number ends on its check digits, so a run of letters at the end of
// the match is the next word of the sentence rather than a part of it: the shape
// cannot tell 'chez la' from a bank code, and the words are given back one at a
// time until something ending in a figure is left. What is left is an identifier
// when it still carries IBAN_DIGITS figures, and prose when it does not.
const IBAN_TAIL = /\s+[A-Za-z]+$/;

function ibanHead(all) {
  let head = all;
  let tail = IBAN_TAIL.exec(head);
  while (tail && tail.index > 0) {
    head = head.slice(0, tail.index);
    tail = IBAN_TAIL.exec(head);
  }
  return head;
}

function maskIban(text) {
  return text.replace(MASK_IBAN, (all) => {
    const head = ibanHead(all);
    return (head.match(/\d/g) || []).length >= IBAN_DIGITS
      ? '[iban]' + all.slice(head.length)
      : all;
  });
}

// The placeholders this file writes, named once so that the script downstream can
// read them rather than restate them. scripts/stylometry.js cuts its run of
// tokens at each of these and leaves them where they stand: a placeholder it does
// not recognise is read as a word the person wrote, joins the two words it stands
// between, and comes back masked a second time. The two lists must not drift.
const COLLECT_MASKS = ['[email]', '[iban]', '[reference]', '[amount]', '[phone]'];

// A figure is ordinary prose until it travels with a case number, and then it is
// what someone owes on a file that names them. So the amounts of a message that
// carries a case number are masked, and the amounts of a message that does not
// are left where the stylometry can still count them.

function mask(text) {
  let out = maskIban(String(text).replace(MASK_ADDRESS, '[email]'));
  MASK_CASE.lastIndex = 0;
  const hasCase = MASK_CASE.test(out);
  MASK_CASE.lastIndex = 0;
  out = out.replace(MASK_CASE, (all, word, number) => all.replace(number, '[reference]'));
  if (hasCase) out = out.replace(MASK_AMOUNT, '[amount]');
  return out.replace(MASK_PHONE, '[phone]');
}

// --- Surface and register -------------------------------------------------

const MESSAGE_WORDS = 25;

function wordCount(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function guessSurface(adapter, extension, words) {
  if (words < MESSAGE_WORDS) return 'message';
  if (extension === '.tex' || extension === '.pdf') return 'letter';
  return adapter === 'folder' ? 'letter' : 'email';
}

// A public body names itself in the domain it writes from: either the domain
// ends in the zone a state reserves for its administration, or one of its labels
// is the name of an institution. The list is short and stays short: it is a
// first guess about a kind of correspondent, corrected at the presentation step,
// not a directory of one country's offices.
const PUBLIC_BODY_ZONES = [
  '.gov', '.gouv.fr', '.gov.uk', '.gc.ca', '.govt.nz', '.admin.ch', '.europa.eu', '.go.jp', '.gob.es',
];

const PUBLIC_BODY_LABELS = [
  'gouv', 'gov', 'urssaf', 'impots', 'ameli', 'caf', 'service-public',
  'justice', 'tribunal', 'greffe', 'prefecture', 'mairie', 'ville',
];

function isPublicBody(domain) {
  if (!domain) return false;
  const name = domain.toLowerCase();
  if (PUBLIC_BODY_ZONES.some((zone) => name === zone.slice(1) || name.endsWith(zone))) return true;
  return name.split('.').some((label) => PUBLIC_BODY_LABELS.includes(label));
}

const OFFICIAL_SALUTATION = /^\s*(madame,?\s*monsieur|messieurs|madame la |monsieur le |to whom it may concern|dear sir or madam)/im;

const OFFICIAL_CLOSING = /je vous prie d[\u2019']agréer|veuillez agréer|salutations distinguées|sentiments (respectueux|distingués)|yours (faithfully|sincerely)/i;

const CASE_NUMBER = /\b(dossier|référence|reference|case|file)\b\s*(?:n[°o]?\s*)?[:.]?\s*(\[reference\]|[A-Za-z]*\d[A-Za-z0-9./-]{2,})/i;

const FAMILIAR = /\b(tu|toi|ton|ta|tes|tiens|t[\u2019']en|t[\u2019']ai|t[\u2019']embrasse)\b/gi;

const FORMAL = /\b(vous|votre|vos)\b/gi;

function countMatches(text, pattern) {
  const found = text.match(pattern);
  return found ? found.length : 0;
}

// The guess the presentation step corrects. Administrative first, because a
// letter to an office can be warm and still be administrative.
function guessRegister(domain, text) {
  if (isPublicBody(domain)) return 'administrative';
  const markers = [OFFICIAL_SALUTATION, OFFICIAL_CLOSING, CASE_NUMBER].filter((pattern) => pattern.test(text));
  if (markers.length >= 2) return 'administrative';
  if (countMatches(text, FAMILIAR) > countMatches(text, FORMAL)) return 'personal';
  return 'professional';
}

// --- Adapters -------------------------------------------------------------

// The signature stays out of text: a block of contact details under every
// message would weigh on every length this document is measured for. The
// sign-off stays in, because it is a sentence the person wrote.
function makeSample(fields) {
  const text = [fields.body, fields.signoff].filter(Boolean).join('\n\n');
  const words = wordCount(text);
  return {
    id: fields.id,
    mailbox: fields.tag,
    adapter: fields.adapter,
    source: fields.source,
    date: fields.date,
    recipient_domain: fields.recipientDomain,
    surface: guessSurface(fields.adapter, fields.extension, words),
    register: guessRegister(fields.recipientDomain, text),
    words,
    text,
    salutation: salutationOf(fields.body),
    signoff: fields.signoff,
    signature: fields.signature,
  };
}

function emptyCounts() {
  return {
    read: 0,
    kept: 0,
    dropped: { not_from_the_user: 0, nothing_of_their_own: 0, no_body: 0, unreadable: 0 },
  };
}

// A mailbox exported from a mail client: Apple Mail exports the sent mailbox,
// Gmail goes through Takeout, Thunderbird through ImportExportTools. The file is
// read as bytes and each part is decoded in its own charset, so one latin1
// message in a utf-8 mailbox still reads.
function collectMbox(file, options) {
  const me = new Set((options.me || []).map((address) => address.toLowerCase()));
  const counts = emptyCounts();
  const report = decodeReport();
  const samples = [];

  for (const message of streamMbox(file, options.chunkSize)) {
    counts.read += 1;
    const { headers, body } = splitMessage(message);
    const from = addressOf(decodeEncodedWords(headers.from));
    if (!from || !me.has(from)) {
      counts.dropped.not_from_the_user += 1;
      continue;
    }
    // The user did write something; the parser found no blank line under the
    // headers and so could not tell where it started. Counting that as nothing
    // of their own would report a whole mailbox as silent.
    if (!body.trim()) {
      counts.dropped.no_body += 1;
      continue;
    }

    const before = report.refused;
    const decoded = partText(message, 0, report);
    // The bytes refused the width their own header declared, so what came back
    // is not a message: it is counted as unreadable rather than measured.
    if (report.refused > before || undecoded(decoded.text)) {
      counts.dropped.unreadable += 1;
      continue;
    }
    const stripped = stripQuoted(decoded.text);
    const parted = splitSignature(stripped.text);
    if (!wordCount(parted.body)) {
      counts.dropped.nothing_of_their_own += 1;
      continue;
    }

    const recipients = addressesIn(decodeEncodedWords(headers.to))
      .concat(addressesIn(decodeEncodedWords(headers.cc)))
      .filter((address) => !me.has(address));
    const domain = recipients.length ? recipients[0].split('@')[1] : null;

    counts.kept += 1;
    samples.push(makeSample({
      id: options.tag + '-' + String(counts.kept).padStart(4, '0'),
      tag: options.tag,
      adapter: 'mbox',
      source: path.basename(file),
      date: dateOf(headers.date),
      recipientDomain: domain,
      extension: '',
      body: mask(parted.body),
      signoff: mask(parted.signoff),
      signature: mask(parted.signature),
    }));
  }

  return { counts, samples, decoding: decoded(report) };
}

const FOLDER_EXTENSIONS = new Set(['.txt', '.md', '.tex']);

// Enough TeX to read a letter written in it: comments out, environments out,
// a command keeps the text it wraps.
function texToText(text) {
  return text
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?/g, '')
    .replace(/\\(documentclass|usepackage|newcommand|renewcommand)(\[[^\]]*\])?\{[^}]*\}(\{[^}]*\})?/g, '')
    .replace(/\\[A-Za-z]+(\[[^\]]*\])?\{([^{}]*)\}/g, '$2')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walk(directory) {
  const found = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...walk(full));
    else if (FOLDER_EXTENSIONS.has(path.extname(item.name).toLowerCase())) found.push(full);
  }
  return found.sort();
}

// Letters the user corrected by hand: the samples closest to what the user
// actually approves, which no sent mail quite is. That is said by the adapter
// name and the tag on each sample, not by a figure: a number nobody can
// recompute by hand reads worse than a flat count, and the priority it stood
// for belongs where the extracts are chosen.
function collectFolder(directory, options) {
  const counts = emptyCounts();
  const report = decodeReport();
  const samples = [];

  for (const file of walk(directory)) {
    counts.read += 1;
    let text;
    try {
      // Read as bytes and decoded like a mail part: a letter saved by an older
      // editor is cp1252 or latin1, and a lenient utf-8 read turns every accented
      // letter in it into a replacement character without failing, so the sample
      // is kept and counted as if it had been read.
      //
      // No declaration is passed, because a .txt file carries none. Naming one
      // here would assert a charset over a file nobody claimed it for, which the
      // decoder now believes.
      //
      // One kind of line ending in the samples, the one the mbox path already
      // hands over, so that no carriage return travels into an extract.
      text = decodeCharset(fs.readFileSync(file).toString('latin1'), '', report).replace(/\r\n/g, '\n');
    } catch (err) {
      counts.dropped.unreadable += 1;
      continue;
    }
    if (undecoded(text)) {
      counts.dropped.unreadable += 1;
      continue;
    }

    const extension = path.extname(file).toLowerCase();
    const parted = splitSignature(stripQuoted(extension === '.tex' ? texToText(text) : text).text);
    if (!wordCount(parted.body)) {
      counts.dropped.nothing_of_their_own += 1;
      continue;
    }

    const stamp = /(\d{4}-\d{2}(?:-\d{2})?)/.exec(path.basename(file));
    counts.kept += 1;
    samples.push(makeSample({
      id: options.tag + '-' + String(counts.kept).padStart(4, '0'),
      tag: options.tag,
      adapter: 'folder',
      source: path.relative(directory, file),
      date: stamp ? stamp[1] : null,
      recipientDomain: null,
      extension,
      body: mask(parted.body),
      signoff: mask(parted.signoff),
      signature: mask(parted.signature),
    }));
  }

  return { counts, samples, decoding: decoded(report) };
}

// --- Command line ---------------------------------------------------------

const USAGE = [
  'voice.md sample collection',
  '',
  '  node scripts/collect.js mbox <file.mbox> --me <address>[,<address>] --tag pro --out <file> [--lang fr]',
  '  node scripts/collect.js folder <directory> [--tag letters] --out <file> [--lang fr]',
  '',
  '  --me      the addresses the user sends from; only those messages are kept',
  '  --tag     the name of the source in the output, usually pro or perso',
  '  --out     the file the JSON document is written to, required',
  '  --lang    the language of the samples, carried through to the stylometry',
  '',
  'The document holds one entry per sample: the text, the mailbox tag, the',
  'adapter it came from, the date, the recipient domain, the guessed surface and',
  'register, and the salutation, sign-off and signature named apart.',
  '',
  'Addresses, bank identifiers, case references, the amounts that travel with one',
  'and telephone numbers are masked here. Names are not: scripts/stylometry.js is',
  'what masks those, and only in the two files it writes.',
].join('\n');

function parseArgs(argv) {
  const options = { adapter: null, source: null, tag: null, me: [], out: null, lang: null, unknown: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tag') { index += 1; options.tag = argv[index] || null; }
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else if (arg === '--out') { index += 1; options.out = argv[index] || null; }
    else if (arg === '--lang') { index += 1; options.lang = argv[index] || null; }
    else if (arg.startsWith('--lang=')) options.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg === '--me') { index += 1; options.me.push(...String(argv[index] || '').split(',')); }
    else if (arg.startsWith('--me=')) options.me.push(...arg.slice('--me='.length).split(','));
    else if (arg.startsWith('--')) { options.unknown.push(arg); index += 1; }
    else if (!options.adapter) options.adapter = arg;
    else if (!options.source) options.source = arg;
    // A flag no branch claimed used to fall through here and take its value with
    // it, and a second mailbox on the line was read by nothing. Both are kept
    // and refused by the caller: the setup tells the model these flags are what
    // the scripts accept and nothing else is, and nothing enforced it.
    else options.unknown.push(arg);
  }
  options.me = options.me.map((address) => address.trim().toLowerCase()).filter(Boolean);
  return options;
}

// The name of the source, not its path: a folder called Lettres-avocat-Dupont or
// a file called sent-cabinet-martin.mbox names a correspondent, and this line
// travels through the stylometry into the one file the model reads.
function sourceLabel(options) {
  return (options.adapter === 'mbox' ? 'one mailbox tagged ' : 'one folder tagged ') + options.tag;
}

function document(options, result) {
  return {
    tool: 'voice.md collect',
    lang: options.lang,
    adapter: options.adapter,
    tag: options.tag,
    source: sourceLabel(options),
    collected: new Date().toISOString().slice(0, 10),
    counts: result.counts,
    samples: result.samples,
  };
}

function runCli(argv, write, writeError) {
  const options = parseArgs(argv);
  if (options.unknown.length) {
    writeError('unknown arguments: ' + options.unknown.join(', '));
    return 1;
  }
  if (!options.adapter || !options.source) {
    write(USAGE);
    return options.adapter ? 1 : 0;
  }
  if (options.adapter !== 'mbox' && options.adapter !== 'folder') {
    writeError('unknown adapter: ' + options.adapter);
    return 1;
  }
  if (options.adapter === 'mbox' && !options.me.length) {
    writeError('mbox needs --me: without it there is no telling which messages the user sent');
    return 1;
  }
  // Checked before a single message is read: a corpus printed by accident is
  // read by whoever is watching this output, which in an agent session is the
  // model.
  if (!options.out) {
    writeError('name the file the samples go to: --out <file>');
    return 1;
  }
  if (!options.tag) options.tag = options.adapter === 'folder' ? 'letters' : 'mail';

  let result;
  try {
    result = options.adapter === 'mbox'
      ? collectMbox(options.source, options)
      : collectFolder(options.source, options);
  } catch (err) {
    writeError(options.source + ': ' + err.message);
    return 1;
  }

  // A run that kept nothing is not a run that succeeded: a mistyped address, or
  // a folder holding nothing readable, used to exit 0 and let the stylometry
  // announce a source that contributed no sample.
  if (!result.counts.kept) {
    writeError(options.source + ': 0 samples of ' + result.counts.read + ' read'
      + (options.adapter === 'mbox' ? '; no message has a From among ' + options.me.join(', ') : ''));
    return 1;
  }
  // What could not be read as it was declared is said here, because nothing
  // further down the pipeline can tell: a mailbox exported in a charset this
  // machine cannot read produces samples that look like samples.
  if (result.decoding && result.decoding.doubtful) {
    writeError(result.decoding.doubtful + ' of ' + result.counts.read
      + ' messages did not decode as declared (' + result.decoding.charsets.join(', ') + ')');
  }

  const json = JSON.stringify(document(options, result), null, 2);
  // A run given both writes the file: the flag that keeps the samples on the
  // disk wins over the one that shows them.
  if (!options.out) {
    write(json);
    return 0;
  }
  try {
    fs.writeFileSync(options.out, json + '\n');
  } catch (err) {
    writeError(options.out + ': ' + err.message);
    return 1;
  }
  const unreadable = result.counts.dropped.unreadable;
  write(result.counts.kept + ' samples of ' + result.counts.read + ' read, written to ' + options.out
    + (unreadable ? '; ' + unreadable + ' did not decode and were not measured' : ''));
  return 0;
}

module.exports = {
  undecoded,
  splitMbox, streamMbox, splitMessage, parseContentType, decodeEncodedWords, decodeQuotedPrintable,
  decodeCharset, decodeReport, splitMultipart, htmlToText, partText, addressesOf, addressOf, addressesIn, dateOf,
  stripQuoted, splitSignature, salutationOf, mask, COLLECT_MASKS, wordCount, guessSurface, guessRegister, isPublicBody,
  texToText, collectMbox, collectFolder, parseArgs, runCli, USAGE, MESSAGE_WORDS,
};

if (require.main === module) {
  process.exitCode = runCli(
    process.argv.slice(2),
    (text) => process.stdout.write(text + '\n'),
    (text) => process.stderr.write(text + '\n')
  );
}
