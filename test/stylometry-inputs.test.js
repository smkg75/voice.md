'use strict';

// Three things the setup cannot do without, all of them about what reaches one
// measurement and in what order.
//
//   1. Several inputs. The setup asks for at least one professional mailbox and
//      one personal one, plus a folder of letters the person corrected. Each one
//      is a separate run of collect.js, so a pass that reads one file and drops
//      the rest can never measure what the setup collected. Dropping an input in
//      silence is the defect: this file holds the sum.
//   2. A reviewed letter is preferred at comparable length. Extracts are chosen
//      by closeness to the median length of their group, and inside a tenth of
//      that median a letter from the reviewed folder is picked before a sent
//      mail, because it is the one the person actually approved. Further out it
//      is not picked at all: preferred, not first.
//   3. The register table. The register collect.js guesses from a recipient
//      domain is a guess; the table is the person's answer, read as data and
//      applied before anything is measured.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { analyse } = require('../scripts/stylometry.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'stylometry.js');

// A body of exactly `size` words, with no greeting and no closing to cut: one
// paragraph, one line, too long to read as either.
function body(size) {
  return Array.from({ length: size }, () => 'mot').join(' ');
}

function letter(size, extra) {
  return Object.assign({ text: body(size), register: 'test', surface: 'email' }, extra || {});
}

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voicemd-inputs-'));
}

function fileIn(dir, name, payload) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return full;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

const PRO = {
  tool: 'voice.md collect',
  lang: 'fr',
  adapter: 'mbox',
  tag: 'pro',
  source: 'one mailbox tagged pro',
  samples: [
    { id: 'pro-0001', text: 'Bonjour,\n\nLe devis est parti hier.\n\nCordialement',
      mailbox: 'pro', adapter: 'mbox', recipient_domain: 'exemple.fr', surface: 'email', register: 'professional' },
    { id: 'pro-0002', text: 'Bonjour,\n\nLa facture suit demain.\n\nCordialement',
      mailbox: 'pro', adapter: 'mbox', recipient_domain: 'impots.gouv.fr', surface: 'email', register: 'professional' },
  ],
};

const PERSO = {
  tool: 'voice.md collect',
  lang: 'fr',
  adapter: 'mbox',
  tag: 'perso',
  source: 'one mailbox tagged perso',
  samples: [
    { id: 'perso-0001', text: 'Salut,\n\nTu passes ce soir ?\n\nBises',
      mailbox: 'perso', adapter: 'mbox', recipient_domain: 'exemple.net', surface: 'message', register: 'personal' },
  ],
};

const LETTERS = {
  tool: 'voice.md collect',
  lang: 'fr',
  adapter: 'folder',
  tag: 'lettres',
  source: 'one folder tagged lettres',
  samples: [
    { id: 'lettres-0001', text: 'Madame, Monsieur,\n\nJe vous confirme les termes de notre echange.\n\nCordialement',
      mailbox: 'lettres', adapter: 'folder', recipient_domain: null, surface: 'letter', register: 'administrative' },
  ],
};

// --- Several inputs, aggregated -------------------------------------------

test('several input documents reach one measurement, every sample counted once', () => {
  const { analysis } = analyse([PRO, PERSO, LETTERS]);
  assert.strictEqual(analysis.corpus.samples, 4);
});

test('each sample keeps the mailbox tag collect gave it', () => {
  const { analysis } = analyse([PRO, PERSO, LETTERS]);
  assert.deepStrictEqual(analysis.corpus.by_mailbox, { pro: 2, perso: 1, lettres: 1 });
});

test('the corpus block counts per source, so a provenance line can name each one', () => {
  const { analysis } = analyse([PRO, PERSO, LETTERS]);
  assert.deepStrictEqual(analysis.corpus.by_source, [
    { source: 'one mailbox tagged pro', mailbox: 'pro', adapter: 'mbox', reviewed: false, samples: 2 },
    { source: 'one mailbox tagged perso', mailbox: 'perso', adapter: 'mbox', reviewed: false, samples: 1 },
    { source: 'one folder tagged lettres', mailbox: 'lettres', adapter: 'folder', reviewed: true, samples: 1 },
  ]);
});

test('the reviewed folder is a source of its own, named as reviewed', () => {
  const { analysis } = analyse([PRO, LETTERS]);
  const reviewed = analysis.corpus.by_source.filter((entry) => entry.reviewed);
  assert.strictEqual(reviewed.length, 1);
  assert.strictEqual(reviewed[0].source, 'one folder tagged lettres');
  assert.strictEqual(reviewed[0].samples, 1);
});

test('an input that contributed nothing is still listed, at zero', () => {
  const empty = { source: 'one mailbox tagged archive', tag: 'archive', adapter: 'mbox', samples: [{ text: '   ' }] };
  const { analysis } = analyse([PRO, empty]);
  assert.deepStrictEqual(
    analysis.corpus.by_source.map((entry) => [entry.source, entry.samples]),
    [['one mailbox tagged pro', 2], ['one mailbox tagged archive', 0]]
  );
});

test('a document declares the adapter and the tag its samples do not carry', () => {
  const folder = { source: 'a folder', tag: 'lettres', adapter: 'folder', samples: [{ text: body(12) }] };
  const { analysis } = analyse([folder]);
  assert.deepStrictEqual(analysis.corpus.by_source, [
    { source: 'a folder', mailbox: 'lettres', adapter: 'folder', reviewed: true, samples: 1 },
  ]);
  assert.deepStrictEqual(analysis.corpus.by_mailbox, { lettres: 1 });
});

test('one document alone still reads, and a bare array of samples too', () => {
  assert.strictEqual(analyse(PRO).analysis.corpus.samples, 2);
  assert.strictEqual(analyse(PRO.samples).analysis.corpus.samples, 2);
  assert.strictEqual(analyse({ lang: 'fr', samples: PRO.samples }).analysis.corpus.samples, 2);
});

test('the provenance names every source it read', () => {
  const { analysis } = analyse([PRO, PERSO, LETTERS]);
  assert.strictEqual(
    analysis.corpus.source,
    'one mailbox tagged pro, one mailbox tagged perso, one folder tagged lettres'
  );
});

test('the language of the first document that declares one measures them all', () => {
  const { analysis } = analyse([{ samples: PRO.samples }, PERSO]);
  assert.strictEqual(analysis.corpus.lang, 'fr');
  assert.strictEqual(analysis.corpus.lang_source, 'declared');
});

// --- The command line reads every file it is given -------------------------

test('two samples files on the command line are both read', () => {
  const dir = sandbox();
  const pro = fileIn(dir, 'pro.json', PRO);
  const perso = fileIn(dir, 'perso.json', PERSO);
  const out = path.join(dir, 'report');

  const result = run([pro, perso, '--out', out]);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 samples, \d+ words, lang fr/);

  const analysis = JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8'));
  assert.strictEqual(analysis.corpus.samples, 3);
  assert.strictEqual(analysis.corpus.by_source.length, 2);
});

test('a second file that cannot be read is refused rather than skipped', () => {
  const dir = sandbox();
  const pro = fileIn(dir, 'pro.json', PRO);
  const broken = fileIn(dir, 'broken.json', 'not json at all');

  const result = run([pro, broken, '--out', path.join(dir, 'report')]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /broken\.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'report', 'analysis.json')));
});

test('inputs that disagree on the language say so and are measured as the first', () => {
  const dir = sandbox();
  const fr = fileIn(dir, 'fr.json', PRO);
  const en = fileIn(dir, 'en.json', { lang: 'en', source: 'an english mailbox', samples: [{ text: body(14) }] });

  const result = run([fr, en, '--out', path.join(dir, 'report')]);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /more than one language/);
  const analysis = JSON.parse(fs.readFileSync(path.join(dir, 'report', 'analysis.json'), 'utf8'));
  assert.strictEqual(analysis.corpus.lang, 'fr');
});

// --- A reviewed letter is preferred at comparable length --------------------
//
// Six messages in one group, bodies of 20, 20, 21, 21 and 22 words from a
// mailbox and one of 23 words from the reviewed folder. The median is 21, so
// without the rule the five closest are 21, 21, 22, 20, 20 and the reviewed
// letter, two words further out, is the one dropped.

function mixedGroup(reviewedSize) {
  return [
    letter(21, { id: 'a', adapter: 'mbox' }),
    letter(21, { id: 'b', adapter: 'mbox' }),
    letter(20, { id: 'c', adapter: 'mbox' }),
    letter(20, { id: 'd', adapter: 'mbox' }),
    letter(22, { id: 'e', adapter: 'mbox' }),
    letter(reviewedSize, { id: 'f', adapter: 'folder' }),
  ];
}

function bodiesQuoted(exemplars) {
  return [...exemplars.matchAll(/Body (\d+) words/g)].map((match) => Number(match[1]));
}

test('at comparable length the reviewed letter is quoted before a sent mail', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', samples: mixedGroup(23) });
  assert.strictEqual(analysis.registers[0].words.median, 21);
  // Register then surface, the same five each time, the reviewed letter first.
  assert.deepStrictEqual(bodiesQuoted(exemplars), [23, 21, 21, 22, 20, 23, 21, 21, 22, 20]);
});

// The promise made to the subject is that their reviewed letters are quoted, so
// a group holding one quotes one whatever its length: the guaranteed place goes
// to the reviewed letter nearest the median. What length buys is the ranking of
// the four other places, and there a letter outside the middle half of its group
// buys nothing.
test('a group holding a reviewed letter quotes it, however far from the median it sits', () => {
  const { exemplars } = analyse({ lang: 'fr', samples: mixedGroup(40) });
  const quoted = bodiesQuoted(exemplars);
  assert.strictEqual(quoted[0], 40, 'the guaranteed place');
  assert.deepStrictEqual(quoted, [40, 21, 21, 22, 20, 40, 21, 21, 22, 20]);
  assert.match(exemplars, /reviewed\. Body 40 words/);
});

test('outside the middle half a reviewed letter buys no rank beyond its guaranteed place', () => {
  // Two reviewed letters: one at the median, one far out. The near one takes the
  // guaranteed place and the far one falls back among the sent mail.
  const samples = mixedGroup(21).concat(mixedGroup(60).filter((sample) => sample.adapter === 'folder'));
  const quoted = bodiesQuoted(analyse({ lang: 'fr', samples }).exemplars);
  assert.strictEqual(quoted[0], 21, 'the reviewed letter nearest the median');
  assert.ok(!quoted.slice(1, 5).includes(60), 'the far reviewed letter wins no rank');
});

test('the extract says which ones were reviewed', () => {
  const { exemplars } = analyse({ lang: 'fr', samples: mixedGroup(23) });
  assert.match(exemplars, /Body 23 words/);
  assert.match(exemplars, /reviewed\. Body 23 words/);
  assert.doesNotMatch(exemplars, /reviewed\. Body 21 words/);
});

// --- The register assignment table -----------------------------------------
//
// The format is the one skills/setup/SKILL.md hands the subject: a flat JSON map
// from a recipient pattern or a sample id to a register name.

const TABLE = {
  '*.gouv.fr': 'administrative',
  'perso-0001': 'family',
  'jamais.example': 'nowhere',
};

test('a rule on the recipient domain overrides the guess', () => {
  const { analysis } = analyse([PRO, PERSO], { registers: TABLE });
  assert.deepStrictEqual(analysis.corpus.registers.slice().sort(), ['administrative', 'family', 'professional']);
});

test('a sample no rule matches keeps the register collect guessed', () => {
  const { analysis } = analyse([PRO], { registers: TABLE });
  const professional = analysis.registers.find((entry) => entry.key === 'professional');
  assert.strictEqual(professional.messages, 1);
});

test('every rule reports how many samples it matched, so a dead rule is visible', () => {
  const { analysis } = analyse([PRO, PERSO], { registers: TABLE });
  assert.deepStrictEqual(analysis.corpus.register_table, {
    rules: [
      { pattern: '*.gouv.fr', on: 'domain', register: 'administrative', samples: 1 },
      { pattern: 'perso-0001', on: 'id', register: 'family', samples: 1 },
      { pattern: 'jamais.example', on: 'domain', register: 'nowhere', samples: 0 },
    ],
    samples_assigned: 2,
    samples_kept_their_guess: 1,
  });
});

test('with no table the corpus block says there was none', () => {
  assert.strictEqual(analyse([PRO]).analysis.corpus.register_table, null);
});

test('a wildcard domain matches the domain itself and any subdomain of it', () => {
  const samples = [
    { id: '1', text: body(12), recipient_domain: 'gouv.fr', register: 'professional' },
    { id: '2', text: body(12), recipient_domain: 'impots.gouv.fr', register: 'professional' },
    { id: '3', text: body(12), recipient_domain: 'pasgouv.fr', register: 'professional' },
  ];
  const { analysis } = analyse({ lang: 'fr', samples }, { registers: { '*.gouv.fr': 'administrative' } });
  assert.strictEqual(analysis.corpus.register_table.rules[0].samples, 2);
  assert.strictEqual(analysis.corpus.register_table.samples_kept_their_guess, 1);
});

test('the first rule that matches wins, and the table is read in its own order', () => {
  const samples = [{ id: 'x', text: body(12), recipient_domain: 'impots.gouv.fr', register: 'professional' }];
  const { analysis } = analyse({ lang: 'fr', samples },
    { registers: { 'impots.gouv.fr': 'tax', '*.gouv.fr': 'administrative' } });
  assert.deepStrictEqual(analysis.corpus.registers, ['tax']);
});

test('a key with no dot and no star is read as a sample id', () => {
  const { analysis } = analyse([PRO, PERSO], { registers: { 'pro-0002': 'tax' } });
  assert.deepStrictEqual(analysis.corpus.register_table.rules, [
    { pattern: 'pro-0002', on: 'id', register: 'tax', samples: 1 },
  ]);
  const tax = analysis.registers.find((entry) => entry.key === 'tax');
  assert.strictEqual(tax.messages, 1);
});

test('the table is applied before anything is measured', () => {
  // The share of the corpus and the median of the group are figured on the
  // groups the table made, not on the ones collect.js guessed.
  const samples = [
    { id: '1', text: body(10), recipient_domain: 'impots.gouv.fr', register: 'professional' },
    { id: '2', text: body(30), recipient_domain: 'exemple.fr', register: 'professional' },
  ];
  const { analysis } = analyse({ lang: 'fr', samples }, { registers: { '*.gouv.fr': 'administrative' } });
  const administrative = analysis.registers.find((entry) => entry.key === 'administrative');
  assert.strictEqual(administrative.messages, 1);
  assert.strictEqual(administrative.words.median, 10);
  assert.strictEqual(administrative.share_of_corpus_pct, 50);
});

test('an entry that names no register, and a table that is not one, are refused', () => {
  assert.throws(() => analyse([PRO], { registers: { 'exemple.fr': 42 } }), /register/);
  assert.throws(() => analyse([PRO], { registers: { '': 'administrative' } }), /register table/);
  assert.throws(() => analyse([PRO], { registers: 'exemple.fr' }), /register table/);
});

test('--registers reads the table and the corpus block reports it', () => {
  const dir = sandbox();
  const pro = fileIn(dir, 'pro.json', PRO);
  const table = fileIn(dir, 'registers.json', TABLE);
  const out = path.join(dir, 'report');

  const result = run([pro, '--registers', table, '--out', out]);
  assert.strictEqual(result.status, 0, result.stderr);

  const analysis = JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8'));
  assert.strictEqual(analysis.corpus.register_table.rules.length, 3);
  assert.strictEqual(analysis.corpus.register_table.samples_assigned, 1);
});

test('a table that cannot be read is refused, and nothing is written', () => {
  const dir = sandbox();
  const pro = fileIn(dir, 'pro.json', PRO);
  const table = fileIn(dir, 'registers.json', 'not json at all');
  const result = run([pro, '--registers', table, '--out', path.join(dir, 'report')]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /registers\.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'report', 'analysis.json')));
});

test('a table with an entry the format refuses is one line on the error channel', () => {
  const dir = sandbox();
  const pro = fileIn(dir, 'pro.json', PRO);
  const table = fileIn(dir, 'registers.json', { 'exemple.fr': 42 });
  const result = run([pro, '--registers', table, '--out', path.join(dir, 'report')]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /register/);
  assert.doesNotMatch(result.stderr, /at Object|node:internal/);
});

test('the method says what the table did and what a reviewed letter buys', () => {
  const { analysis } = analyse([PRO, LETTERS], { registers: TABLE });
  assert.ok(analysis.method.registers_assigned.includes('register_table'));
  assert.ok(analysis.method.weights.includes('reviewed'));
});

// --- One placeholder vocabulary across the two scripts ----------------------
//
// collect.js masks before stylometry.js ever sees a sample, and it writes its
// own placeholders. A placeholder stylometry does not recognise is read as a
// word the person wrote: it joins the run of tokens rather than cutting it, it
// reaches the n-grams as a characteristic turn of phrase, and maskNames reads
// the word inside it and masks it again. This runs the two scripts end to end
// over letters carrying a telephone number, a case reference and an amount,
// which is the ordinary shape of a mailbox and not an exotic one.

const { collectFolder, COLLECT_MASKS } = require('../scripts/collect.js');
const { PROFILES } = require('../scripts/stylometry.js');

function maskVocabulary() {
  const all = [...COLLECT_MASKS, ...Object.values(PROFILES.fr.masks), ...Object.values(PROFILES.en.masks)];
  return new Set(all.map((mask) => mask.replace(/[[\]]/g, '')));
}

const MASKED_LETTER = [
  'Bonjour,',
  '',
  'Le devis part demain matin et la commande suit dans la foulee.',
  'Vous pouvez me joindre au 06 12 34 56 78 si besoin avant lundi.',
  'Le dossier 2024-117 avance bien de son cote depuis la semaine derniere.',
  'Le montant de 1 200 euros reste ferme jusqu au quinze du mois prochain.',
  '',
  'Cordialement',
].join('\n');

function maskedFolder() {
  const dir = sandbox();
  for (let index = 0; index < 8; index += 1) {
    fileIn(dir, 'lettre-' + index + '.txt', MASKED_LETTER);
  }
  return collectFolder(dir, { tag: 'letters' });
}

function allNgrams(analysis) {
  const blocks = [analysis.overall, ...analysis.registers, ...analysis.surfaces];
  return blocks.flatMap((block) => [...block.ngrams.bigrams, ...block.ngrams.trigrams])
    .map((entry) => entry.ngram);
}

test('a placeholder collect wrote is never read as a word the person wrote', () => {
  const collected = maskedFolder();
  assert.strictEqual(collected.counts.kept, 8);
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'eight letters', samples: collected.samples });

  // maskNames read inside a placeholder it did not know: [phone] came back as
  // [[nom]], which no reader can undo.
  assert.doesNotMatch(exemplars, /\[\[|\]\]/, 'a placeholder was masked a second time');
  assert.doesNotMatch(JSON.stringify(analysis), /\[\[|\]\]/, 'a placeholder was masked a second time');

  // The placeholder is not a habit, whichever script wrote it.
  const vocabulary = maskVocabulary();
  for (const ngram of allNgrams(analysis)) {
    for (const word of ngram.split(/[ ']/).filter(Boolean)) {
      assert.ok(!vocabulary.has(word), 'the mask ' + word + ' reached the n-gram ' + ngram);
    }
  }

  // And the run is cut at the mask, so the two words that stood on either side
  // of the telephone number never meet inside one n-gram.
  for (const ngram of allNgrams(analysis)) {
    assert.ok(!(/\bjoindre\b/.test(ngram) && /\bbesoin\b/.test(ngram)), ngram + ' jumped over a mask');
  }
});

// --- What the file says about itself against what it carries ----------------
//
// The reading note used to say, in the file the model reads, that nothing in it
// records who was written to. The register table is echoed into that same file,
// entry by entry, so that an entry matching nothing is visible rather than
// silent, and an entry is either a sample id or a recipient domain. A law firm's
// domain names a correspondent as squarely as a surname does.

test('the file does not deny recording a recipient while echoing one', () => {
  const { analysis } = analyse([PRO], { registers: { 'cabinet.example.org': 'legal' } });
  const rules = analysis.corpus.register_table.rules;

  // The echo itself, held to something real rather than to a fear.
  assert.deepStrictEqual(rules, [{ pattern: 'cabinet.example.org', on: 'domain', register: 'legal', samples: 0 }]);

  const shipped = JSON.stringify(analysis);
  assert.doesNotMatch(shipped, /Nothing in this file records who was written to/,
    'the file denies what its own register_table carries');
  // And it says where the one recipient it does carry stands.
  assert.match(shipped, /register_table/);
  assert.match(analysis.reading_notes.registers_are_relational, /register_table/);
  assert.ok(analysis.method.limits.some((limit) => /register_table/.test(limit)),
    'the limits do not name the one place a recipient is written down');
});
