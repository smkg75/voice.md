'use strict';

// What a real corpus carries besides the writing: the signature a mail client
// appends to every message, a message in another language, the same letter saved
// twice, a model nobody filled in, the address blocks a letter opens on, and the
// identifiers the older masks did not reach.
//
// Every mailbox and every letter below is synthetic, and every address in it is at
// example.com or example.fr, which no one owns.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const collect = require('../scripts/collect.js');

const ME = 'writer@example.com';

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-hygiene-'));
}

function emlx(message) {
  return Buffer.concat([
    Buffer.from(String(Buffer.byteLength(message)) + '\n'),
    Buffer.from(message),
    Buffer.from('<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n'),
  ]);
}

// One Apple Mail tree holding the given bodies, each as a message the user sent.
function mailTree(bodies) {
  const dir = sandbox();
  const directory = path.join(dir, 'V10', 'UUID-1', 'Sent Messages.mbox', 'Data', 'Messages');
  fs.mkdirSync(directory, { recursive: true });
  bodies.forEach((body, index) => {
    const message = [
      'From: The Writer <' + ME + '>',
      'To: Client <client' + index + '@example.fr>',
      'Date: Wed, 4 Mar 2026 10:00:00 +0100',
      'Message-Id: <' + index + '@example.com>',
    ].join('\n') + '\n\n' + body + '\n';
    fs.writeFileSync(path.join(directory, index + '.emlx'), emlx(message));
  });
  return dir;
}

function collectMail(dir, options) {
  return collect.collectAppleMail(dir, Object.assign({ me: [ME], tag: 'pro', lang: 'fr' }, options || {}));
}

// A company block longer than the window splitSignature searches under a sign-off.
const SIGNATURE = [
  '[image: logo] <https://example.com/logo>', 'The Writer', '', 'Direction', '', 'Example SA',
  '01 23 45 67 89', ME, 'example.com', '5 place des Lilas, 75011 Paris', 'Suivez-nous',
  'En savoir plus <https://example.com>', '>',
].join('\n');

function body(index) {
  return 'Bonjour,\n\nLe point ' + index + ' du chantier avance et les travaux durent trois semaines.';
}

// --- The signature a client appends -------------------------------------------

test('a signature repeated under many messages comes off, and the sign-off above it is found', () => {
  const bodies = Array.from({ length: 12 }, (unused, index) => body(index) + '\n\nBien à vous,\n\n' + SIGNATURE);
  const result = collectMail(mailTree(bodies));
  assert.strictEqual(result.counts.kept, 12);
  for (const sample of result.samples) {
    assert.doesNotMatch(sample.text, /En savoir plus|Example SA|logo/);
    assert.strictEqual(sample.signoff, 'Bien à vous,');
    assert.match(sample.signature, /En savoir plus/);
  }
});

test('the signature comes off a reply sent with no sign-off at all', () => {
  const bodies = Array.from({ length: 12 }, (unused, index) => body(index) + '\n\n' + SIGNATURE);
  const result = collectMail(mailTree(bodies));
  for (const sample of result.samples) {
    assert.match(sample.text, /chantier avance/);
    assert.doesNotMatch(sample.text, /En savoir plus/);
  }
});

test('a short line the person ends many messages on is theirs and stays', () => {
  const bodies = Array.from({ length: 12 }, (unused, index) => body(index) + '\n\nMerci !');
  const result = collectMail(mailTree(bodies));
  for (const sample of result.samples) assert.match(sample.text, /Merci !$/);
});

test('a block under too few messages to be a signature is left in the body', () => {
  const bodies = Array.from({ length: 3 }, (unused, index) => body(index) + '\n\n' + SIGNATURE);
  const result = collectMail(mailTree(bodies));
  for (const sample of result.samples) assert.match(sample.text, /Example SA/);
});

// --- Another language -----------------------------------------------------------

test('a message in another language than --lang is counted apart, not measured', () => {
  const english = 'Hello,\n\nThank you for the quote. We will be on site on Monday and the work is going to take '
    + 'three weeks, so please have your team ready for it.';
  const result = collectMail(mailTree([body(1), english]));
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.in_another_language, 1);
});

test('without a language, or in a language with no profile, nothing is counted apart', () => {
  const english = 'We will be on site on Monday and the work is going to take three weeks, so have the team ready.';
  assert.strictEqual(collect.collectAppleMail(mailTree([english]), { me: [ME], tag: 'pro' }).counts.kept, 1);
  assert.strictEqual(collect.inAnotherLanguage(english, 'de'), false);
});

test('a French message with a few English words in it is still French', () => {
  const mixed = 'Je te fais un point sur la roadmap et le pricing avant le call de demain, '
    + 'pour que tu aies le contexte dans le deck.';
  assert.strictEqual(collect.inAnotherLanguage(mixed, 'fr'), false);
});

// --- What a machine wrote ------------------------------------------------------

test('a message that says it was generated automatically is a machine writing', () => {
  assert.ok(collect.writtenByAMachine('This message was automatically generated by the service.', []));
  assert.ok(collect.writtenByAMachine('Ce courriel a été généré automatiquement.', []));
  assert.strictEqual(collect.writtenByAMachine('Le devis a été généré hier soir.', []), false);
});

// --- Masks -------------------------------------------------------------------------

test('a street address is masked, and a street named without a number is prose', () => {
  assert.strictEqual(collect.mask('Envoyez-le au 52 rue des Lilas, 75011 Paris.'), 'Envoyez-le au [address], 75011 Paris.');
  assert.strictEqual(collect.mask('3bis avenue des Marais\n94000 Ville'), '[address]\n94000 Ville');
  assert.strictEqual(collect.mask('La rue est calme le dimanche.'), 'La rue est calme le dimanche.');
});

test('an identifier mixing letters and figures is masked, a short one is a word', () => {
  assert.strictEqual(collect.mask('Le compte 1234567X890 est clos.'), 'Le compte [reference] est clos.');
  assert.strictEqual(collect.mask('Du B2B en V10 avec 2FA.'), 'Du B2B en V10 avec 2FA.');
  assert.ok(collect.COLLECT_MASKS.includes('[address]'));
});

// --- Letters -------------------------------------------------------------------------

const LETTER = [
  'The Writer', '12 rue des Lilas', '75011 Paris', '', 'Client SA', '3 avenue Foch', '75016 Paris', '',
  'Paris, le 4 mars 2026', '', 'Objet : Chantier de la rue des Lilas', '', 'Madame, Monsieur,', '',
  'Le chantier commence lundi et les travaux durent trois semaines. Je vous remercie de laisser',
  "l'accès libre le matin.", '', 'Cordialement,', 'The Writer',
].join('\n');

test('a letter starts at its greeting, and the address blocks above it are gone', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'lettre.txt'), LETTER);
  const sample = collect.collectFolder(dir, { tag: 'letters', lang: 'fr' }).samples[0];
  assert.match(sample.text, /^Madame, Monsieur,/);
  assert.doesNotMatch(sample.text, /Lilas|Foch|Objet/);
  assert.strictEqual(sample.salutation, 'Madame, Monsieur,');
});

test('a letter with no greeting starts under its object line', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'lettre.txt'), LETTER.replace('Madame, Monsieur,\n\n', ''));
  const sample = collect.collectFolder(dir, { tag: 'letters', lang: 'fr' }).samples[0];
  assert.match(sample.text, /^Le chantier commence lundi/);
});

test('the same letter saved twice, with other line breaks, is one letter', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'a-lettre.txt'), LETTER);
  fs.writeFileSync(path.join(dir, 'b-lettre-copie.txt'), LETTER.replace(/\n(?=l'acc)/, ' ').replace(/  +/g, ' '));
  const result = collect.collectFolder(dir, { tag: 'letters', lang: 'fr' });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.filed_twice, 1);
});

test('two different letters are two letters', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'a.txt'), LETTER);
  fs.writeFileSync(path.join(dir, 'b.txt'), LETTER.replace(
    /Le chantier commence[\s\S]*le matin\./,
    'Je conteste la facture du mois dernier, qui compte deux fois la location de la benne.'
  ));
  assert.strictEqual(collect.collectFolder(dir, { tag: 'letters', lang: 'fr' }).counts.kept, 2);
});

test('a model whose fields were never filled in is not a letter anyone sent', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'modele.txt'),
    'Madame, Monsieur,\n\nJe vous adresse ma candidature au poste de <Poste> au sein de <Société>.\n\n'
    + 'Cordialement,\n');
  fs.writeFileSync(path.join(dir, 'formulaire.txt'),
    'Madame, Monsieur,\n\nNom : ..........\nAdresse : ..........\n\nCordialement,\n');
  const result = collect.collectFolder(dir, { tag: 'letters', lang: 'fr' });
  assert.strictEqual(result.counts.kept, 0);
  assert.strictEqual(result.counts.dropped.a_blank_template, 2);
});

test('a letter addressed to the author and signed by someone else is not theirs', () => {
  // --author used to find the name anywhere, and the recipient block of every
  // letter the author received carries it.
  const dir = sandbox();
  const body = Array.from({ length: 8 }, (unused, index) => 'Le point ' + index + ' du dossier reste ouvert ce mois.');
  fs.writeFileSync(path.join(dir, 'recue.txt'), ['The Writer', '12 rue des Lilas', '75011 Paris', '',
    'Monsieur,', ''].concat(body, ['', 'Cordialement,', 'Le service client', 'Example SA']).join('\n'));
  fs.writeFileSync(path.join(dir, 'envoyee.txt'), ['Madame,', ''].concat(body.slice(0, 3),
    ['', 'Cordialement,', 'The Writer']).join('\n'));
  const result = collect.collectFolder(dir, { tag: 'letters', author: ['the writer'], lang: 'fr' });
  assert.strictEqual(result.counts.kept, 1);
  assert.strictEqual(result.counts.dropped.not_from_the_user, 1);
  assert.strictEqual(result.samples[0].source, 'envoyee.txt');
});

test('a run named for one channel measures every sample on it, long or short', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'court.txt'), 'Le chantier commence lundi et nous sommes prêts.');
  fs.writeFileSync(path.join(dir, 'long.txt'), LETTER);
  const result = collect.collectFolder(dir, { tag: 'linkedin', lang: 'fr', surface: 'post' });
  assert.deepStrictEqual(result.samples.map((sample) => sample.surface), ['post', 'post']);
  assert.strictEqual(collect.parseArgs(['folder', dir, '--surface', 'post']).surface, 'post');
  assert.deepStrictEqual(collect.parseArgs(['folder', dir, '--surface', 'post']).unknown, []);
});

test('a letter in another language is counted apart like a message', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'cover.txt'),
    'Dear Hiring Manager,\n\nI am applying for the role because I build this work today, and I would like to '
    + 'bring it to your team with the experience that I have.\n\nSincerely,\nThe Writer\n');
  const result = collect.collectFolder(dir, { tag: 'letters', lang: 'fr' });
  assert.strictEqual(result.counts.kept, 0);
  assert.strictEqual(result.counts.dropped.in_another_language, 1);
});
