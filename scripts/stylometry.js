'use strict';

// Stylometry for voice.md, from handoff section 7.
//
// Reads the samples collect.js writes and produces the only two files that ever
// reach the model: analysis.json, the numbers, and exemplars.md, five extracts
// per register and per surface. The corpus itself stays on the machine.
//
// The input, which is the contract with scripts/collect.js:
//
//   { "lang": "fr",
//     "source": "two mailboxes and one folder of letters",
//     "samples": [
//       { "text": "...",                  required
//         "mailbox": "pro",               tag the person gave the mailbox
//         "date": "2026-03-04",           ISO, or null
//         "recipient_domain": "example.org",
//         "surface": "email",             email | letter | message | form
//         "register": "professional",     guessed by collect, corrected by the person
//         "salutation": "Bonjour,",       optional, when collect isolated it
//         "signoff": "Cordialement",      optional, same
//         "signature": "Alex" }           optional, same
//     ] }
//
// Anything else collect writes on a sample (a word count, a weight) is carried
// along and ignored, with two exceptions read here: the sample id, which the
// register table can name, and the adapter, which says whether the sample came
// out of a mailbox or out of the folder of letters the person reviewed.
//
// Several of those documents are read at once, as an array, because the setup
// collects one per mailbox plus the folder of reviewed letters and three runs of
// collect cannot otherwise reach one measurement. A single document is read on
// its own, and so is a bare array of samples. Nothing given is dropped in
// silence: what cannot be read is refused, and what contributed no sample is
// still counted, at zero, in the corpus block.
//
// Every sample counts once. A folder of reviewed letters is worth more than a
// sent mail to a reader, but a weight that silently doubles a count is a number
// nobody can check, so the folder buys a rule of selection instead: at
// comparable length its letters are the ones quoted.
//
// Three rules hold the whole file together. Voice is measured on the normalized
// text, so that a curly apostrophe cannot split a word in two. The typography is
// counted on the raw text and reported on its own, because it comes from the
// mail client and not from the person. And the salutation and the sign-off are
// measured as themselves and taken out of the body first, so that "Bonjour," and
// "Cordialement" do not turn a writer of long sentences into a writer of
// one-word ones.

const fs = require('node:fs');
const path = require('node:path');

const { normalize, label, TABLE, PRESERVED } = require('./typo.js');

// The table reports U+2013, U+2014 and U+2015 rather than replacing them,
// because an aside is rewritten and not substituted. That is a rule about a
// sentence somebody is writing. Neither thing here is that: a count of the
// corpus counts every character the table names, and a quoted extract carries
// the subject's words and not their glyphs, into a file that may hold none of
// these characters. Both ask for the whole table.
const EVERY_CLASS = { Dashes: 'replace' };

// The placeholders scripts/collect.js writes, taken from the script itself so
// that the two lists cannot drift. They are not the ones the profiles below
// carry: collect masks an address, a bank identifier, a case reference, an
// amount and a telephone number before this file reads a single sample, and a
// placeholder this file does not recognise is read as a word the person wrote.
const { COLLECT_MASKS } = require('./collect.js');

const CLASS_OF = new Map();
for (const [name, entry] of Object.entries(TABLE)) {
  for (const point of entry.points) CLASS_OF.set(point, name);
}

// --- Language profiles ----------------------------------------------------
//
// Tokenization branches on the language because a contraction is a signal in
// English and an elision is not one in French: "don't" is a choice, "l'art" is
// the only way to write it. Everything else a language decides lives here too,
// so adding one is filling in a table rather than editing a measurement.

const FRENCH = {
  // An apostrophe ends an elided word: "l'art" is two tokens, "l'" and "art",
  // and the bigram "je t'" is then visible as itself. A token starts with a
  // letter, so a figure and the "1." of a list are not words.
  word: /\p{L}[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*'|\p{L}[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*/gu,
  abbreviations: ['m', 'mm', 'mme', 'mmes', 'mlle', 'dr', 'st', 'ste', 'cf', 'etc', 'env', 'art', 'p', 'ex', 'n', 'no', 'av', 'bd'],
  secondPerson: {
    familiar: ['tu', 'te', "t'", 'toi', 'ton', 'ta', 'tes', 'tien', 'tiens', 'tienne', 'tiennes'],
    formal: ['vous', 'votre', 'vos', 'votres'],
  },
  salutationOpeners: ['bonjour', 'bonsoir', 'salut', 'coucou', 'cher', 'chere', 'chers', 'cheres', 'madame', 'monsieur', 'messieurs', 'mesdames', 'maitre', 'mon', 'ma', 'mes'],
  // The words a greeting and a closing formula are made of, and the small change
  // that holds them together. They survive the mask, so that a sign-off counts as
  // a form and not as a name; everything else on those two lines is masked
  // whatever its case, which is why this list carries 'de' and 'la' as well as
  // 'cordialement'. Nobody is called 'de'.
  closingWords: ['cordialement', 'bien', 'a', 'vous', 'toi', 'amicalement', 'bises', 'bisous', 'merci', 'adieu', 'salutations', 'sinceres', 'distinguees', 'distingues', 'agreer', 'prie', 'expression', 'sentiments', 'consideration', 'respectueusement', 'amities', 'tendresses', 'embrasse', 'bientot', 'tout', 'je', 'te', 'de', 'du', 'des', 'le', 'la', 'les', 'et', 'meilleures', 'cordiales', 'chaleureusement', 'affectueusement', 'fort', 'encore', 'beaucoup', 'bonne', 'bonnes', 'journee', 'soiree', 'weekend', 'continuation', 'plus', 'tard', 'demain'],
  // Words no corpus can vouch for, because the language never writes them in
  // lower case. French has none.
  // A capitalised word the corpus never writes in lower case is read as a name.
  // On a corpus of a few dozen samples that is most sentence openings, so the
  // extracts come back full of brackets and stop being readable. These are the
  // words that can open a sentence without ever being one: articles, pronouns,
  // prepositions, conjunctions, auxiliaries, the months and the weekdays. No
  // first name can enter such a list by construction, which is what makes it
  // safe to keep them whatever their case.
  alwaysKept: [
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'ce', 'cet',
    'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
    'notre', 'nos', 'votre', 'vos', 'leur', 'leurs', 'quel', 'quelle', 'quels',
    'quelles', 'tout', 'toute', 'tous', 'toutes', 'meme', 'memes', 'autre',
    'autres', 'chaque', 'aucun', 'aucune', 'plusieurs', 'certains', 'certaines',
    'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te',
    'se', 'moi', 'toi', 'lui', 'eux', 'soi', 'y', 'en', 'qui', 'que', 'quoi',
    'dont', 'ou', 'lequel', 'laquelle', 'celui', 'celle', 'ceux', 'celles',
    'ceci', 'cela', 'ca', 'rien', 'personne', 'chacun', 'chacune',
    'a', 'dans', 'par', 'pour', 'sur', 'sous', 'avec', 'sans', 'chez', 'vers',
    'entre', 'depuis', 'pendant', 'avant', 'apres', 'contre', 'selon', 'malgre',
    'parmi', 'hors', 'jusque', 'envers', 'outre', 'durant',
    'et', 'mais', 'donc', 'or', 'ni', 'car', 'si', 'comme', 'quand', 'lorsque',
    'puisque', 'quoique', 'bien', 'ainsi', 'alors', 'aussi', 'encore', 'enfin',
    'ensuite', 'puis', 'pourtant', 'cependant', 'toutefois', 'neanmoins',
    'sinon', 'surtout', 'plutot', 'deja', 'toujours', 'jamais', 'souvent',
    'peut', 'peu', 'tres', 'trop', 'assez', 'moins', 'plus', 'autant', 'tant',
    'suis', 'es', 'est', 'sommes', 'etes', 'sont', 'etais', 'etait', 'etions',
    'etaient', 'serai', 'sera', 'serons', 'seront', 'soit', 'soient', 'ete',
    'ai', 'as', 'avons', 'avez', 'ont', 'avais', 'avait', 'avions', 'avaient',
    'aurai', 'aura', 'aurons', 'auront', 'eu', 'faut', 'voici', 'voila',
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout',
    'septembre', 'octobre', 'novembre', 'decembre',
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
    'hier', 'demain', 'matin', 'soir', 'nuit', 'jour', 'semaine', 'mois', 'annee',
  ],
  signoffFamilies: [
    { family: 'cordialement', match: /\bcordialement\b/i },
    { family: 'bien a vous / bien a toi', match: /\bbien\s+(?:a|à)\s+(?:vous|toi)\b/i },
    { family: 'amicalement', match: /\bamicalement\b/i },
    { family: "je t'embrasse / je vous embrasse", match: /\bembrasse\b/i },
    { family: 'bises / bisous', match: /\bbis(?:es|ous|e)\b/i },
    { family: 'a bientot', match: /\b(?:a|à)\s+bient(?:o|ô)t\b/i },
    { family: 'merci', match: /\bmerci\b/i },
    { family: 'salutations / agreer', match: /\b(?:salutations|agr(?:e|é){2}r|consid(?:e|é)ration)\b/i },
    { family: 'a toi / a vous', match: /\b(?:tout\s+)?(?:a|à)\s+(?:toi|vous)\b/i },
    { family: 'adieu', match: /\badieu\b/i },
    { family: 'amities / tendresses', match: /\b(?:amiti(?:e|é)s|tendresses?|affectueusement)\b/i },
  ],
  interjections: ['ah', 'eh', 'oh', 'bon', 'bref', 'enfin', 'tiens', 'allez', 'donc', 'voila', 'bien'],
  connectives: ['et', 'mais', 'donc', 'or', 'car'],
  masks: { name: '[nom]', email: '[email]', phone: '[telephone]', number: '[numero]', url: '[url]', iban: '[iban]' },
  reference: {
    // Rate per 10,000 tokens, in the tokenized form above, for n-grams that are
    // common in the language at large. A floor, not a reference corpus: see the
    // note in METHOD.
    bigrams: {
      'de la': 70, "de l'": 40, "d'un": 25, "d'une": 20, 'il y': 28, 'y a': 28, 'à la': 30,
      'de ce': 12, 'que je': 22, 'je ne': 25, 'ne pas': 26, 'il est': 20, "c'est": 45,
      'dans le': 15, 'dans la': 15, 'sur le': 12, 'sur la': 12, 'pour le': 12, 'pour la': 12,
      "j'ai": 30, "n'est": 18, 'que le': 14, 'que la': 14, 'plus de': 12,
      'a été': 10, 'est un': 10, 'est une': 9, 'tout le': 8,
      'et de': 18, 'et je': 12, 'de mon': 8, 'de ma': 7, 'de vous': 8, 'de me': 7,
      'vous avez': 8, 'vous êtes': 7, 'je vous': 20, 'je te': 12, 'je suis': 18,
      'il faut': 12, 'en train': 4, 'au moins': 4, 'bien que': 4, 'parce que': 8,
      'ce que': 20, 'ce qui': 18, 'a bien': 5, 'de votre': 8, 'à vous': 6,
    },
    trigrams: {
      'il y a': 26, "n'est pas": 14, 'ce que je': 5, "c'est un": 6,
      "c'est une": 5, 'de plus en': 3, 'plus en plus': 3, 'il faut que': 4,
      'à la fois': 2, 'tout de même': 2, 'ce qui est': 3,
      "je n'ai": 5, "il n'y": 5, 'y a pas': 4, 'de la vie': 2,
      'dans le monde': 2, 'je vous prie': 2,
    },
  },
  tics: [
    { tic: 'je en tete de phrase', kind: 'sentenceStartsWith', words: ['je', "j'"] },
    { tic: 'interjection en tete', kind: 'sentenceStartsWithInterjection' },
    { tic: 'et ou mais en tete de phrase', kind: 'sentenceStartsWithConnective' },
    { tic: "phrase d'un seul mot", kind: 'oneWordSentence' },
    { tic: 'parenthese', kind: 'character', character: '(' },
    { tic: 'point-virgule', kind: 'character', character: ';' },
    { tic: 'citation entre guillemets', kind: 'quotation' },
    { tic: 'exclamation doublee', kind: 'pattern', pattern: /!\s*!/g },
    { tic: 'incise entre tirets', kind: 'pattern', pattern: /\S\s-\s\S/g },
    { tic: 'mot en capitales', kind: 'shout' },
  ],
};

const ENGLISH = {
  // A contraction and a possessive keep their apostrophe: "don't" and "the
  // writer's" are one token each.
  word: /\p{L}[\p{L}\p{N}]*(?:['-][\p{L}\p{N}]+)*/gu,
  abbreviations: ['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'inc', 'ltd', 'vs', 'etc', 'eg', 'ie', 'no', 'fig', 'approx'],
  // English draws no familiar and formal second person. The measurement says so
  // rather than inventing one.
  secondPerson: null,
  salutationOpeners: ['hi', 'hello', 'hey', 'dear', 'good', 'greetings', 'morning', 'afternoon'],
  closingWords: ['best', 'regards', 'thanks', 'thank', 'you', 'cheers', 'sincerely', 'yours', 'faithfully', 'talk', 'soon', 'see', 'take', 'care', 'all', 'the', 'kind', 'warm', 'let', 'me', 'know', 'again', 'much', 'very', 'and', 'for', 'to', 'in', 'touch', 'speak', 'later', 'have', 'a', 'good', 'day', 'week', 'weekend', 'wishes', 'ever'],
  // The one word an English corpus can never vouch for: it is written with a
  // capital everywhere, so no lower case occurrence exists to spare it, and
  // without this line the commonest word of personal correspondence is read as a
  // name and the sentence around it is handed to the model ungrammatical.
  // Same list for English, and the same reason: a word that can open a sentence
  // without ever being a name. 'i' was already here because no English corpus
  // ever vouches for it in lower case.
  alwaysKept: [
    'i', "i'm", "i've", "i'll", "i'd",
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
    'her', 'its', 'our', 'their', 'some', 'any', 'each', 'every', 'no', 'both',
    'few', 'many', 'much', 'more', 'most', 'other', 'another', 'such', 'what',
    'which', 'whose', 'all',
    'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'us', 'them', 'who',
    'whom', 'there', 'here', 'one', 'someone', 'anyone', 'everyone', 'nobody',
    'in', 'on', 'at', 'to', 'for', 'with', 'without', 'from', 'by', 'about',
    'after', 'before', 'between', 'during', 'under', 'over', 'through', 'into',
    'against', 'among', 'across', 'behind', 'beyond', 'within', 'since', 'until',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'as', 'because', 'while',
    'when', 'where', 'though', 'although', 'unless', 'whether', 'than', 'then',
    'also', 'still', 'just', 'only', 'even', 'never', 'always', 'often',
    'perhaps', 'maybe', 'however', 'therefore', 'meanwhile', 'otherwise',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall',
    'should', 'may', 'might', 'must', 'let',
    'january', 'february', 'march', 'april', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'yesterday', 'today', 'tomorrow', 'morning', 'evening', 'night', 'week',
    'month', 'year',
  ],
  signoffFamilies: [
    { family: 'best / all the best', match: /\bbest\b/i },
    { family: 'regards', match: /\bregards\b/i },
    { family: 'thanks / thank you', match: /\bthanks?\b|\bthank you\b/i },
    { family: 'cheers', match: /\bcheers\b/i },
    { family: 'sincerely / yours', match: /\b(?:sincerely|yours|faithfully)\b/i },
    { family: 'talk soon / see you', match: /\b(?:talk|speak|see)\s+(?:to\s+)?(?:you\s+)?(?:soon|later)\b/i },
    { family: 'let me know', match: /\blet me know\b/i },
  ],
  interjections: ['oh', 'ah', 'well', 'so', 'right', 'look', 'honestly', 'anyway', 'okay', 'ok'],
  connectives: ['and', 'but', 'so', 'or', 'yet'],
  masks: { name: '[name]', email: '[email]', phone: '[phone]', number: '[number]', url: '[url]', iban: '[iban]' },
  reference: {
    bigrams: {
      'of the': 80, 'in the': 70, 'to the': 50, 'on the': 32, 'for the': 30, 'and the': 30,
      'at the': 28, 'with the': 25, 'from the': 20, 'that the': 20, 'to be': 26, 'it is': 20,
      'this is': 15, 'there is': 10, 'i am': 15, 'i have': 15, 'i will': 10, 'i would': 9,
      'i think': 8, 'we are': 10, 'we have': 9, 'you can': 8, 'if you': 10, 'will be': 12,
      'would be': 10, 'has been': 8, 'as well': 8, 'a lot': 4, 'let me': 5, 'thank you': 6,
      'make sure': 3, 'in order': 4, 'one of': 10, 'some of': 6, 'more than': 6, 'going to': 8,
      "don't": 12, "it's": 20, "i'm": 12, "that's": 8,
    },
    trigrams: {
      'one of the': 10, 'as well as': 6, 'a lot of': 5, 'in order to': 4, 'it would be': 4,
      'there is a': 4, 'i think that': 3, 'let me know': 3, 'thank you for': 3,
      'i have been': 3, 'the fact that': 3, 'at the same': 3, 'the same time': 3,
      'i would like': 3, 'be able to': 3,
    },
  },
  tics: [
    { tic: 'I at the start of a sentence', kind: 'sentenceStartsWith', words: ['i'] },
    { tic: 'interjection at the start', kind: 'sentenceStartsWithInterjection' },
    { tic: 'and or but at the start of a sentence', kind: 'sentenceStartsWithConnective' },
    { tic: 'one word sentence', kind: 'oneWordSentence' },
    { tic: 'parenthesis', kind: 'character', character: '(' },
    { tic: 'semicolon', kind: 'character', character: ';' },
    { tic: 'quotation', kind: 'quotation' },
    { tic: 'doubled exclamation', kind: 'pattern', pattern: /!\s*!/g },
    { tic: 'dash aside', kind: 'pattern', pattern: /\S\s-\s\S/g },
    { tic: 'contraction', kind: 'pattern', pattern: /\p{L}'(?:t|s|re|ve|ll|d|m)\b/giu },
    { tic: 'shouted word', kind: 'shout' },
  ],
};

const PROFILES = { fr: FRENCH, en: ENGLISH };
const DEFAULT_LANG = 'en';

// An unlisted language gets the English machinery with everything English
// itself decides taken out, so that nothing is claimed about it.
function profileFor(lang) {
  if (PROFILES[lang]) return PROFILES[lang];
  return Object.assign({}, ENGLISH, {
    secondPerson: null,
    signoffFamilies: [],
    closingWords: [],
    alwaysKept: [],
    reference: { bigrams: {}, trigrams: {} },
    tics: ENGLISH.tics.filter((tic) => tic.tic !== 'contraction'),
  });
}

// --- Units ----------------------------------------------------------------

function words(text, profile) {
  return text.toLowerCase().match(profile.word) || [];
}

// The display form of a run of tokens: no space after an elided word, so
// ["je", "t'"] reads "je t'" and ["l'", "art"] reads "l'art".
function display(tokens) {
  let out = '';
  for (const token of tokens) {
    if (out && !out.endsWith("'")) out += ' ';
    out += token;
  }
  return out;
}

function paragraphs(text) {
  return text.split(/\n[ \t]*\n/).map((block) => block.trim()).filter((block) => block.length);
}

function endsWithAbbreviation(chunk, profile) {
  const match = chunk.match(/(\p{L}+)\.$/u);
  if (!match) return false;
  const word = match[1].toLowerCase();
  // A single letter before a full stop is an initial, not the end of a sentence.
  if (word.length === 1) return true;
  return profile.abbreviations.includes(word);
}

// Sentences are cut inside a line, so a list whose items carry no full stop
// counts as one sentence per item rather than one sentence per list.
function sentences(text, profile) {
  const found = [];
  for (const block of paragraphs(text)) {
    for (const line of block.split('\n')) {
      let start = 0;
      const boundary = /[.!?]+(?=\s|$)/g;
      let match;
      while ((match = boundary.exec(line)) !== null) {
        const end = match.index + match[0].length;
        const chunk = line.slice(start, end);
        if (endsWithAbbreviation(chunk, profile)) continue;
        const trimmed = chunk.trim();
        if (trimmed) found.push(trimmed);
        start = end;
      }
      const rest = line.slice(start).trim();
      if (rest) found.push(rest);
    }
  }
  return found.filter((sentence) => words(sentence, profile).length);
}

// --- Arithmetic -----------------------------------------------------------

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Linear interpolation between the two neighbouring values, which makes the
// median of an even count the average of the two middle ones.
function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return round(sorted[low] + (sorted[high] - sorted[low]) * (position - low), 2);
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    total,
    median: percentile(sorted, 0.5),
    mean: sorted.length ? round(total / sorted.length, 1) : 0,
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    min: sorted.length ? sorted[0] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

function rate(count, base, per, decimals) {
  if (!base) return 0;
  return round((count / base) * per, decimals === undefined ? 2 : decimals);
}

function pct(count, base) {
  return rate(count, base, 100, 1);
}

function countOf(text, character) {
  let found = 0;
  for (const ch of text) if (ch === character) found += 1;
  return found;
}

function top(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function bump(map, key, by) {
  map.set(key, (map.get(key) || 0) + (by === undefined ? 1 : by));
}

// --- Typography, kept apart -----------------------------------------------

// Counted on the raw text, before anything else looks at it. What a mail client
// puts in is not what a person writes: this block exists so that no trait of
// Voice can ever rest on a character the sender never typed.
function typographicBase(rawTexts, lang) {
  const byCharacter = new Map();
  const byClass = new Map();
  const untouched = new Map();
  let total = 0;
  // Counted apart from left_untouched, which only lists what the table names and
  // shows the ten commonest: a profile that claims the source held no straight
  // apostrophe needs the figure even when it is zero, and zero never reaches a
  // top ten.
  let straight = 0;

  for (const text of rawTexts) {
    const { counts } = normalize(text, lang, EVERY_CLASS);
    for (const [name, count] of Object.entries(counts)) {
      const point = parseInt(name.slice(2), 16);
      bump(byCharacter, CLASS_OF.get(point) + ' ' + name, count);
      bump(byClass, CLASS_OF.get(point), count);
      total += count;
    }
    for (const ch of text) {
      const point = ch.codePointAt(0);
      if (PRESERVED.includes(point)) bump(untouched, label(point) + ' ' + ch, 1);
      if (point === 0x27) straight += 1;
    }
  }

  return {
    note: 'Characters the typography table names, counted on the text as it arrived. They usually come from the mail client and not from the person, so nothing here is a trait of the voice and the profile must not turn any of it into one.',
    characters_normalised_total: total,
    per_message_average: rawTexts.length ? round(total / rawTexts.length, 1) : 0,
    by_class: Object.fromEntries(top(byClass, 20)),
    by_character: Object.fromEntries(top(byCharacter, 30)),
    left_untouched: Object.fromEntries(top(untouched, 10)),
    straight_apostrophes: straight,
  };
}

// --- Openings, closings, body ---------------------------------------------

const SALUTATION_WORDS = 8;
const SIGNOFF_WORDS = 10;
const SIGNOFF_WINDOW = 30;

// A salutation is a short line that either ends on a comma or a colon or opens
// on a word the language greets with. It is looked for over the first few lines
// rather than the first one alone, because a letter can print a place and a date
// above it; the search stops as soon as a line is long enough to be the body.
const SALUTATION_LINES = 3;

function qualifiesAsSalutation(line, profile) {
  const tokens = words(line, profile);
  if (!tokens.length || tokens.length > SALUTATION_WORDS) return false;
  if (profile.salutationOpeners.includes(tokens[0])) return true;
  return /[,:]$/.test(line) && tokens.length <= 4;
}

// "From: ...", "Subject: ...", "RECIPIENT: ...": a single word and a colon at
// the head of a message is furniture a collector left behind, not a greeting.
function isHeaderLine(line, profile) {
  const match = line.match(/^([A-Za-z][\w-]*)\s*:/);
  return Boolean(match) && !profile.salutationOpeners.includes(match[1].toLowerCase());
}

function salutationOf(sample, profile) {
  const supplied = typeof sample.salutation === 'string' ? sample.salutation.trim() : '';
  // A collector's answer wins, unless what it hands over is furniture.
  if (supplied && !isHeaderLine(supplied, profile)) return supplied;
  const lines = sample.text.split('\n').map((line) => line.trim()).filter((line) => line.length);
  let looked = 0;
  for (const line of lines) {
    // Furniture costs nothing: it is stepped over without using up a look.
    if (isHeaderLine(line, profile)) continue;
    if (qualifiesAsSalutation(line, profile)) return line;
    if (words(line, profile).length > SALUTATION_WORDS) return null;
    looked += 1;
    if (looked >= SALUTATION_LINES) return null;
  }
  return null;
}

// The sign-off is the last paragraph when it is short enough to be one: a
// closing formula and a signature, not the end of an argument.
function signoffOf(sample, profile) {
  if (typeof sample.signoff === 'string' && sample.signoff.trim()) return sample.signoff.trim();
  const blocks = paragraphs(sample.text);
  if (blocks.length < 2) return null;
  const last = blocks[blocks.length - 1];
  if (words(last, profile).length > SIGNOFF_WORDS) return null;
  return last;
}

// What is left once the greeting, the closing and the signature are taken out,
// which is what every measurement below runs on. A message that is nothing but a
// greeting and a closing keeps its text, so that it still counts as a message.
function cutTail(text, block) {
  if (!block) return text;
  const at = text.lastIndexOf(block);
  if (at === -1 || text.slice(at + block.length).trim()) return text;
  return text.slice(0, at);
}

function bodyOf(text, salutation, signoff, signature) {
  let out = cutTail(cutTail(text, signature), signoff);
  if (salutation) {
    const at = out.indexOf(salutation);
    const before = at === -1 ? [] : out.slice(0, at).split('\n').filter((line) => line.trim());
    if (at !== -1 && before.length < SALUTATION_LINES) {
      out = out.slice(0, at) + out.slice(at + salutation.length);
    }
  }
  return out.trim() || text.trim();
}

// An elided word carries its apostrophe into the token the masks scan for, so
// "d'agreer" is one word here and the list holds "agreer". What stands before
// the apostrophe is an article or a pronoun, never a name, so the token is
// judged on what follows it.
function keptWords(profile) {
  const keep = new Set([...profile.salutationOpeners, ...profile.closingWords,
    ...profile.interjections, ...(profile.alwaysKept || [])]);
  return (word) => {
    const plain = word.toLowerCase().replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a');
    if (keep.has(plain)) return true;
    const elision = plain.lastIndexOf("'");
    return elision !== -1 && keep.has(plain.slice(elision + 1));
  };
}

// A familiar register drops the capital: "bises, marc" names someone as surely
// as "Bises, Marc". The last word of a line, standing after a comma and a word
// the language greets or signs with, is a name whatever its case. The line has
// to end there, so that "Madame, l'expression de mes sentiments" is left alone.
const NAME_AFTER_COMMA = /(\p{L}[\p{L}'-]*)(\s*,\s*)(\p{Ll}[\p{L}'-]*)[ \t]*$/gmu;

// Keeps the words the language greets and signs with, masks the rest of a
// salutation or of a signature, which is where a correspondent's name sits. The
// line is already known to be one or the other, so case carries no information
// on it and every word is read: a familiar register drops the capital, and
// "bonjour camille," names someone as surely as "Bonjour Camille,".
function maskNames(line, profile) {
  const kept = keptWords(profile);
  const out = line.replace(NAME_AFTER_COMMA, (whole, before, gap, word) => (
    kept(before) && !kept(word) ? before + gap + profile.masks.name : whole
  ));
  // This scan reads every word, capital or not, so it would read the word inside
  // a placeholder an earlier mask left and replace it again: [nom] would become
  // [[nom]], which no reader can undo. A placeholder is matched first and
  // returned as it stands.
  const placeholders = new Set(maskVocabulary(profile));
  const scan = new RegExp(`(?:${maskPattern(profile).source})|\\p{L}[\\p{L}'-]*`, 'gu');
  return out.replace(scan, (token) => {
    if (placeholders.has(token)) return token;
    return kept(token) ? token : profile.masks.name;
  });
}

// An elided word is one token to the scans above and two to the language, so it
// is known when the corpus writes every piece of it in lower case. That is what
// keeps "L'affaire" standing and lets "L'Orbanet" go.
function corpusWords(vocabulary, profile) {
  const known = vocabulary instanceof Set ? vocabulary : new Set();
  return (word) => {
    const parts = word.toLowerCase().match(profile.word) || [];
    return parts.length > 0 && parts.every((part) => known.has(part));
  };
}

// In a body, a capitalised word is a name unless the corpus itself vouches for
// it: a word this corpus writes at least once in lower case is a word of the
// language and stays wherever it stands, and one it only ever writes with a
// capital goes. Position is no evidence. A writer names a person at the head of
// a sentence as readily as inside one, and the first word of a wrapped line
// opens no sentence at all, so a rule that read the position both leaked every
// name after a full stop and masked "Il" and "Le" after a line break.
//
// The scan never consumes the character before a word, so that the second half of
// "Firstname Surname" is judged on what precedes it rather than on nothing.
function maskBody(text, profile, vocabulary) {
  const kept = keptWords(profile);
  const known = corpusWords(vocabulary, profile);
  return text.replace(/\p{Lu}[\p{L}'-]*/gu, (word) => (
    kept(word) || known(word) ? word : profile.masks.name
  ));
}

// Two letters and two check digits, then groups of four, every letter in either
// case: a bank identifier is typed in lower case as often as not, bank code
// included, and refusing a group of four lower case letters refused every
// British, Irish, Dutch and Maltese account. The prose guard is the count of
// figures, and a run of letters at the end of the match is the next word of the
// sentence, given back one at a time until something ending in a figure is left.
const IBAN = /\b[A-Za-z]{2}\d{2}(?:\s?[A-Za-z0-9]{4}){2,7}(?:\s?[A-Za-z0-9]{1,3})?\b/g;
const IBAN_TAIL = /\s+[A-Za-z]+$/;
const IBAN_DIGITS = 8;

function maskIbans(text, mask) {
  return text.replace(IBAN, (all) => {
    let head = all;
    let tail = IBAN_TAIL.exec(head);
    while (tail && tail.index > 0) {
      head = head.slice(0, tail.index);
      tail = IBAN_TAIL.exec(head);
    }
    return (head.match(/\d/g) || []).length >= IBAN_DIGITS ? mask + all.slice(head.length) : all;
  });
}

function maskPersonalData(text, profile) {
  return maskIbans(text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, profile.masks.email)
    .replace(/\bhttps?:\/\/\S+/g, profile.masks.url), profile.masks.iban)
    .replace(/\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g, profile.masks.phone)
    .replace(/\+?\d[\d .-]{7,}\d/g, profile.masks.phone)
    .replace(/\b\d{5,}\b/g, profile.masks.number);
}

function signoffFamilies(text, profile) {
  const tail = display(words(text, profile).slice(-SIGNOFF_WINDOW));
  return profile.signoffFamilies.filter((family) => family.match.test(tail)).map((family) => family.family);
}

// --- Tics -----------------------------------------------------------------

function countTic(tic, text, messageSentences, profile) {
  if (tic.kind === 'character') return countOf(text, tic.character);
  if (tic.kind === 'pattern') return (text.match(tic.pattern) || []).length;
  if (tic.kind === 'quotation') return countOf(text, '«') + Math.floor(countOf(text, '"') / 2);
  if (tic.kind === 'shout') return (text.match(/\b\p{Lu}{3,}\b/gu) || []).length;
  let found = 0;
  for (const sentence of messageSentences) {
    const tokens = words(sentence, profile);
    if (!tokens.length) continue;
    if (tic.kind === 'oneWordSentence' && tokens.length === 1) found += 1;
    if (tic.kind === 'sentenceStartsWith' && tic.words.includes(tokens[0])) found += 1;
    if (tic.kind === 'sentenceStartsWithInterjection' && profile.interjections.includes(tokens[0])) found += 1;
    if (tic.kind === 'sentenceStartsWithConnective' && profile.connectives.includes(tokens[0])) found += 1;
  }
  return found;
}

// --- N-grams --------------------------------------------------------------

const NGRAM_MINIMUM = { 2: 4, 3: 3 };
// An n-gram has to run at twice the rate the reference list gives it to count as
// the writer's own. One the list does not hold at all passes on its count.
const OVERUSE = 2;
// How many of each size analysis.json carries. A measurement can be asked for
// more, which is how a test looks past the head of the list at what a longer one
// would have held.
const NGRAM_LIMIT = 15;

function ngramsOf(tokenLists, size, reference, totalTokens, limit) {
  const counts = new Map();
  for (const tokens of tokenLists) {
    for (let i = 0; i + size <= tokens.length; i += 1) {
      bump(counts, display(tokens.slice(i, i + size)));
    }
  }

  const found = [];
  for (const [ngram, count] of counts) {
    if (count < NGRAM_MINIMUM[size]) continue;
    const per10k = rate(count, totalTokens, 10000);
    const referenceRate = reference[ngram] || 0;
    if (referenceRate && per10k < referenceRate * OVERUSE) continue;
    found.push({
      ngram,
      count,
      per_10k: per10k,
      reference_per_10k: referenceRate,
      times_the_reference: referenceRate ? round(per10k / referenceRate, 1) : null,
    });
  }
  return found.sort((a, b) => b.count - a.count || a.ngram.localeCompare(b.ngram)).slice(0, limit);
}

// The n-grams travel to the model in analysis.json, so they are counted on the
// masked body and not on the body itself. A correspondent, a town or an employer
// named mid-sentence is a name whatever its count, and a list asked to run longer
// than the fifteen entries the file carries would hand it over.
//
// The run of tokens is cut at every mask rather than carrying it: a placeholder is
// not a habit, and "[nom] passait" is nobody's turn of phrase. Cutting also keeps
// the two words that stood on either side of a name from meeting, since they were
// never next to each other.
// Both vocabularies, this file's and collect.js's: a run cut at [nom] and carried
// through [phone] would hand the model the placeholder as a turn of phrase.
function maskVocabulary(profile) {
  return [...new Set([...Object.values(profile.masks), ...COLLECT_MASKS])];
}

function maskPattern(profile) {
  const masks = maskVocabulary(profile)
    .map((mask) => mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(masks.join('|'), 'g');
}

function ngramRuns(body, profile, vocabulary) {
  return maskBody(maskPersonalData(body, profile), profile, vocabulary)
    .split(maskPattern(profile))
    .map((segment) => words(segment, profile))
    .filter((run) => run.length);
}

// --- One measurement block ------------------------------------------------

const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/;
const EMOJI = /\p{Extended_Pictographic}/gu;
const SENTENCE_BUCKETS = [
  ['<=10', (length) => length <= 10],
  ['11-20', (length) => length > 10 && length <= 20],
  ['21-30', (length) => length > 20 && length <= 30],
  ['31-45', (length) => length > 30 && length <= 45],
  ['>45', (length) => length > 45],
];

// Every word the corpus writes at least once in lower case. Taken on the bodies,
// after the personal data is masked and with the greeting and the closing
// already cut off: the local part of an address is written in lower case, so
// reading the raw text would let camille.berthier@example.org vouch for the
// surname it carries, and a letter signed "bises, camille" would vouch for the
// same name at the head of every sentence.
function vocabularyOf(records, profile) {
  const vocabulary = new Set();
  for (const record of records) {
    for (const word of maskPersonalData(record.body, profile).match(profile.word) || []) {
      if (word[0] === word[0].toLowerCase()) vocabulary.add(word.toLowerCase());
    }
  }
  return vocabulary;
}

// One record per sample, computed once and shared by the measurements and by
// the exemplars, so that both talk about the same message. In two passes: the
// bodies first, then the vocabulary of the whole corpus, which is what decides
// whether a capitalised word is a name. Every record carries the vocabulary of
// the corpus it was measured in, so that a group of records masks the way the
// whole does.
function prepare(samples, profile) {
  const records = samples.map((sample) => {
    const salutation = salutationOf(sample, profile);
    const signoff = signoffOf(sample, profile);
    // collect.js isolates a signature block of its own when there is one. It is
    // not body text, and it is not the closing formula either.
    const signature = typeof sample.signature === 'string' && sample.signature.trim()
      ? sample.signature.trim()
      : null;
    return {
      sample,
      salutation,
      signoff,
      signature,
      body: bodyOf(sample.text, salutation, signoff, signature),
    };
  });

  const vocabulary = vocabularyOf(records, profile);
  return records.map((record) => Object.assign(record, {
    vocabulary,
    tokens: words(record.body, profile),
    ngramTokens: ngramRuns(record.body, profile, vocabulary),
    sentences: sentences(record.body, profile),
    blocks: paragraphs(record.body),
  }));
}

function measure(records, profile, ngramLimit) {
  const limit = typeof ngramLimit === 'number' ? ngramLimit : NGRAM_LIMIT;
  const wordCounts = [];
  const sentencesPerMessage = [];
  const sentenceLengths = [];
  const paragraphsPerMessage = [];
  const paragraphLengths = [];
  const tokenLists = [];
  const salutations = new Map();
  const signoffs = new Map();
  const families = new Map();
  const emojis = new Map();
  const tics = new Map();
  const ticMessages = new Map();
  const punctuation = { comma: 0, semicolon: 0, colon: 0, parenthesis: 0, quotation: 0 };

  let totalWords = 0;
  let totalSentences = 0;
  let familiar = 0;
  let formal = 0;
  let mixed = 0;
  let noMarker = 0;
  let familiarTokens = 0;
  let formalTokens = 0;
  let withSalutation = 0;
  let withSignoff = 0;
  let withSignature = 0;
  let exclamations = 0;
  let questions = 0;
  let withExclamation = 0;
  let withDoubledExclamation = 0;
  let withQuestion = 0;
  let emojiCount = 0;
  let withEmoji = 0;
  let withList = 0;

  for (const record of records) {
    const body = record.body;
    const tokens = record.tokens;

    // The n-grams are counted on the masked runs, never on the body tokens.
    for (const run of record.ngramTokens) tokenLists.push(run);
    wordCounts.push(tokens.length);
    totalWords += tokens.length;
    sentencesPerMessage.push(record.sentences.length);
    totalSentences += record.sentences.length;
    for (const sentence of record.sentences) sentenceLengths.push(words(sentence, profile).length);
    paragraphsPerMessage.push(record.blocks.length);
    for (const block of record.blocks) paragraphLengths.push(words(block, profile).length);

    if (profile.secondPerson) {
      const familiarHere = tokens.filter((token) => profile.secondPerson.familiar.includes(token)).length;
      const formalHere = tokens.filter((token) => profile.secondPerson.formal.includes(token)).length;
      familiarTokens += familiarHere;
      formalTokens += formalHere;
      if (!familiarHere && !formalHere) noMarker += 1;
      else if (familiarHere === formalHere) mixed += 1;
      else if (familiarHere > formalHere) familiar += 1;
      else formal += 1;
    }

    if (record.salutation) {
      withSalutation += 1;
      bump(salutations, maskNames(record.salutation, profile));
    }
    if (record.signature) withSignature += 1;
    if (record.signoff) {
      withSignoff += 1;
      bump(signoffs, maskNames(record.signoff.replace(/\s*\n\s*/g, ' '), profile));
    }
    for (const family of signoffFamilies(record.sample.text, profile)) bump(families, family);

    const exclamationsHere = countOf(body, '!');
    const questionsHere = countOf(body, '?');
    exclamations += exclamationsHere;
    questions += questionsHere;
    if (exclamationsHere) withExclamation += 1;
    if (/!\s*!/.test(body)) withDoubledExclamation += 1;
    if (questionsHere) withQuestion += 1;

    const found = body.match(EMOJI) || [];
    emojiCount += found.length;
    if (found.length) withEmoji += 1;
    for (const emoji of found) bump(emojis, emoji);

    if (body.split('\n').filter((line) => LIST_LINE.test(line)).length >= 2) withList += 1;

    punctuation.comma += countOf(body, ',');
    punctuation.semicolon += countOf(body, ';');
    punctuation.colon += countOf(body, ':');
    punctuation.parenthesis += countOf(body, '(');
    punctuation.quotation += countOf(body, '"') + countOf(body, '«');

    for (const tic of profile.tics) {
      const count = countTic(tic, body, record.sentences, profile);
      if (!count) continue;
      bump(tics, tic.tic, count);
      bump(ticMessages, tic.tic, 1);
    }
  }

  const messages = records.length;
  const sentenceStats = stats(sentenceLengths);
  const distribution = {};
  for (const [name, inBucket] of SENTENCE_BUCKETS) {
    distribution[name] = pct(sentenceLengths.filter(inBucket).length, sentenceLengths.length);
  }

  const dates = records
    .map((record) => record.sample.date)
    .filter((date) => typeof date === 'string' && date)
    .sort();

  return {
    messages,
    date_range: dates.length ? dates[0] + ' to ' + dates[dates.length - 1] : null,
    words: stats(wordCounts),
    sentences: {
      total: totalSentences,
      median_per_message: percentile(sentencesPerMessage, 0.5),
      median_words: sentenceStats.median,
      mean_words: sentenceStats.mean,
      p90_words: percentile(sentenceLengths, 0.9),
      max_words: sentenceStats.max,
      distribution_pct: distribution,
    },
    paragraphs: {
      median_per_message: percentile(paragraphsPerMessage, 0.5),
      median_words: percentile(paragraphLengths, 0.5),
    },
    second_person: profile.secondPerson
      ? {
        familiar_messages: familiar,
        formal_messages: formal,
        mixed_messages: mixed,
        no_marker_messages: noMarker,
        familiar_pct: pct(familiar, messages),
        familiar_tokens_per_1000_words: rate(familiarTokens, totalWords, 1000),
        formal_tokens_per_1000_words: rate(formalTokens, totalWords, 1000),
      }
      : { applicable: false, note: 'This language draws no familiar and formal second person, so there is nothing to count.' },
    opening: {
      salutation_line_pct: pct(withSalutation, messages),
      no_salutation_pct: pct(messages - withSalutation, messages),
      top_salutations: top(salutations, 8).map(([form, count]) => ({ form, count })),
    },
    closing: {
      sign_off_pct: pct(withSignoff, messages),
      signature_pct: pct(withSignature, messages),
      families: top(families, 12).map(([family, count]) => ({ family, messages: count, pct: pct(count, messages) })),
      top_verbatim: top(signoffs, 8).map(([form, count]) => ({ form, count })),
    },
    exclamation: {
      marks_per_1000_words: rate(exclamations, totalWords, 1000),
      marks_per_100_sentences: rate(exclamations, totalSentences, 100, 1),
      messages_with_any_pct: pct(withExclamation, messages),
      messages_with_doubled_marks: withDoubledExclamation,
    },
    question: {
      marks_per_1000_words: rate(questions, totalWords, 1000),
      marks_per_100_sentences: rate(questions, totalSentences, 100, 1),
      messages_with_any_pct: pct(withQuestion, messages),
    },
    emoji: {
      per_1000_words: rate(emojiCount, totalWords, 1000),
      messages_with_any_pct: pct(withEmoji, messages),
      top: top(emojis, 8).map(([emoji, count]) => ({ emoji, count })),
    },
    lists: {
      messages_with_list: withList,
      pct: pct(withList, messages),
    },
    punctuation_per_1000_words: {
      comma: rate(punctuation.comma, totalWords, 1000),
      semicolon: rate(punctuation.semicolon, totalWords, 1000),
      colon: rate(punctuation.colon, totalWords, 1000),
      parenthesis: rate(punctuation.parenthesis, totalWords, 1000),
      quotation: rate(punctuation.quotation, totalWords, 1000),
    },
    tics_per_1000_words: top(tics, 20).map(([tic, count]) => ({
      tic,
      count,
      per_1000_words: rate(count, totalWords, 1000),
      messages_pct: pct(ticMessages.get(tic) || 0, messages),
    })),
    ngrams: {
      bigrams: ngramsOf(tokenLists, 2, profile.reference.bigrams, totalWords, limit),
      trigrams: ngramsOf(tokenLists, 3, profile.reference.trigrams, totalWords, limit),
    },
  };
}

// --- Exemplars ------------------------------------------------------------

const EXEMPLARS_PER_GROUP = 5;
const EXEMPLAR_WORDS = 120;

// A reviewed sample is one collect.js read through its folder adapter: a
// directory of letters the person corrected by hand, which no sent mail quite
// is. The adapter is what says so, never a weight on the sample, because a
// weight that multiplies a count is a number nobody can check. What the folder
// buys is a place in the queue, in two parts. Comparable length means anywhere
// between the first and the third quartile of its own group, which is the middle
// half of it rather than a tenth around the median: a reviewed letter in that
// range is quoted before a sent mail. And every group holding at least one
// reviewed letter quotes at least one, the reviewed letter closest to the median
// taking a guaranteed place. With five places per group, one guaranteed place
// makes the promise true without distorting how representative the five are.
const REVIEWED_ADAPTER = 'folder';

function isReviewed(sample) {
  return Boolean(sample) && sample.adapter === REVIEWED_ADAPTER;
}

// A reviewed letter inside the middle half of its group ranks as though it sat
// on the median: that is what 'quoted before a sent mail of comparable length'
// means. Outside that range it ranks on its distance like any other sample, so a
// very long or very short letter cannot pass itself off as a typical one.
function distanceToMedian(record, median, low, high) {
  const gap = Math.abs(record.tokens.length - median);
  if (!isReviewed(record.sample)) return gap;
  return record.tokens.length >= low && record.tokens.length <= high ? 0 : gap;
}

// The extract is cut between paragraphs, never inside one, so that what is
// quoted is a real run of the writer's sentences.
// The greeting and the closing are the two places a correspondent's name sits,
// and on both every word that is not a greeting or a closing word is a name
// whatever its case. They take that stricter mask; everything between them takes
// the one that asks the corpus.
function maskExtract(blocks, profile, vocabulary) {
  const last = blocks.length - 1;
  return blocks.map((block, index) => {
    if (index === last && index > 0 && words(block, profile).length <= SIGNOFF_WORDS) {
      return maskNames(block, profile);
    }
    const lines = block.split('\n');
    if (index !== 0 || !qualifiesAsSalutation(lines[0].trim(), profile)) {
      return maskBody(block, profile, vocabulary);
    }
    const rest = lines.slice(1).join('\n');
    return [maskNames(lines[0], profile), rest && maskBody(rest, profile, vocabulary)]
      .filter(Boolean).join('\n');
  });
}

function extractOf(sample, profile, vocabulary) {
  const masked = maskPersonalData(sample.text, profile);
  const blocks = maskExtract(paragraphs(masked), profile, vocabulary);
  const kept = [];
  let length = 0;
  for (const block of blocks) {
    const size = words(block, profile).length;
    if (kept.length && length + size > EXEMPLAR_WORDS) break;
    kept.push(block);
    length += size;
    if (length >= EXEMPLAR_WORDS) break;
  }
  return { text: kept.join('\n\n'), words: length, cut: kept.length < blocks.length };
}

// Five per group, the five sitting closest to the median length of their own
// group, so that no extract flatters the corpus by being unusually short or
// unusually grand.
function exemplarsFor(records, profile) {
  const lengths = records.map((record) => record.tokens.length);
  const median = percentile(lengths, 0.5);
  const low = percentile(lengths, 0.25);
  const high = percentile(lengths, 0.75);
  const comparable = (record) => record.tokens.length >= low && record.tokens.length <= high;

  const ranked = records
    .slice()
    .sort((a, b) => (
      distanceToMedian(a, median, low, high) - distanceToMedian(b, median, low, high)
      || (isReviewed(b.sample) && comparable(b) ? 1 : 0) - (isReviewed(a.sample) && comparable(a) ? 1 : 0)
      || Math.abs(a.tokens.length - median) - Math.abs(b.tokens.length - median)
      || b.tokens.length - a.tokens.length
    ));

  // The guaranteed place, taken before the ranking is read: the reviewed letter
  // nearest the median of its group, wherever the ranking would have put it.
  const reviewed = ranked
    .filter((record) => isReviewed(record.sample))
    .sort((a, b) => Math.abs(a.tokens.length - median) - Math.abs(b.tokens.length - median))[0];
  const chosen = reviewed ? [reviewed, ...ranked.filter((record) => record !== reviewed)] : ranked;

  return chosen
    .slice(0, EXEMPLARS_PER_GROUP)
    .map((record) => {
      const extract = extractOf(record.sample, profile, record.vocabulary);
      return {
        date: record.sample.date || null,
        surface: record.sample.surface || null,
        register: record.sample.register || null,
        reviewed: isReviewed(record.sample),
        body_words: record.tokens.length,
        quoted_words: extract.words,
        cut: extract.cut,
        text: extract.text,
      };
    });
}

function quote(text) {
  return text.split('\n').map((line) => (line.trim() ? '> ' + line : '>')).join('\n');
}

function renderExemplars(analysis, groups) {
  const lines = [
    '# Exemplars',
    '',
    'Up to ' + EXEMPLARS_PER_GROUP + ' extracts per register and per surface, drawn from the '
      + analysis.corpus.samples + ' samples measured in `analysis.json`. Each one comes from a message at or'
      + ' near the median length of its own group, so that no extract flatters the corpus by being'
      + ' unusually short or unusually grand.',
    '',
    '**How to read a heading.** The group, then the date, then `reviewed` when the sample comes from the'
      + ' folder of letters the person corrected by hand, then the length of the message body in words, then'
      + ' the length of the extract. A reviewed letter of comparable length is quoted before a sent mail, and every group holding one quotes at least one.'
      + ' The extract itself keeps the greeting and the closing, which the body count leaves out. `[...]`'
      + ' marks a cut, always made between two paragraphs.',
    '',
    '**Depersonalisation.** Addresses, telephone numbers, bank identifiers, links and long reference'
      + ' numbers are replaced by a bracketed word wherever this pass recognises one. On the greeting line and on the closing, where a'
      + ' correspondent is named by construction, every word that is not a greeting or a closing word'
      + ' goes, whatever its case. Everywhere else the rule is the corpus: a capitalised word this'
      + ' corpus never writes in lower case anywhere else is replaced, at the head of a sentence as'
      + ' readily as inside one. That rule does not reach a name the corpus also writes in lower case'
      + ' somewhere, a first name that doubles as a common word or a firm written both ways, nor a'
      + ' name typed without its capital in the body. Read an extract before quoting it. A bracketed'
      + ' word standing inside a sentence is that mask and not a word the writer chose: describe the'
      + ' passage rather than quoting it whole.',
    '',
    '**Typography.** These extracts carry the characters of the typography table, not the ones the'
      + ' mail client sent. See `typographic_base` in `analysis.json` for what was rewritten and how'
      + ' often: none of it says anything about how this person writes.',
    '',
  ];

  for (const group of groups) {
    if (!group.exemplars.length) continue;
    lines.push('---', '', '## ' + group.kind + ': ' + group.key, '');
    lines.push(group.messages + (group.messages === 1 ? ' message' : ' messages')
      + '. Median ' + group.median + ' words.', '');
    group.exemplars.forEach((exemplar, index) => {
      const parts = [group.key];
      if (exemplar.date) parts.push(exemplar.date);
      if (exemplar.reviewed) parts.push('reviewed');
      lines.push('#### ' + (index + 1) + '. ' + parts.join(', ') + '. Body ' + exemplar.body_words
        + ' words; extract ' + exemplar.quoted_words + ' words.');
      lines.push('');
      lines.push(quote(exemplar.text));
      if (exemplar.cut) lines.push('>', '> [...]');
      lines.push('');
    });
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// --- Inputs and the register table ----------------------------------------

// One input document is one run of collect.js. An array of them is read as what
// it is, so the two mailboxes the setup asks for and the folder of reviewed
// letters reach one measurement instead of three. A document is stamped onto the
// samples it holds: a sample that carries no adapter and no mailbox tag of its
// own takes the ones its document declares.
function stamp(sample, entry) {
  const out = Object.assign({}, sample);
  if (!out.adapter && typeof entry.adapter === 'string') out.adapter = entry.adapter;
  if (!out.mailbox && typeof entry.tag === 'string') out.mailbox = entry.tag;
  return out;
}

function readDocument(entry) {
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    source: text(entry.source),
    lang: text(entry.lang),
    adapter: text(entry.adapter),
    tag: text(entry.tag),
    samples: (Array.isArray(entry.samples) ? entry.samples : [])
      .filter((sample) => sample && typeof sample.text === 'string' && sample.text.trim())
      .map((sample) => stamp(sample, entry)),
  };
}

function readInputs(input) {
  const entries = Array.isArray(input) ? input : [input];
  const documents = [];
  let bare = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry.samples)) {
      documents.push(readDocument(entry));
      continue;
    }
    // A bare array of samples: one document with no name of its own.
    if (typeof entry.text !== 'string' || !entry.text.trim()) continue;
    if (!bare) {
      bare = { source: null, lang: null, adapter: null, tag: null, samples: [] };
      documents.push(bare);
    }
    bare.samples.push(entry);
  }
  return documents;
}

// The one value a whole document agrees on, or nothing.
function shared(values, fallback) {
  const set = new Set(values.filter((value) => typeof value === 'string' && value));
  return set.size === 1 ? [...set][0] : (fallback || null);
}

// What the corpus block says about one input. A document that contributed no
// sample is listed at zero rather than left out: an export that turned out empty
// is a thing to see, not a thing to discover later from a total that is short.
function sourceEntry(document) {
  const adapter = shared(document.samples.map((sample) => sample.adapter), document.adapter);
  return {
    source: document.source,
    mailbox: shared(document.samples.map((sample) => sample.mailbox), document.tag),
    adapter,
    reviewed: adapter === REVIEWED_ADAPTER,
    samples: document.samples.length,
  };
}

// The register table, the format skills/setup/SKILL.md hands the subject: a flat
// JSON map from a recipient pattern or a sample id to a register name.
//
//   { "*.gouv.fr": "administration",
//     "urssaf.fr": "administration",
//     "work-0041": "clients" }
//
// A key holding a dot or a star is a recipient domain pattern, matched against
// recipient_domain, and "*." at its head means the domain itself or any
// subdomain of it. Any other key is a sample id, the one collect.js wrote. The
// first entry that matches a sample wins, in the order the file lists them. It
// is data and not judgement: it says where a sample belongs, and it replaces the
// guess collect.js made before anything here is measured. A sample no entry
// matches keeps that guess.
function ruleFor(pattern, register) {
  const domain = pattern.includes('.') || pattern.includes('*');
  if (!domain) {
    return { pattern, on: 'id', register, matches: (sample) => sample.id === pattern };
  }
  const wanted = pattern.toLowerCase();
  const suffix = wanted.startsWith('*.') ? wanted.slice(2) : null;
  return {
    pattern,
    on: 'domain',
    register,
    matches(sample) {
      const value = typeof sample.recipient_domain === 'string'
        ? sample.recipient_domain.toLowerCase() : '';
      if (!value) return false;
      if (suffix === null) return value === wanted;
      return value === suffix || value.endsWith('.' + suffix);
    },
  };
}

function readRegisterTable(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the register table is not a JSON object mapping a recipient pattern'
      + ' or a sample id to a register name');
  }
  return Object.entries(value).map(([pattern, register]) => {
    const key = pattern.trim();
    if (!key) throw new Error('the register table holds an entry with no pattern and no sample id');
    if (typeof register !== 'string' || !register.trim()) {
      throw new Error('the register table gives "' + key + '" no register name');
    }
    return ruleFor(key, register.trim());
  });
}

// Applied before anything is measured, so that every figure below is a figure
// about the registers the person settled rather than about the ones collect.js
// guessed. Every entry reports what it matched, so that one matching nothing is
// visible in analysis.json instead of quietly doing nothing.
function assignRegisters(samples, table) {
  if (!table) return { samples, report: null };
  const counts = table.map(() => 0);
  let assigned = 0;
  const out = samples.map((sample) => {
    const at = table.findIndex((rule) => rule.matches(sample));
    if (at === -1) return sample;
    counts[at] += 1;
    assigned += 1;
    return Object.assign({}, sample, { register: table[at].register });
  });
  return {
    samples: out,
    report: {
      rules: table.map((rule, index) => ({
        pattern: rule.pattern,
        on: rule.on,
        register: rule.register,
        samples: counts[index],
      })),
      samples_assigned: assigned,
      samples_kept_their_guess: samples.length - assigned,
    },
  };
}

// --- The pass -------------------------------------------------------------

const METHOD = {
  unit: 'one sample as collect.js wrote it, quoted replies and forwarded blocks already removed. The greeting line and the closing paragraph are measured on their own, in opening and closing, and taken out of the body first: every other number on this page is a number about the body.',
  words: 'in French an apostrophe ends an elided word, so "l\'art" is two tokens and the bigram "je t\'" is visible as itself; in English a contraction and a possessive keep their apostrophe and stay one token. A hyphenated word is one token in both, a token starts with a letter, and a figure is not a word.',
  sentences: 'cut inside a line on . ! and ?, with a guard for abbreviations and for initials; an item of a list that carries no full stop counts as one sentence',
  second_person: 'counts of the familiar and of the formal pronouns and possessives; a message is filed under whichever count is the larger, and under mixed when they are equal and not zero. Reported as not applicable for a language that draws no such distinction.',
  salutation: 'a first line of at most ' + SALUTATION_WORDS + ' words that either ends on a comma or a colon or opens on a word the language greets with. Capitalised words that are not greeting or closing words are masked before counting, so two letters to two people count as the same form. A header line a collector left behind, one word and a colon, is stepped over rather than read as a greeting.',
  sign_off: 'the sign-off collect.js isolated when it did, and otherwise the last paragraph when it runs to ' + SIGNOFF_WORDS + ' words or fewer, verbatim and masked; a signature block is counted in signature_pct and never quoted. Families are matched over the last ' + SIGNOFF_WINDOW + ' words of the message, and one message can carry more than one family',
  ngrams: 'raw counts over the group, taken on the body with every name masked out and the run of tokens cut at each mask, so that neither a correspondent nor a placeholder can be characteristic. A name here is a capitalised word the corpus never writes in lower case anywhere, whatever its position in the sentence; the rate is still figured over every word of the body. Kept when they reach ' + NGRAM_MINIMUM[2] + ' occurrences for a bigram and ' + NGRAM_MINIMUM[3] + ' for a trigram, and when they run at ' + OVERUSE + ' times or more the rate an embedded reference list gives them. That list is short and approximate, a floor and not a reference corpus: it holds n-grams that are common in the language at large, so that characteristic means the writer uses it more than the language does, not that the language is rare.',
  typography: 'counted on the text as it arrived, before any other measurement, and reported in typographic_base alone. The count covers every class of the table, the dashes the command reports rather than replaces included, because what is measured here is a corpus and not a draft: what a mail client or a typographer put in has no reason to stop at what a program can repair by itself. Every measurement above runs on the normalized text, and the extracts pass through the whole table too, so that the profile they land in carries none of these characters.',
  weights: 'every sample counts once, a folder of reviewed letters included: no sample is weighted, because a weight that multiplies a count is a number nobody can check. What a reviewed letter buys is a place in the queue of extracts, not a place in a total: anywhere between the first and the third quartile of its own group it is quoted before a sent mail, and every group holding at least one reviewed letter quotes at least one.',
  registers_assigned: 'the register on a sample is the one collect.js guessed, unless an entry of the table passed with --registers matched it, in which case the table won and the guess was dropped before anything here was measured. register_table in the corpus block reports every entry with the number of samples it matched, so that an entry matching nothing is visible rather than silent.',
  sources: 'several documents are measured together, one per run of collect.js. by_source counts them one by one, an input that contributed nothing included, so that a provenance line can say how many samples came from each and no export is assumed to have worked.',
  limits: [
    'A register and a surface are what collect.js guessed, then what the register table assigned where it matched, then what the person corrected. A group of two messages is measured like a group of two hundred, and reads as a number all the same: look at messages before believing a rate.',
    'The reference n-gram list is short and approximate. It rules out what is merely common in the language; it does not rank the rest against ordinary usage.',
    'Depersonalisation here is the second net, not the first: collect.js masks personal data before this pass reads anything. What the rule cannot catch, in an extract and in an n-gram alike, is a proper noun the corpus also writes in lower case somewhere else, a first name that doubles as a common word or a brand written both ways, and a name typed without its capital anywhere but the greeting and the closing, where every word that is not a greeting or a closing word is masked whatever its case. Nor does it catch a fragment of an identifier too short to be recognised as one, a country code and a bank code with no account behind them.',
    'A sign-off that runs to more than ' + SIGNOFF_WORDS + ' words is read as body text, and a signature block the collector did not strip is read as a paragraph.',
    'corpus.register_table echoes the entries of the table as they were written, including the ones that matched no sample, and an entry is either a sample id or a recipient domain. That is the one place in this file where a correspondent is named, and it is named by the person who wrote the table.',
  ],
};

const READING_NOTES = {
  what_this_file_is: 'The measurement pass over one collection of samples, so that every trait written into a VOICE.md can point back at a number or at a quotation.',
  registers_are_relational: 'A register is a relation to a recipient, never a person. The one thing here that names a recipient is corpus.register_table, which echoes the patterns the person wrote into the register table so that an entry matching nothing is visible rather than silent: a recipient domain written there is written here. Nothing else in this file records who was written to. A name standing inside a measured form or inside an extract is masked by the rule method.ngrams states, a capitalised word the corpus never writes in lower case anywhere; what that rule does not reach is written out under method.limits.',
  voice_flag: 'This file measures. It does not set voice: on or voice: off. That flag is declared by the person, proposed by kind and confirmed at the presentation step.',
};

function groupBy(records, key, fallback) {
  const groups = new Map();
  for (const record of records) {
    const value = record.sample[key];
    const name = typeof value === 'string' && value ? value : fallback;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(record);
  }
  return groups;
}

// analyse(input, options) -> { analysis, exemplars }. Pure: it reads no file and
// writes none, which is what lets a test hold it to a number.
function analyse(input, options) {
  const settings = options || {};
  const documents = readInputs(input);
  const declared = documents.map((document) => document.lang).filter(Boolean);
  const lang = settings.lang || declared[0] || DEFAULT_LANG;
  const profile = profileFor(lang);

  // The table wins over the guess, and it wins here, before a single word is
  // counted, so that no figure below belongs to a register nobody kept.
  const table = readRegisterTable(settings.registers);
  const assignment = assignRegisters(
    documents.reduce((all, document) => all.concat(document.samples), []),
    table
  );
  const samples = assignment.samples;

  const raw = samples.map((sample) => sample.text);
  // Voice is measured on the normalized text, so that a curly apostrophe cannot
  // split a word in two and a no-break space cannot glue two together.
  const normalized = samples.map((sample) => {
    const out = Object.assign({}, sample, { text: normalize(sample.text, lang, EVERY_CLASS).text });
    if (typeof sample.salutation === 'string') out.salutation = normalize(sample.salutation, lang, EVERY_CLASS).text;
    if (typeof sample.signoff === 'string') out.signoff = normalize(sample.signoff, lang, EVERY_CLASS).text;
    return out;
  });

  const records = prepare(normalized, profile);

  const mailboxes = {};
  const domains = new Set();
  for (const sample of normalized) {
    const mailbox = sample.mailbox || 'unknown';
    mailboxes[mailbox] = (mailboxes[mailbox] || 0) + 1;
    if (sample.recipient_domain) domains.add(sample.recipient_domain);
  }

  const overall = measure(records, profile);
  const groups = [];

  function section(kind, key, list) {
    const block = measure(list, profile);
    groups.push({
      kind,
      key,
      messages: list.length,
      median: block.words.median,
      exemplars: exemplarsFor(list, profile),
    });
    return Object.assign({ key, share_of_corpus_pct: pct(list.length, records.length) }, block);
  }

  const byCount = (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]);
  const registers = [...groupBy(records, 'register', 'unclassified').entries()]
    .sort(byCount)
    .map(([key, list]) => section('Register', key, list));
  const surfaces = [...groupBy(records, 'surface', 'unclassified').entries()]
    .sort(byCount)
    .map(([key, list]) => section('Surface', key, list));

  const sources = documents.map((document) => document.source).filter(Boolean);

  const analysis = {
    corpus: {
      lang,
      // Where the language came from, and whether a profile was written for it.
      // Measured as English is not the same thing as being English, and nothing
      // else in these two files tells the two apart.
      lang_source: settings.lang ? 'given' : (declared.length ? 'declared' : 'defaulted'),
      profile: PROFILES[lang] ? lang : 'generic',
      source: sources.length ? sources.join(', ') : null,
      samples: records.length,
      words_measured: overall.words.total,
      date_range: overall.date_range,
      by_mailbox: mailboxes,
      // Per source as well as per mailbox tag, so that a provenance line can say
      // how many came from each: 412 emails (work), 233 (personal), 6 letters
      // (validated). An input that gave nothing is here too, at zero.
      by_source: documents.map(sourceEntry),
      recipient_domains: domains.size,
      surfaces: surfaces.map((surface) => surface.key),
      registers: registers.map((register) => register.key),
      register_table: assignment.report,
    },
    reading_notes: READING_NOTES,
    typographic_base: typographicBase(raw, lang),
    overall,
    registers,
    surfaces,
    method: METHOD,
  };

  return { analysis, exemplars: renderExemplars(analysis, groups) };
}

// --- Command line ---------------------------------------------------------

const USAGE = [
  'voice.md stylometry',
  '',
  '  node scripts/stylometry.js <samples.json> [<samples.json> ...]',
  '                             [--out <directory>] [--lang <code>] [--registers <table.json>]',
  '',
  '  samples.json   what collect.js wrote: { lang, source, samples: [ { text, ... } ] }.',
  '                 Give one file per run of collect: the mailboxes and the folder of',
  '                 reviewed letters belong to one measurement, and every file is read.',
  '  --out          where to write analysis.json and exemplars.md; the directory of the',
  '                 first samples file by default',
  '  --lang         override the language the samples files declare',
  '  --registers    a JSON table mapping a recipient pattern or a sample id to a register',
  '                 name, which replaces the register collect.js guessed',
  '',
  '  Only analysis.json and exemplars.md are meant to be read by a model. The',
  '  samples stay on the machine.',
].join('\n');

function parseArgs(argv) {
  const options = { lang: null, out: null, registers: null, inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang') { i += 1; options.lang = argv[i] || null; }
    else if (arg.startsWith('--lang=')) options.lang = arg.slice('--lang='.length);
    else if (arg === '--out') { i += 1; options.out = argv[i] || null; }
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg === '--registers') { i += 1; options.registers = argv[i] || null; }
    else if (arg.startsWith('--registers=')) options.registers = arg.slice('--registers='.length);
    // Every other argument is a samples file. Reading one and dropping the rest
    // in silence is the one thing this command must never do.
    else options.inputs.push(arg);
  }
  return options;
}

function readJson(file, writeError) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    writeError(file + ': cannot be read as JSON');
    return null;
  }
}

function runCli(argv, write, writeError) {
  const options = parseArgs(argv);
  if (!options.inputs.length) {
    write(USAGE);
    return 0;
  }

  const inputs = [];
  for (const file of options.inputs) {
    const read = readJson(file, writeError);
    if (!read) return 1;
    inputs.push(read.value);
  }

  let registers = null;
  if (options.registers) {
    const read = readJson(options.registers, writeError);
    if (!read) return 1;
    // Read here rather than left to analyse, so that a table the format refuses
    // is one line naming the table rather than one naming the output directory.
    try {
      readRegisterTable(read.value);
    } catch (err) {
      writeError(options.registers + ': ' + err.message);
      return 1;
    }
    registers = read.value;
  }

  const documents = readInputs(inputs);
  const counted = documents.reduce((total, document) => total + document.samples.length, 0);
  if (!counted) {
    writeError(options.inputs.join(', ') + ': holds no sample with any text');
    return 1;
  }

  const langs = [...new Set(documents.map((document) => document.lang).filter(Boolean))];
  if (!options.lang && langs.length > 1) {
    writeError('these inputs declare more than one language (' + langs.join(', ')
      + '); measuring them all as ' + langs[0] + '. Pass --lang to settle it.');
  }
  // The case the setup creates, where nothing used to be said: one language
  // everywhere in the inputs and --lang naming another, because a block was run
  // with the language of the example still in it. The measurement obeys the
  // flag, and the line is what a model needs to see to catch its own paste.
  if (options.lang && langs.length === 1 && langs[0] !== options.lang) {
    writeError('these inputs declare ' + langs[0] + '; measuring them as '
      + options.lang + ' because --lang says so.');
  }

  const out = options.out || path.dirname(path.resolve(options.inputs[0]));
  const analysisPath = path.join(out, 'analysis.json');
  const exemplarsPath = path.join(out, 'exemplars.md');
  try {
    const { analysis, exemplars } = analyse(inputs, { lang: options.lang, registers });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
    fs.writeFileSync(exemplarsPath, exemplars);
    write(analysis.corpus.samples + ' samples, ' + analysis.corpus.words_measured
      + ' words, lang ' + analysis.corpus.lang
      + (documents.length > 1 ? ', from ' + documents.length + ' sources' : ''));
  } catch (err) {
    writeError(out + ': ' + err.message);
    return 1;
  }

  write(analysisPath);
  write(exemplarsPath);
  return 0;
}

module.exports = {
  PROFILES, DEFAULT_LANG, profileFor, NGRAM_LIMIT,
  words, display, paragraphs, sentences, percentile, stats,
  typographicBase, salutationOf, signoffOf, bodyOf, signoffFamilies,
  maskNames, maskBody, maskPersonalData, maskVocabulary, vocabularyOf,
  ngramRuns, ngramsOf, prepare, measure, exemplarsFor, renderExemplars, analyse,
  readInputs, sourceEntry, readRegisterTable, assignRegisters, isReviewed,
  parseArgs, runCli, USAGE, METHOD,
};

if (require.main === module) {
  process.exitCode = runCli(
    process.argv.slice(2),
    (text) => process.stdout.write(text + '\n'),
    (text) => process.stderr.write(text + '\n')
  );
}
