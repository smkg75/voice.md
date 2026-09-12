'use strict';

// The measurement block, held to four short French messages counted by hand.
// The whole derivation is written out below, so that every expectation in this
// file can be checked against the fixture rather than against the code.
//
// The greeting line and the closing paragraph are measured on their own and left
// out of the body, which is what every other number here is about.
//
//   1. body "Le devis est parti hier. Je relance le fournisseur demain."
//      10 words, 2 sentences of 5 and 5, 1 paragraph of 10.
//   2. body "Trois points ce matin :" + the three list items + "Je m'en occupe
//      aujourd'hui. Rien d'autre ?"
//      19 words (4 + 6 + 9, the elisions counting as m' en, aujourd' hui,
//      d' autre), 6 sentences of 4, 2, 2, 2, 6 and 3, 3 paragraphs of 4, 6, 9.
//   3. body "Tu passes ce soir ? Je rentre tard !"
//      7 words, 2 sentences of 4 and 3, 1 paragraph of 7.
//   4. body "On a bien recu ton message. Je te rappelle demain matin, promis !"
//      12 words, 2 sentences of 6 and 6, 1 paragraph of 12.
//
//   words:      10 + 19 + 7 + 12 = 48. Sorted 7, 10, 12, 19: median 11, mean 12,
//               first quartile 7 + 3 * 0.75 = 9.25, third 12 + 7 * 0.25 = 13.75.
//   sentences:  2 + 6 + 2 + 2 = 12, and their lengths sum to 48 as well.
//               Sorted: 2,2,2,3,3,4,4,5,5,6,6,6. Median 4, mean 4, ninth decile
//               at position 11 * 0.9 = 9.9, which lands on 6. All under 11 words.
//   paragraphs: 1, 3, 1, 1 per message, median 1. Lengths 10, 4, 6, 9, 7, 12,
//               sorted 4, 6, 7, 9, 10, 12: median 8.
//   tu / vous:  "Tu" in the third, "ton" and "te" in the fourth. Two messages
//               familiar, none formal, two with no marker. 3 / 48 * 1000 = 62.5.
//   marks:      two exclamation marks and two question marks in the four bodies:
//               2 / 48 * 1000 = 41.67, 2 / 12 * 100 = 16.7, half the messages.
//   commas:     one, in the fourth body. One colon, in the second. 1 / 48 * 1000.
//   je:         all four bodies open a sentence on "Je": 4 / 48 * 1000 = 83.33.

const test = require('node:test');
const assert = require('node:assert');

const { analyse, prepare, measure, profileFor, NGRAM_LIMIT } = require('../scripts/stylometry.js');
const { COLLECT_MASKS } = require('../scripts/collect.js');

const SAMPLES = [
  {
    text: 'Bonjour,\n\nLe devis est parti hier. Je relance le fournisseur demain.\n\nCordialement',
    mailbox: 'pro', date: '2026-03-04', recipient_domain: 'exemple.fr', surface: 'email', register: 'professional',
  },
  {
    text: 'Bonjour,\n\nTrois points ce matin :\n\n1. le devis\n2. la relance\n3. la facture\n\n'
      + "Je m'en occupe aujourd'hui. Rien d'autre ?\n\nCordialement",
    mailbox: 'pro', date: '2026-03-06', recipient_domain: 'exemple.fr', surface: 'email', register: 'professional',
  },
  {
    text: 'Salut,\n\nTu passes ce soir ? Je rentre tard !\n\nBises',
    mailbox: 'perso', date: '2026-03-07', recipient_domain: 'exemple.net', surface: 'message', register: 'personal',
  },
  {
    text: 'Coucou,\n\nOn a bien reçu ton message. Je te rappelle demain matin, promis !\n\nBises',
    mailbox: 'perso', date: '2026-03-08', recipient_domain: 'exemple.net', surface: 'email', register: 'personal',
  },
];

const { analysis, exemplars } = analyse({ lang: 'fr', source: 'two mailboxes', samples: SAMPLES });
const overall = analysis.overall;

test('the corpus block says what was read and where it came from', () => {
  assert.deepStrictEqual(analysis.corpus, {
    lang: 'fr',
    lang_source: 'declared',
    profile: 'fr',
    source: 'two mailboxes',
    samples: 4,
    words_measured: 48,
    date_range: '2026-03-04 to 2026-03-08',
    by_mailbox: { pro: 2, perso: 2 },
    // One input document, holding both mailbox tags: the count per source is the
    // count of that document, and the tag it agrees on is none.
    by_source: [{ source: 'two mailboxes', mailbox: null, adapter: null, reviewed: false, samples: 4 }],
    recipient_domains: 2,
    surfaces: ['email', 'message'],
    registers: ['personal', 'professional'],
    register_table: null,
  });
});

test('the length of a message is the length of its body', () => {
  assert.deepStrictEqual(overall.words, {
    total: 48, median: 11, mean: 12, p25: 9.25, p75: 13.75, min: 7, max: 19,
  });
});

test('the distribution of sentence length is counted over every sentence', () => {
  assert.strictEqual(overall.sentences.total, 12);
  assert.strictEqual(overall.sentences.median_per_message, 2);
  assert.strictEqual(overall.sentences.median_words, 4);
  assert.strictEqual(overall.sentences.mean_words, 4);
  assert.strictEqual(overall.sentences.p90_words, 6);
  assert.strictEqual(overall.sentences.max_words, 6);
  assert.deepStrictEqual(overall.sentences.distribution_pct, {
    '<=10': 100, '11-20': 0, '21-30': 0, '31-45': 0, '>45': 0,
  });
});

test('paragraphs are counted per message and by length', () => {
  assert.deepStrictEqual(overall.paragraphs, { median_per_message: 1, median_words: 8 });
});

test('the familiar and the formal second person are counted per message and per token', () => {
  assert.deepStrictEqual(overall.second_person, {
    familiar_messages: 2,
    formal_messages: 0,
    mixed_messages: 0,
    no_marker_messages: 2,
    familiar_pct: 50,
    familiar_tokens_per_1000_words: 62.5,
    formal_tokens_per_1000_words: 0,
  });
});

test('a language with no familiar and formal second person says so', () => {
  const english = analyse({ lang: 'en', samples: [{ text: 'Hi,\n\nI sent it over.\n\nBest' }] });
  assert.strictEqual(english.analysis.overall.second_person.applicable, false);
});

test('salutations are counted as forms, with the name masked out', () => {
  assert.deepStrictEqual(overall.opening, {
    salutation_line_pct: 100,
    no_salutation_pct: 0,
    top_salutations: [
      { form: 'Bonjour,', count: 2 },
      { form: 'Coucou,', count: 1 },
      { form: 'Salut,', count: 1 },
    ],
  });
});

test('sign-offs are counted verbatim and by family', () => {
  assert.strictEqual(overall.closing.sign_off_pct, 100);
  assert.deepStrictEqual(overall.closing.top_verbatim, [
    { form: 'Bises', count: 2 },
    { form: 'Cordialement', count: 2 },
  ]);
  assert.deepStrictEqual(overall.closing.families, [
    { family: 'bises / bisous', messages: 2, pct: 50 },
    { family: 'cordialement', messages: 2, pct: 50 },
  ]);
});

test('exclamation marks and questions are reported per word and per sentence', () => {
  assert.deepStrictEqual(overall.exclamation, {
    marks_per_1000_words: 41.67,
    marks_per_100_sentences: 16.7,
    messages_with_any_pct: 50,
    messages_with_doubled_marks: 0,
  });
  assert.deepStrictEqual(overall.question, {
    marks_per_1000_words: 41.67,
    marks_per_100_sentences: 16.7,
    messages_with_any_pct: 50,
  });
});

test('a numbered run counts as a list, once per message', () => {
  assert.deepStrictEqual(overall.lists, { messages_with_list: 1, pct: 25 });
});

test('an emoji is counted when there is one, and reported as zero when there is not', () => {
  assert.deepStrictEqual(overall.emoji, { per_1000_words: 0, messages_with_any_pct: 0, top: [] });
  const withEmoji = analyse({
    lang: 'fr',
    samples: [{ text: 'Salut,\n\nOn se voit demain \u{1f642}\n\nBises' }],
  });
  assert.deepStrictEqual(withEmoji.analysis.overall.emoji.top, [{ emoji: '\u{1f642}', count: 1 }]);
  assert.strictEqual(withEmoji.analysis.overall.emoji.messages_with_any_pct, 100);
});

test('punctuation is a rate over the body, not over the greeting', () => {
  assert.deepStrictEqual(overall.punctuation_per_1000_words, {
    comma: 20.83, semicolon: 0, colon: 20.83, parenthesis: 0, quotation: 0,
  });
});

test('a tic is reported with its count, its rate and the share of messages carrying it', () => {
  assert.deepStrictEqual(overall.tics_per_1000_words, [
    { tic: 'je en tete de phrase', count: 4, per_1000_words: 83.33, messages_pct: 100 },
  ]);
});

test('nothing is characteristic in a corpus this small', () => {
  assert.deepStrictEqual(overall.ngrams, { bigrams: [], trigrams: [] });
});

test('an English contraction is a tic of its own, which French never reports', () => {
  const english = analyse({
    lang: 'en',
    samples: [{ text: "Hi,\n\nI don't have the numbers yet. I'll send them tomorrow.\n\nBest" }],
  });
  const tics = english.analysis.overall.tics_per_1000_words;
  const contraction = tics.find((tic) => tic.tic === 'contraction');
  assert.strictEqual(contraction.count, 2, "n't and 'll");
  assert.ok(!overall.tics_per_1000_words.some((tic) => tic.tic === 'contraction'));
});

// --- Registers and surfaces -----------------------------------------------

test('every register and every surface is measured on its own', () => {
  assert.deepStrictEqual(
    analysis.registers.map((register) => [register.key, register.messages, register.share_of_corpus_pct]),
    [['personal', 2, 50], ['professional', 2, 50]]
  );
  assert.deepStrictEqual(
    analysis.surfaces.map((surface) => [surface.key, surface.messages]),
    [['email', 3], ['message', 1]]
  );
});

test('a register carries the numbers of its own messages', () => {
  const personal = analysis.registers.find((register) => register.key === 'personal');
  // The third and the fourth bodies: 7 and 12 words, both familiar.
  assert.strictEqual(personal.words.total, 19);
  assert.strictEqual(personal.second_person.familiar_messages, 2);
  const professional = analysis.registers.find((register) => register.key === 'professional');
  assert.strictEqual(professional.words.total, 29);
  assert.strictEqual(professional.second_person.familiar_messages, 0);
});

test('a sample with no register and no surface is filed as unclassified', () => {
  const loose = analyse({ lang: 'fr', samples: [{ text: 'Bonjour,\n\nLe devis est parti.\n\nCordialement' }] });
  assert.deepStrictEqual(loose.analysis.corpus.registers, ['unclassified']);
  assert.deepStrictEqual(loose.analysis.corpus.surfaces, ['unclassified']);
});

test('a bare array of samples is read as a collection of samples', () => {
  const bare = analyse(SAMPLES, { lang: 'fr' });
  assert.strictEqual(bare.analysis.corpus.samples, 4);
  assert.strictEqual(bare.analysis.corpus.words_measured, 48);
});

// --- Typography, kept apart -----------------------------------------------

test('the typography of the samples is counted, and changes no other number', () => {
  const curly = [{ text: 'Bonjour,\n\nJe m\u2019en occupe aujourd\u2019hui.\n\nCordialement' }];
  const straight = [{ text: "Bonjour,\n\nJe m'en occupe aujourd'hui.\n\nCordialement" }];
  const one = analyse({ lang: 'fr', samples: curly }).analysis;
  const two = analyse({ lang: 'fr', samples: straight }).analysis;

  assert.strictEqual(one.typographic_base.characters_normalised_total, 2);
  assert.strictEqual(two.typographic_base.characters_normalised_total, 0);
  assert.deepStrictEqual(one.overall.words, two.overall.words);
  assert.deepStrictEqual(one.overall.sentences, two.overall.sentences);
});

// --- Exemplars ------------------------------------------------------------

test('an extract keeps the greeting and the closing the body count leaves out', () => {
  assert.match(exemplars, /> Bonjour,/);
  assert.match(exemplars, /> Cordialement/);
  assert.match(exemplars, /Body 10 words; extract 12 words/);
});

test('each group gets its own section, and a group of one says so', () => {
  assert.match(exemplars, /## Register: professional/);
  assert.match(exemplars, /## Surface: message/);
  assert.match(exemplars, /1 message\. Median 7 words\./);
});

test('an extract carries no character the typography table rewrites', () => {
  const curly = analyse({
    lang: 'fr',
    samples: [{ text: 'Bonjour,\n\nJe m\u2019en occupe \u2014 aujourd\u2019hui\u2026\n\nCordialement' }],
  });
  assert.doesNotMatch(curly.exemplars, /[\u2019\u2014\u2026]/);
  assert.match(curly.exemplars, /Je m'en occupe - aujourd'hui\.\.\./);
});

test('at most five extracts per group, taken at the median length of the group', () => {
  const many = [];
  // Seven messages of 1, 2, 3, 4, 5, 6 and 7 body words. The median is 4, so the
  // five closest to it are the bodies of 2, 3, 4, 5 and 6 words, and a tie in
  // distance goes to the longer of the two: 4, then 5, 3, 6, 2.
  for (let size = 1; size <= 7; size += 1) {
    many.push({
      text: 'Bonjour,\n\n' + Array.from({ length: size }, () => 'mot').join(' ') + '.\n\nCordialement',
      register: 'test',
      surface: 'email',
    });
  }
  const { analysis: built, exemplars: written } = analyse({ lang: 'fr', samples: many });
  assert.strictEqual(built.registers[0].words.median, 4);
  const bodies = [...written.matchAll(/Body (\d+) words/g)].map((match) => Number(match[1]));
  // Once for the register and once for the surface, the same five each time.
  assert.deepStrictEqual(bodies, [4, 5, 3, 6, 2, 4, 5, 3, 6, 2]);
});

test('a sample with no text at all is not measured', () => {
  const { analysis: built } = analyse({ lang: 'fr', samples: [...SAMPLES, { text: '   ' }, {}, null] });
  assert.strictEqual(built.corpus.samples, 4);
});

test('the method and the limits travel with the numbers', () => {
  assert.ok(analysis.method.words.includes('French'));
  assert.ok(analysis.method.typography.includes('typographic_base'));
  assert.ok(analysis.method.limits.length >= 3);
  assert.ok(analysis.reading_notes.voice_flag.includes('voice: on'));
});

// --- Names in the two files that reach the model ---------------------------

test('a correspondent named in a greeting, a body or a signature reaches neither file', () => {
  const samples = [];
  for (let index = 0; index < 10; index += 1) {
    samples.push({
      text: [
        'Cher Louis Bouilhet,', '',
        'Je confirme que la livraison convenue avec Louis Dupont tient toujours, et que',
        'le chantier de la semaine prochaine commence lundi comme prevu ensemble.', '',
        'Bien cordialement,', 'Marie Mercier', 'Directrice associee',
      ].join('\n'),
      surface: 'letter',
      register: 'professional',
      mailbox: 'letters',
    });
  }

  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'ten letters', samples });
  const named = exemplars + JSON.stringify(analysis.overall.opening) + JSON.stringify(analysis.overall.closing);

  for (const name of ['Bouilhet', 'Dupont', 'Mercier', 'bouilhet', 'dupont', 'mercier']) {
    assert.doesNotMatch(named, new RegExp(name), name + ' reached a file the model reads');
  }
});

// The n-grams are the other half of what a correspondent's name can ride out on,
// and the head of the list is not proof of anything: fifteen entries deep, a name
// that runs twelve times sits under the writer's own habits and shows up only when
// the list is asked to run longer. So the fixture below is built to bury it. Each
// of the twelve letters says the same two habitual sentences three times over, and
// names a person, a town and a firm once. The habits count 36 and 72; the names
// count 12, which is rank 24 and past the end of what analysis.json carries.

const HABIT = [
  'Je vous confirme que le dossier avance comme prevu et que la livraison part lundi.',
  'Je vous confirme que le devis est parti hier et que la facture suit demain.',
].join(' ');

// Every capitalised word here stands mid-sentence, which is where a mask takes it.
const NAMED = "J'ai vu Camille Vasseur hier a Villeneuve, et la Fabrique Duchemin confirme la date.";

const IDENTIFYING = ['camille', 'vasseur', 'villeneuve', 'fabrique', 'duchemin'];

const NAMED_SAMPLES = [];
for (let index = 0; index < 12; index += 1) {
  NAMED_SAMPLES.push({
    text: ['Bonjour,', '', HABIT, '', HABIT, '', HABIT, '', NAMED, '', 'Cordialement,', 'Alex'].join('\n'),
    surface: 'letter',
    register: 'professional',
    mailbox: 'letters',
  });
}

// The fixture carries no character the typography table rewrites, so prepare reads
// it here exactly as analyse reads it after normalizing.
const namedRecords = prepare(NAMED_SAMPLES, profileFor('fr'));

function ngramWords(block) {
  return [...block.ngrams.bigrams, ...block.ngrams.trigrams]
    .flatMap((entry) => entry.ngram.split(/[ ']/).filter(Boolean));
}

test('a name, a town and a firm reach no n-gram, at the shipped limit and far past it', () => {
  const shipped = measure(namedRecords, profileFor('fr'));
  assert.strictEqual(shipped.ngrams.bigrams.length, NGRAM_LIMIT, 'the head of the list is full');

  // Thirty times what the file carries: everything the corpus has to offer.
  const deep = measure(namedRecords, profileFor('fr'), NGRAM_LIMIT * 30);
  assert.ok(deep.ngrams.bigrams.length > NGRAM_LIMIT, 'the longer list is longer');

  for (const block of [shipped, deep]) {
    for (const word of ngramWords(block)) {
      assert.ok(!IDENTIFYING.includes(word), word + ' reached an n-gram');
    }
  }

  // And what is left is still the writing: the habits are all there.
  assert.ok(deep.ngrams.bigrams.some((entry) => entry.ngram === 'je vous' && entry.count === 72));
  assert.ok(deep.ngrams.trigrams.some((entry) => entry.ngram === 'je vous confirme' && entry.count === 72));
});

test('a mask cuts the run of tokens rather than joining what stood on either side', () => {
  const deep = measure(namedRecords, profileFor('fr'), NGRAM_LIMIT * 30);
  const grams = [...deep.ngrams.bigrams, ...deep.ngrams.trigrams].map((entry) => entry.ngram);

  // "vu Camille Vasseur hier" must not come back as "vu hier": the words on either
  // side of a name were never next to each other.
  assert.ok(!grams.includes('vu hier'), 'an n-gram jumped over a masked name');
  assert.ok(!grams.includes('a et'), 'an n-gram jumped over a masked town');

  // And the placeholder is not a habit, so it is not an n-gram either. The
  // vocabulary is the union of what both scripts write, read out of them: the
  // placeholder that leaks is the one a hand-written list leaves out.
  const masked = new Set([...COLLECT_MASKS, ...Object.values(profileFor('fr').masks)]
    .map((mask) => mask.replace(/[[\]]/g, '')));
  for (const word of ngramWords(deep)) {
    assert.ok(!masked.has(word), 'the mask ' + word + ' reached an n-gram');
  }
  for (const gram of grams) assert.doesNotMatch(gram, /[[\]]/, gram + ' carries a bracket');
});

test('neither file that reaches the model names the correspondent, the town or the firm', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'twelve letters', samples: NAMED_SAMPLES });
  const both = JSON.stringify(analysis) + exemplars;

  for (const word of IDENTIFYING) {
    assert.doesNotMatch(both, new RegExp(word, 'i'), word + ' reached a file the model reads');
  }
});

// The fixture above can only catch a name where it put one, and it put every one
// mid-sentence. A writer names a person at the head of a sentence as readily as
// inside one, and a rule that reads the position rather than the corpus lets
// every one of those through, into the n-grams and into the extracts both. So
// the fixture below opens three sentences on a name and asks the same list.
const OPENING = 'Le devis tient. Vasseur a confirme. Villeneuve attendra. Camille repond demain.';

const OPENING_NAMES = ['vasseur', 'villeneuve', 'camille'];

const OPENING_SAMPLES = [];
for (let index = 0; index < 12; index += 1) {
  OPENING_SAMPLES.push({
    text: ['Bonjour,', '', HABIT, '', HABIT, '', HABIT, '', OPENING, '', 'Cordialement,', 'Alex'].join('\n'),
    surface: 'letter',
    register: 'professional',
    mailbox: 'letters',
  });
}

const openingRecords = prepare(OPENING_SAMPLES, profileFor('fr'));

test('a name that opens a sentence reaches no n-gram, at the shipped limit and far past it', () => {
  const shipped = measure(openingRecords, profileFor('fr'));
  const deep = measure(openingRecords, profileFor('fr'), NGRAM_LIMIT * 30);

  for (const block of [shipped, deep]) {
    for (const word of ngramWords(block)) {
      assert.ok(!OPENING_NAMES.includes(word), word + ' reached an n-gram');
    }
  }

  // And the ordinary words that open the other sentences are not names: the
  // corpus writes them in lower case too, and they stay where they stand.
  assert.ok(deep.ngrams.bigrams.some((entry) => entry.ngram === 'le devis'), 'an ordinary opening was masked');
  assert.ok(deep.ngrams.bigrams.some((entry) => entry.ngram === 'je vous' && entry.count === 72));
});

test('neither file that reaches the model names a correspondent who opens a sentence', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'twelve letters', samples: OPENING_SAMPLES });
  const both = JSON.stringify(analysis) + exemplars;

  for (const word of OPENING_NAMES) {
    assert.doesNotMatch(both, new RegExp(word, 'i'), word + ' reached a file the model reads');
  }
  // The writing itself survives the rule: the habit is still measured.
  assert.ok(exemplars.includes('Le devis tient.'), 'an ordinary sentence was broken by the mask');
});

// A familiar register drops the capital, on the greeting and on the sign-off
// both, which are the two lines where a correspondent is named by construction.
const FAMILIAR_SAMPLES = [];
for (let index = 0; index < 6; index += 1) {
  FAMILIAR_SAMPLES.push({
    text: ['bonjour camille,', '', HABIT, '', HABIT, '', 'bises, camille berthier'].join('\n'),
    surface: 'email',
    register: 'personal',
    mailbox: 'perso',
  });
}

test('a correspondent named without a capital reaches no salutation, no sign-off and no extract', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'six letters', samples: FAMILIAR_SAMPLES });
  const both = JSON.stringify(analysis) + exemplars;

  for (const word of ['camille', 'berthier']) {
    assert.doesNotMatch(both, new RegExp(word, 'i'), word + ' reached a file the model reads');
  }
  // The form is still measured, which is what the greeting is read for.
  assert.strictEqual(analysis.overall.opening.top_salutations[0].form, 'bonjour [nom],');
});

test('the corpus block says where the language came from and which profile measured it', () => {
  const samples = [{ text: 'Bonjour,\n\nLe devis est parti hier matin.\n\nCordialement' }];

  const declared = analyse({ lang: 'fr', samples }).analysis.corpus;
  assert.strictEqual(declared.lang_source, 'declared');
  assert.strictEqual(declared.profile, 'fr');

  const given = analyse({ lang: 'fr', samples }, { lang: 'sv' }).analysis.corpus;
  assert.strictEqual(given.lang_source, 'given');
  assert.strictEqual(given.profile, 'generic');

  const defaulted = analyse({ samples }).analysis.corpus;
  assert.strictEqual(defaulted.lang_source, 'defaulted');
  assert.strictEqual(defaulted.lang, 'en');
});

// --- What the two files promise -------------------------------------------
//
// The two files that reach the model describe their own masking, and a file that
// claims no correspondent is named while naming one is worse than the leak: the
// reader stops looking. The rule is the corpus, so the rule has a hole of its own
// shape, and these checks hold each file to the hole as well as to the rule.
//
// The hole: a name the corpus also writes in lower case somewhere. "Fort" is a
// surname and "fort" is an adverb, so the corpus vouches for the capital and the
// surname stands. Nothing in this pass can tell the two apart, and both files
// have to say so.
const AMBIGUOUS = [];
for (let index = 0; index < 12; index += 1) {
  AMBIGUOUS.push({
    text: ['Bonjour,', '', HABIT, '', HABIT, '',
      'Le dossier tient fort bien et le devis suit.',
      'Fort a repondu ce matin et Fort repasse demain.', '',
      'Cordialement,', 'Alex'].join('\n'),
    surface: 'letter',
    register: 'professional',
    mailbox: 'letters',
  });
}

test('a name the corpus also writes in lower case is not caught, and both files say so', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'twelve letters', samples: AMBIGUOUS });

  // First the hole itself, so that the sentences below are held to something real
  // and not to a fear. The corpus writes "fort" as an adverb, so it vouches for
  // the surname and the surname reaches the extract.
  assert.match(exemplars, /Fort a repondu/, 'the fixture no longer demonstrates the hole');

  // Then the promise. Neither file may claim the masking is complete.
  assert.doesNotMatch(exemplars, /No correspondent is named/,
    'exemplars.md claims a guarantee the rule does not give');
  assert.doesNotMatch(JSON.stringify(analysis), /No recipient is named/,
    'analysis.json claims a guarantee the rule does not give');

  // And each file says what the rule is and what it cannot reach.
  for (const [name, text] of [['exemplars.md', exemplars], ['analysis.json', JSON.stringify(analysis)]]) {
    assert.match(text, /never writes in lower case/, name + ' does not state the rule');
    assert.match(text, /also writes in lower case/, name + ' does not state what the rule cannot reach');
  }
});

// The fixtures above open a sentence on a full stop and on a paragraph. A
// sentence opens after five other things as well, and a rule that reads the
// corpus rather than the position owes the same answer at every one of them.
const OPENINGS = ['. ', '! ', '? ', ': ', '> '];

const EVERY_OPENING = [];
for (let index = 0; index < 12; index += 1) {
  const open = OPENINGS[index % OPENINGS.length];
  EVERY_OPENING.push({
    text: ['Bonjour,', '',
      'Ludivine a repondu ce matin sur le devis de la semaine derniere.',
      'Le devis tient toujours' + open + 'Vaurenard a repris le dossier hier soir.',
      'La reunion tient' + open + 'Trelissac reste le lieu prevu pour lundi.',
      'Rien ne bouge ici' + open + 'Quarnelec a confirme le devis ce matin.', '',
      HABIT, '', 'Cordialement,', 'Alex'].join('\n'),
    surface: 'letter',
    register: 'professional',
    mailbox: 'letters',
  });
}

const EVERY_OPENING_NAMES = ['ludivine', 'vaurenard', 'trelissac', 'quarnelec'];

test('a name reaches neither file whatever opens the sentence it stands at the head of', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'twelve letters', samples: EVERY_OPENING });
  const both = JSON.stringify(analysis) + exemplars;
  for (const word of EVERY_OPENING_NAMES) {
    assert.doesNotMatch(both, new RegExp(word, 'i'), word + ' reached a file the model reads');
  }

  const records = prepare(EVERY_OPENING, profileFor('fr'));
  const deep = measure(records, profileFor('fr'), NGRAM_LIMIT * 300);
  for (const word of ngramWords(deep)) {
    assert.ok(!EVERY_OPENING_NAMES.includes(word), word + ' reached an n-gram');
  }

  // And the writing around them is untouched: the habit is still measured.
  assert.ok(deep.ngrams.trigrams.some((entry) => entry.ngram === 'je vous confirme'));
});

// The personal data net is a second one: collect.js masks before this pass reads.
// What this pass recognises as a bank identifier is a country code, check digits
// and at least two groups behind them, carrying at least eight figures. A country
// code and a bank code alone clear none of those, so they stand, and the files
// that carry them may not promise otherwise.
const TRUNCATED = [];
for (let index = 0; index < 12; index += 1) {
  TRUNCATED.push({
    text: ['Bonjour,', '', HABIT, '', HABIT, '',
      'Le virement part demain sur fr76 3000 comme convenu.', '',
      'Cordialement,', 'Alex'].join('\n'),
    surface: 'letter',
    register: 'professional',
    mailbox: 'letters',
  });
}

test('a fragment of a bank identifier is not masked, and the limits say so', () => {
  const { analysis, exemplars } = analyse({ lang: 'fr', source: 'twelve letters', samples: TRUNCATED });

  // A whole one goes, so the rule is doing its work.
  const whole = analyse({ lang: 'fr', samples: [{ text: 'Bonjour,\n\nLe compte fr76 3000 4000 0100 0000 1234 567 est le bon.\n\nCordialement' }] });
  assert.match(whole.exemplars, /\[iban\]/, 'a whole identifier was left standing');

  // The fragment stands, which is the hole.
  assert.match(exemplars, /fr76 3000/, 'the fixture no longer demonstrates the hole');

  // So neither file promises that every identifier goes, and analysis.json names
  // the fragment among its limits.
  assert.match(exemplars, /wherever this pass recognises one/,
    'exemplars.md promises a completeness the rule does not give');
  assert.ok(analysis.method.limits.some((limit) => /fragment of an identifier/.test(limit)),
    'analysis.json does not name the fragment among its limits');
});
