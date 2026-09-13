'use strict';

// Reading the mail where the client already put it, plus the window, the
// converters and the detection that names what a machine holds.
//
// Every mailbox below is synthetic and every address in it is at example.com or
// example.fr, which no one owns. Nothing here reads the mail of the person
// running the tests: the fixtures build an Apple Mail tree in a temporary
// directory and the readers are pointed at that.

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-applemail-'));
}

// A message with a body long enough to survive the word count, since a sample
// of four words is dropped as nothing of the author's own.
function letter(extra) {
  return [
    'From: The Writer <' + ME + '>',
    'To: Client <client@example.fr>',
    'Date: Wed, 4 Mar 2026 10:00:00 +0100',
  ].concat(extra || []).join('\n')
    + '\n\nBonjour,\n\nLe chantier commence lundi et les travaux durent trois semaines.\n\n'
    + 'Cordialement,\nLe Writer\n';
}

// An .emlx is the length of the message in bytes, the message, and a plist of
// Apple's own flags underneath. The plist is deliberately longer than nothing,
// because the reader has to stop at the declared length rather than at the end
// of the file.
function emlx(message) {
  return Buffer.concat([
    Buffer.from(String(Buffer.byteLength(message)) + '\n'),
    Buffer.from(message),
    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">'
      + '<dict><key>flags</key><integer>8623489</integer></dict></plist>\n'),
  ]);
}

// The shape Apple Mail files a message in: an account directory, a mailbox
// ending in .mbox, and the message several levels under it.
function fileMessage(root, account, box, name, message) {
  const directory = path.join(root, account, box + '.mbox', 'ABCD-1234', 'Data', '3', '7', 'Messages');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), emlx(message));
  return path.join(directory, name);
}

function tree(messages) {
  const dir = sandbox();
  const root = path.join(dir, 'V10');
  for (const entry of messages) {
    fileMessage(root, entry.account || 'UUID-1', entry.box, entry.name, entry.message);
  }
  return dir;
}

function collectMail(root, options) {
  return collect.collectAppleMail(root, Object.assign({ me: [ME], tag: 'pro' }, options || {}));
}

// --- The file format --------------------------------------------------------

test('the message ends where its declared length says, not where the file does', () => {
  const message = letter();
  const back = collect.emlxMessage(emlx(message));
  assert.strictEqual(back, message);
  assert.doesNotMatch(back, /plist/);
});

test('a length longer than the bytes in hand returns what was read', () => {
  // This is the head read: the first kilobytes of a file whose declared length
  // is the whole of it. Trusting the number over the buffer would read past the
  // end and throw on every message.
  const message = letter();
  const head = emlx(message).subarray(0, 120);
  const back = collect.emlxMessage(head);
  assert.ok(back.length > 0);
  assert.ok(message.startsWith(back));
});

test('a file that is not an emlx is read as the bytes it holds', () => {
  const back = collect.emlxMessage(Buffer.from('From: nobody\n\nplain text\n'));
  assert.match(back, /plain text/);
});

test('a file with no newline at all yields nothing rather than throwing', () => {
  assert.strictEqual(collect.emlxMessage(Buffer.from('2048')), '');
});

// --- Which mailboxes are read -----------------------------------------------

test('drafts, junk, trash and the outbox are left out, sent and archive are read', () => {
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message: letter() },
    { box: 'Archive', name: '2.emlx', message: letter() },
    { box: 'Brouillons', name: '3.emlx', message: letter() },
    { box: 'Junk', name: '4.emlx', message: letter() },
    { box: 'Corbeille', name: '5.emlx', message: letter() },
  ]);
  const found = collect.emlxFiles(path.join(dir, 'V10'), collect.MAIL_SKIP);
  const boxes = found.map(collect.mailboxName).sort();
  assert.deepStrictEqual(boxes, ['Archive', 'Sent Messages']);
});

test('a mailbox named with accents is skipped whether macOS decomposed it or not', () => {
  // The filesystem hands a directory name back decomposed, so the accented
  // letter arrives as two characters. A pattern spelling it out matches
  // neither form reliably, which is why the reader normalises first.
  // Named by escape, never carried: the two forms are the same name, and an editor
  // saving this file would quietly turn one into the other.
  const composed = '\u00c9l\u00e9ments supprim\u00e9s';
  const decomposed = 'E\u0301le\u0301ments supprime\u0301s';
  for (const form of [composed, decomposed]) {
    const dir = tree([
      { box: form, name: '1.emlx', message: letter() },
      { box: 'Sent Messages', name: '2.emlx', message: letter() },
    ]);
    const found = collect.emlxFiles(path.join(dir, 'V10'), collect.MAIL_SKIP);
    assert.strictEqual(found.length, 1, form + ' was not skipped');
    assert.strictEqual(collect.mailboxName(found[0]), 'Sent Messages');
  }
});

test('a message whose body was never downloaded is not measured as a whole one', () => {
  const dir = tree([{ box: 'Sent Messages', name: '1.emlx', message: letter() }]);
  const directory = path.dirname(collect.emlxFiles(path.join(dir, 'V10'), collect.MAIL_SKIP)[0]);
  fs.writeFileSync(path.join(directory, '2.partial.emlx'), emlx(letter()));
  assert.strictEqual(collect.emlxFiles(path.join(dir, 'V10'), collect.MAIL_SKIP).length, 1);
});

test('the mailbox names the sample, and the account directory names nobody', () => {
  const dir = tree([{ account: 'A1B2C3D4-0000', box: 'Sent Messages', name: '1.emlx', message: letter() }]);
  const result = collectMail(dir);
  assert.strictEqual(result.samples[0].source, 'Sent Messages');
  assert.doesNotMatch(JSON.stringify(result.samples), /A1B2C3D4/);
});

// --- What is kept -----------------------------------------------------------

test('only the messages the user sent are kept, whatever mailbox they sit in', () => {
  const dir = tree([
    { box: 'Tous les messages', name: '1.emlx', message: letter() },
    {
      box: 'Tous les messages',
      name: '2.emlx',
      message: 'From: Client <client@example.fr>\nTo: The Writer <' + ME + '>\n'
        + 'Date: Wed, 4 Mar 2026 11:00:00 +0100\n\nBonjour, merci pour votre retour sur le chantier.\n',
    },
  ]);
  const result = collectMail(dir);
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.not_from_the_user, 1);
});

test('the same message filed under two labels is one message', () => {
  // Gmail files a sent message under Sent and under All Mail. Counting it twice
  // weights whatever it happens to say twice over.
  const message = letter(['Message-Id: <abc-123@example.com>']);
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message },
    { box: 'Tous les messages', name: '2.emlx', message },
  ]);
  const result = collectMail(dir);
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.filed_twice, 1);
});

test('two different messages without a Message-Id are still two messages', () => {
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message: letter() },
    { box: 'Sent Messages', name: '2.emlx', message: letter() },
  ]);
  assert.strictEqual(collectMail(dir).counts.kept, 2);
});

test('the samples are numbered in one sequence across the mailboxes', () => {
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message: letter(['Message-Id: <a@example.com>']) },
    { box: 'Archive', name: '2.emlx', message: letter(['Message-Id: <b@example.com>']) },
  ]);
  assert.deepStrictEqual(collectMail(dir).samples.map((sample) => sample.id), ['pro-0001', 'pro-0002']);
});

// --- The window -------------------------------------------------------------

test('a number of years back resolves against the day it runs', () => {
  const resolved = collect.resolveSince('3y');
  assert.ok(resolved.ok);
  const expected = new Date();
  expected.setFullYear(expected.getFullYear() - 3);
  assert.strictEqual(resolved.since, expected.toISOString().slice(0, 10));
});

test('a date passes through and anything else is refused', () => {
  assert.strictEqual(collect.resolveSince('2024-01-31').since, '2024-01-31');
  assert.strictEqual(collect.resolveSince(null).since, null);
  assert.ok(collect.resolveSince(null).ok);
  for (const bad of ['last year', '3 years', '2024', '3m', '2024-13-45x']) {
    assert.strictEqual(collect.resolveSince(bad).ok, false, bad + ' was accepted');
  }
});

test('a message older than the window is counted out, not silently missing', () => {
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message: letter() },
    {
      box: 'Sent Messages',
      name: '2.emlx',
      message: letter().replace('Wed, 4 Mar 2026 10:00:00 +0100', 'Mon, 3 Mar 2014 10:00:00 +0100'),
    },
  ]);
  const result = collectMail(dir, { since: '2023-01-01' });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.outside_the_window, 1);
});

test('a message whose date did not parse is kept rather than dropped by the window', () => {
  // A window that quietly drops what it cannot date thins the corpus by whatever
  // the mail client wrote its dates in, and reports nothing.
  const dir = tree([{
    box: 'Sent Messages',
    name: '1.emlx',
    message: letter().replace('Date: Wed, 4 Mar 2026 10:00:00 +0100', 'Date: whenever'),
  }]);
  const result = collectMail(dir, { since: '2023-01-01' });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.outside_the_window, 0);
});

// --- Detection --------------------------------------------------------------

test('detection names the root it found and counts what it would read', () => {
  const dir = tree([
    { box: 'Sent Messages', name: '1.emlx', message: letter() },
    { box: 'Brouillons', name: '2.emlx', message: letter() },
  ]);
  const out = collect.detectLines(dir).join('\n');
  assert.match(out, /Apple Mail/);
  assert.match(out, /1 messages, drafts, junk and trash left out/);
});

test('detection prints the addresses it sees sending and no message text', () => {
  const dir = tree(Array.from({ length: 4 }, (unused, index) => ({
    box: 'Sent Messages',
    name: index + '.emlx',
    message: letter(['Message-Id: <' + index + '@example.com>']),
  })));
  const out = collect.detectLines(dir).join('\n');
  assert.match(out, new RegExp('4  ' + ME));
  // The whole point of the split: an address is the author's identity, which
  // step 1 has to establish anyway. What they wrote stays on the disk.
  assert.doesNotMatch(out, /chantier|Cordialement/);
});

test('an address below the floor is not offered as one of the user addresses', () => {
  const dir = tree([{ box: 'Sent Messages', name: '1.emlx', message: letter() }]);
  assert.doesNotMatch(collect.detectLines(dir).join('\n'), new RegExp(ME));
});

test('the senders that are machines are left off the list', () => {
  for (const robot of ['no-reply@example.fr', 'noreply@example.fr', 'newsletter@example.fr',
    'notifications@example.fr', 'mailer-daemon@example.fr', 'bounces@example.fr']) {
    assert.ok(collect.ROBOTS.test(robot), robot + ' was offered as an address to send from');
  }
  for (const human of [ME, 'writer@example.fr', 'contact@example.fr', 'newsroom@example.fr']) {
    assert.strictEqual(collect.ROBOTS.test(human), false, human + ' was taken for a machine');
  }
});

test('a machine with nothing readable says so and names the way out', () => {
  const out = collect.detectLines(sandbox()).join('\n');
  assert.match(out, /No mail this machine can read/);
  assert.match(out, /mbox|folder/);
});

// --- The formats a letter is saved in ---------------------------------------

test('a word processor document is converted and measured', (context) => {
  const dir = sandbox();
  const source = path.join(dir, 'lettre.html');
  // textutil ships with macOS and reads HTML as readily as .docx, which keeps
  // this test from carrying a binary fixture.
  fs.writeFileSync(source, '<html><body><p>Madame,</p><p>Le chantier commence lundi '
    + 'et les travaux durent trois semaines.</p><p>Cordialement,</p></body></html>');
  const report = collect.decodeReport();
  const converted = collect.convertToText(source, '.html', report);
  if (converted.missing) return context.skip(converted.missing + ' is not on this machine');
  assert.match(converted.text, /chantier commence lundi/);
});

test('a converter this machine lacks is named rather than the file vanishing', () => {
  const entry = collect.CONVERTED.get('.pdf');
  assert.strictEqual(entry.command, 'pdftotext');
  const dir = sandbox();
  const source = path.join(dir, 'absent.pdf');
  fs.writeFileSync(source, 'not a pdf');
  const converted = collect.convertToText(source, '.pdf', collect.decodeReport());
  // Either the tool is missing and says which, or it is here and refuses the
  // file. Neither may return text.
  assert.strictEqual(converted.text, null);
  if (converted.missing) assert.strictEqual(converted.missing, 'pdftotext');
});

test('a directory of correspondence keeps what the author signed and drops the rest', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'a-moi.txt'),
    'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines.\n\n'
    + 'Cordialement,\nThe Writer\n');
  fs.writeFileSync(path.join(dir, 'de-l-avocat.txt'),
    'Monsieur,\n\nVotre dossier appelle une reponse avant la fin du mois courant.\n\n'
    + 'Cordialement,\nMaitre Dupont\n');
  const result = collect.collectFolder(dir, { tag: 'letters', author: ['the writer'] });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.not_from_the_user, 1);
  assert.match(result.samples[0].text, /chantier/);
});

test('a letter dated in its name falls outside the window, one without a date stays', () => {
  const dir = sandbox();
  const body = 'Madame,\n\nLe chantier commence lundi et les travaux durent trois semaines.\n';
  fs.writeFileSync(path.join(dir, '2014-03-lettre.txt'), body);
  fs.writeFileSync(path.join(dir, 'lettre.txt'), body);
  const result = collect.collectFolder(dir, { tag: 'letters', since: '2023-01-01' });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.outside_the_window, 1);
});

// --- The command line -------------------------------------------------------

test('applemail refuses to run without the addresses and points at detect', () => {
  const done = spawnSync(process.execPath, [COLLECT, 'applemail', '--tag', 'pro', '--out', 'x.json']);
  assert.strictEqual(done.status, 1);
  assert.match(done.stderr.toString(), /needs --me/);
  assert.match(done.stderr.toString(), /detect/);
});

test('detect takes neither --out nor --me, and writes no corpus anywhere', () => {
  const dir = tree([{ box: 'Sent Messages', name: '1.emlx', message: letter() }]);
  const done = spawnSync(process.execPath, [COLLECT, 'detect', dir]);
  assert.strictEqual(done.status, 0);
  assert.match(done.stdout.toString(), /Apple Mail/);
  assert.doesNotMatch(done.stdout.toString(), /chantier/);
});

test('a window that is not a window stops the run before any mail is read', () => {
  const done = spawnSync(process.execPath,
    [COLLECT, 'applemail', '--me', ME, '--out', 'x.json', '--since', 'last year']);
  assert.strictEqual(done.status, 1);
  assert.match(done.stderr.toString(), /--since takes a date/);
  assert.strictEqual(fs.existsSync('x.json'), false);
});

test('the document names the mail on this machine by its tag, never by a path', () => {
  const dir = tree([{ box: 'Sent Messages', name: '1.emlx', message: letter() }]);
  const out = path.join(sandbox(), 'mail.json');
  const done = spawnSync(process.execPath,
    [COLLECT, 'applemail', dir, '--me', ME, '--tag', 'pro', '--out', out, '--lang', 'fr']);
  assert.strictEqual(done.status, 0, done.stderr.toString());
  const document = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(document.source, 'the mail on this machine tagged pro');
  assert.strictEqual(document.adapter, 'applemail');
  assert.strictEqual(document.lang, 'fr');
  // The summary the caller reads names counts and a path, and never a sample.
  assert.doesNotMatch(done.stdout.toString(), /chantier|Cordialement/);
});
