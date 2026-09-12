'use strict';

// The pieces stylometry is made of, each held to a value worked out by hand and
// written down here with the working, so that a reader can check the expectation
// without running the code that produced it.

const test = require('node:test');
const assert = require('node:assert');

const {
  PROFILES, profileFor, words, display, sentences, percentile, stats,
  salutationOf, signoffOf, bodyOf, signoffFamilies,
  maskNames, maskBody, maskPersonalData, ngramRuns, ngramsOf, typographicBase,
} = require('../scripts/stylometry.js');

const { COLLECT_MASKS } = require('../scripts/collect.js');

const FR = PROFILES.fr;
const EN = PROFILES.en;

// --- Tokenization branches on the language --------------------------------

test('an English contraction is one token, a French elision is two', () => {
  assert.deepStrictEqual(words("I don't like l'art", EN), ['i', "don't", 'like', "l'art"]);
  assert.deepStrictEqual(words("I don't like l'art", FR), ['i', "don'", 't', 'like', "l'", 'art']);
});

test('a hyphenated word is one token in both languages', () => {
  assert.deepStrictEqual(words('mother-in-law', EN), ['mother-in-law']);
  assert.deepStrictEqual(words('peut-etre', FR), ['peut-etre']);
});

test('a token starts with a letter, so a figure and a list marker are not words', () => {
  assert.deepStrictEqual(words('3 devis, 2 relances et 1. la facture', FR), ['devis', 'relances', 'et', 'la', 'facture']);
});

test('an unlisted language is tokenized without claiming anything about it', () => {
  const other = profileFor('sv');
  assert.strictEqual(other.secondPerson, null);
  assert.deepStrictEqual(other.signoffFamilies, []);
  assert.deepStrictEqual(words('en kort mening', other), ['en', 'kort', 'mening']);
});

test('the display form closes up after an elided word and spaces the rest', () => {
  assert.strictEqual(display(['je', "t'"]), "je t'");
  assert.strictEqual(display(["l'", 'art']), "l'art");
  assert.strictEqual(display(['il', 'faut']), 'il faut');
});

// --- Sentences ------------------------------------------------------------

test('an abbreviation and an initial do not end a sentence', () => {
  assert.deepStrictEqual(
    sentences('M. Dupont est venu. J. Verne aussi ! Et vous ?', FR),
    ['M. Dupont est venu.', 'J. Verne aussi !', 'Et vous ?']
  );
});

test('an item of a list with no full stop is one sentence', () => {
  assert.deepStrictEqual(
    sentences('Trois points :\n\n1. le devis\n2. la relance', FR),
    ['Trois points :', 'le devis', 'la relance']
  );
});

test('a paragraph with no terminator at all is one sentence', () => {
  assert.deepStrictEqual(sentences('Bonjour', FR), ['Bonjour']);
});

// --- Arithmetic -----------------------------------------------------------

test('the median of an even count is the average of the two middle values', () => {
  // [1,2,3,4]: the two middle values are 2 and 3.
  assert.strictEqual(percentile([4, 1, 3, 2], 0.5), 2.5);
  // [1,2,3]: the middle value is 2.
  assert.strictEqual(percentile([3, 1, 2], 0.5), 2);
});

test('a percentile interpolates between its two neighbours', () => {
  // [7,10,12,19], first quartile: position 3 * 0.25 = 0.75, so 7 + (10 - 7) * 0.75.
  assert.strictEqual(percentile([7, 10, 12, 19], 0.25), 9.25);
  // [1..10], ninth decile: position 9 * 0.9 = 8.1, so 9 + (10 - 9) * 0.1.
  assert.strictEqual(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
});

test('the statistics of a small set are the ones a reader would compute', () => {
  // 9 + 12 + 14 + 21 = 56, over four values, so a mean of 14 and a median of 13.
  assert.deepStrictEqual(stats([12, 21, 9, 14]), {
    total: 56, median: 13, mean: 14, p25: 11.25, p75: 15.75, min: 9, max: 21,
  });
});

test('an empty set answers zero rather than throwing', () => {
  assert.deepStrictEqual(stats([]), { total: 0, median: 0, mean: 0, p25: 0, p75: 0, min: 0, max: 0 });
});

// --- Salutation, sign-off, body -------------------------------------------

test('a greeting line is a salutation and a first sentence is not', () => {
  assert.strictEqual(salutationOf({ text: 'Bonjour,\n\nLe devis est parti.' }, FR), 'Bonjour,');
  assert.strictEqual(salutationOf({ text: 'Le devis est parti hier soir, comme convenu.' }, FR), null);
});

test('a place and date line above the greeting is stepped over', () => {
  const text = 'Croisset, 3 juillet 1852.\n\nMon cher ami,\n\nJe t\'ecris.';
  assert.strictEqual(salutationOf({ text }, FR), 'Mon cher ami,');
});

test('the search stops when a line is long enough to be the body', () => {
  const text = 'Je reprends le fil de ce que nous disions hier au sujet du devis et de la relance.\n\nBonjour,';
  assert.strictEqual(salutationOf({ text }, FR), null);
});

test('a header line a collector left behind is not a greeting', () => {
  const text = 'RECIPIENT: a friend\nYEAR: 1852\n\nMon cher ami,\n\nJe t\'ecris.';
  assert.strictEqual(salutationOf({ text }, FR), 'Mon cher ami,');
  assert.strictEqual(salutationOf({ text: 'Subject: le devis\n\nIl est parti.' }, FR), null);
});

test('a salutation collect isolated wins over the guess', () => {
  const sample = { text: 'Bonjour,\n\nLe devis est parti.', salutation: 'Cher client,' };
  assert.strictEqual(salutationOf(sample, FR), 'Cher client,');
});

test('the sign-off is the last paragraph when it is short enough to be one', () => {
  assert.strictEqual(signoffOf({ text: 'Le devis est parti.\n\nCordialement' }, FR), 'Cordialement');
  const argument = 'Bonjour,\n\nJe reprends point par point ce que nous avions dit hier, parce que le devis ne dit pas la meme chose que la commande.';
  assert.strictEqual(signoffOf({ text: argument }, FR), null);
});

test('a message of one paragraph has no sign-off', () => {
  assert.strictEqual(signoffOf({ text: 'A demain.' }, FR), null);
});

test('the body is what is left once the greeting and the closing are out', () => {
  const text = 'Bonjour,\n\nLe devis est parti.\n\nCordialement';
  assert.strictEqual(bodyOf(text, 'Bonjour,', 'Cordialement'), 'Le devis est parti.');
});

test('a message that is nothing but a greeting and a closing keeps its text', () => {
  const text = 'Bonjour,\n\nCordialement';
  assert.strictEqual(bodyOf(text, 'Bonjour,', 'Cordialement'), text);
});

test('a closing formula is filed under its family, and one message can carry two', () => {
  assert.deepStrictEqual(signoffFamilies('Le devis est parti. Cordialement', FR), ['cordialement']);
  assert.deepStrictEqual(signoffFamilies('Merci de ta relecture. Bises', FR), ['bises / bisous', 'merci']);
  assert.deepStrictEqual(signoffFamilies('Sent it over. Thanks', EN), ['thanks / thank you']);
});

// --- Masking --------------------------------------------------------------

test('a greeting or a closing word survives the mask, a name does not', () => {
  assert.strictEqual(maskNames('Mon cher Paul,', FR), 'Mon cher [nom],');
  assert.strictEqual(maskNames('Cordialement, Paul', FR), 'Cordialement, [nom]');
  assert.strictEqual(maskNames('Dear Paul,', EN), 'Dear [name],');
  assert.strictEqual(maskNames('Best, Sam', EN), 'Best, [name]');
});

// A word the corpus writes in lower case somewhere is a word of the language and
// stays wherever it stands; one it only ever writes with a capital is a name,
// and the head of a sentence is no shelter.
test('a capitalised word the corpus also writes in lower case stays, at any position', () => {
  const vocabulary = new Set(['on', 'a', 'vu', 'hier', 'paye', 'la', 'facture']);
  assert.strictEqual(
    maskBody('On a vu Paul hier. Marie a paye la facture.', FR, vocabulary),
    'On a vu [nom] hier. [nom] a paye la facture.'
  );
  // With nothing in the corpus to vouch for it, a capital opening a sentence is
  // masked like any other. 'On' is not such a word: it is in the always-kept
  // list of its language, which is what keeps a thin corpus readable, and no
  // first name can enter that list.
  assert.strictEqual(maskBody('Bertrand a vu Paul hier.', FR, new Set()), '[nom] a vu [nom] hier.');
  assert.strictEqual(maskBody('On a vu Paul hier.', FR, new Set()), 'On a vu [nom] hier.');
});

// An elided word carries its apostrophe into the token, so the token is judged on
// the words it holds rather than on its capital.
test('an elided word is judged on the words it holds', () => {
  const vocabulary = new Set(["l'", 'affaire', 'avance']);
  assert.strictEqual(maskBody("L'affaire avance", FR, vocabulary), "L'affaire avance");
  assert.strictEqual(maskBody("L'Orbanet avance", FR, vocabulary), '[nom] avance');
});

// English writes its first person with a capital and never without one, so no
// corpus can vouch for it and the profile has to.
test('the English first person is not a name', () => {
  const vocabulary = new Set(['we', 'talked', 'and', 'said', 'it', 'was', 'fine', 'then', 'left']);
  assert.strictEqual(
    maskBody('We talked and I said it was fine, then I left.', EN, vocabulary),
    'We talked and I said it was fine, then I left.'
  );
  assert.strictEqual(maskBody("I'm late and I'll write", EN, new Set()), "I'm late and I'll write");
});

test('an address, a telephone number, an account and a link never reach an extract', () => {
  const text = 'ecris a a.b+c@sub.example.com ou appelle le +33 6 12 34 56 78, dossier 1234567, voir https://x.test/a';
  assert.strictEqual(
    maskPersonalData(text, FR),
    'ecris a [email] ou appelle le [telephone], dossier [numero], voir [url]'
  );
});

// --- The runs the n-grams are counted on ----------------------------------

test('an n-gram run is cut at every mask and never carries the placeholder', () => {
  // "Paul" and "Marie" are both names to this corpus, which writes neither in
  // lower case. The cuts leave "vu" and "hier" in two runs, so that they never
  // form a bigram, and "hier" and "a" in two more.
  assert.deepStrictEqual(
    ngramRuns('On a vu Paul hier. Marie a paye la facture.', FR,
      new Set(['on', 'a', 'vu', 'hier', 'paye', 'la', 'facture'])),
    [['on', 'a', 'vu'], ['hier'], ['a', 'paye', 'la', 'facture']]
  );
});

test('an address and a reference number are cut out of the runs as surely as a name', () => {
  assert.deepStrictEqual(
    ngramRuns('Ecris a a.b@example.com demain, dossier 1234567.', FR,
      new Set(['ecris', 'a', 'demain', 'dossier'])),
    [['ecris', 'a'], ['demain', 'dossier']]
  );
});

test('the runs are cut in English on the same rule', () => {
  assert.deepStrictEqual(
    ngramRuns('We met Paul Smith in Bristol.', EN, new Set(['we', 'met', 'in'])),
    [['we', 'met'], ['in']]
  );
});

// --- N-grams against the reference ----------------------------------------

const FOUR_TIMES = [['je', 'vais', 'bien'], ['je', 'vais', 'bien'], ['je', 'vais', 'bien'], ['je', 'vais', 'bien']];

test('an n-gram the reference does not hold passes on its count alone', () => {
  // 12 tokens in all, "je vais" four times: 4 / 12 * 10000 = 3333.33 per 10,000.
  assert.deepStrictEqual(ngramsOf(FOUR_TIMES, 2, {}, 12, 15), [
    { ngram: 'je vais', count: 4, per_10k: 3333.33, reference_per_10k: 0, times_the_reference: null },
    { ngram: 'vais bien', count: 4, per_10k: 3333.33, reference_per_10k: 0, times_the_reference: null },
  ]);
});

test('an n-gram is characteristic only above twice the rate the reference gives it', () => {
  // Twice 1666 is 3332, which 3333.33 clears; twice 1667 is 3334, which it does not.
  assert.deepStrictEqual(
    ngramsOf(FOUR_TIMES, 2, { 'je vais': 1666 }, 12, 15).map((entry) => entry.ngram),
    ['je vais', 'vais bien']
  );
  assert.deepStrictEqual(
    ngramsOf(FOUR_TIMES, 2, { 'je vais': 1667 }, 12, 15).map((entry) => entry.ngram),
    ['vais bien']
  );
  assert.strictEqual(ngramsOf(FOUR_TIMES, 2, { 'je vais': 1666 }, 12, 15)[0].times_the_reference, 2);
});

test('a bigram needs four occurrences and a trigram three', () => {
  const threeTimes = FOUR_TIMES.slice(0, 3);
  assert.deepStrictEqual(ngramsOf(threeTimes, 2, {}, 9, 15), []);
  assert.deepStrictEqual(ngramsOf(threeTimes, 3, {}, 9, 15).map((entry) => entry.ngram), ['je vais bien']);
});

test('the limit is honoured', () => {
  assert.strictEqual(ngramsOf(FOUR_TIMES, 2, {}, 12, 1).length, 1);
});

// --- Typography, kept apart -----------------------------------------------

test('the typographic base counts the characters the table rewrites, by class', () => {
  const base = typographicBase(['a \u2019 b', '\u00A0\u2014\u2026'], 'en');
  assert.strictEqual(base.characters_normalised_total, 4);
  assert.strictEqual(base.per_message_average, 2);
  assert.deepStrictEqual(base.by_class, { Apostrophes: 1, Dashes: 1, Ellipsis: 1, Spaces: 1 });
  assert.deepStrictEqual(base.by_character, {
    'Apostrophes U+2019': 1, 'Dashes U+2014': 1, 'Ellipsis U+2026': 1, 'Spaces U+00A0': 1,
  });
});

test('a character the table preserves is reported as left alone, not as rewritten', () => {
  const base = typographicBase(['\u00AB oui \u00BB'], 'fr');
  assert.strictEqual(base.characters_normalised_total, 0);
  assert.deepStrictEqual(Object.keys(base.left_untouched).sort(), ['U+00AB \u00AB', 'U+00BB \u00BB']);
});

// --- Names, which are the one thing an extract may never carry -------------

test('the second half of a name is masked as surely as the first', () => {
  const vocabulary = new Set(['je', 'vois', 'demain', 'convenu', 'avec', 'que', 'la', 'livraison', 'suit']);
  assert.strictEqual(maskBody('je vois Marie Dupont demain', FR, vocabulary), 'je vois [nom] [nom] demain');
  assert.strictEqual(
    maskBody('convenu avec Paul Mercier que la livraison suit', FR, vocabulary),
    'convenu avec [nom] [nom] que la livraison suit'
  );
});

test('a line opening on a title carries a name, and a signature block is all name', () => {
  assert.strictEqual(maskNames('Madame Lefevre,', FR), 'Madame [nom],');
  assert.strictEqual(
    maskBody('fin.\nMarie Dupont\nDirectrice', FR, new Set(['fin'])),
    'fin.\n[nom] [nom]\n[nom]'
  );
});

test('a name typed without its capital in a greeting or a closing is still a name', () => {
  assert.strictEqual(maskNames('bises, marc', FR), 'bises, [nom]');
  assert.strictEqual(maskNames('bonjour camille,', FR), 'bonjour [nom],');
  assert.strictEqual(maskNames('bises, camille berthier', FR), 'bises, [nom] [nom]');
  assert.strictEqual(maskNames('a bientot camille', FR), 'a bientot [nom]');
  assert.strictEqual(maskNames('hi morgan,', EN), 'hi [name],');
  assert.strictEqual(maskNames('thanks, morgan hallowell', EN), 'thanks, [name] [name]');
  assert.strictEqual(maskNames('Bien cordialement', FR), 'Bien cordialement');
  assert.strictEqual(
    maskNames("Je vous prie d'agreer, Madame, l'expression de mes sentiments distingues", FR),
    "Je vous prie d'agreer, Madame, l'expression de mes sentiments distingues"
  );
});

test('a telephone number written the North American way never reaches an extract', () => {
  assert.strictEqual(
    maskPersonalData('appelle le (415) 555-2671 ou le 415-555-2671', FR),
    'appelle le [telephone] ou le [telephone]'
  );
  assert.strictEqual(
    maskPersonalData('le compte fr76 3000 6000 0112 3456 7890 189 est ferme', FR),
    'le compte [iban] est ferme'
  );
});

test('a placeholder left by an earlier mask is never masked a second time', () => {
  // maskNames runs after maskPersonalData, so the line it reads already carries
  // placeholders. Reading the word inside one and replacing it again turns
  // [nom] into [[nom]], which no reader can undo and no test would notice.
  // maskNames masks every word a greeting or a signature does not keep, which is
  // its job; what it must never do is read inside a placeholder.
  // The vocabulary is read out of the two scripts rather than restated here: a
  // placeholder collect.js writes and this file does not list is exactly the one
  // that goes unrecognised, and a literal array cannot go red when the list moves.
  for (const profile of [FR, EN]) {
    const placeholders = [...new Set([...COLLECT_MASKS, ...Object.values(profile.masks)])];
    for (const mask of placeholders) {
      for (const line of ['bises, ' + mask, 'cordialement, ' + mask, 'ecrit a ' + mask, 'au ' + mask]) {
        const out = maskNames(line, profile);
        assert.doesNotMatch(out, /\[\[|\]\]/, line);
        // The name mask is the one every other word becomes, so its count is the
        // only one this line cannot hold steady.
        if (mask !== profile.masks.name) {
          assert.strictEqual(out.split(mask).length - 1, line.split(mask).length - 1, line + ' -> ' + out);
        }
      }
    }
  }
});
