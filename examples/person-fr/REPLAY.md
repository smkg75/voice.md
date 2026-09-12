# Replaying this example

`VOICE.md` next to this file was not written by hand. Every figure in it was
printed by the two scripts of this repository over 200 letters of a public
domain correspondence, and this file is how to print them again.

The corpus is not stored here. It is 200 letters of the Conard edition of
Flaubert's `Correspondance` as French Wikisource transcribes it, and it is
downloaded again on every replay.

Node 18 or later, no dependency. From this directory:

```
node prepare.js /tmp/person-fr
node ../../scripts/collect.js folder /tmp/person-fr/letters --tag lettres --lang fr --out /tmp/person-fr/samples.json
node ../../scripts/stylometry.js /tmp/person-fr/samples.json --registers /tmp/person-fr/registers.json --out /tmp/person-fr
```

The first command makes about 200 requests to `fr.wikisource.org`, half a second
apart, and prints nothing until it is done. Allow twenty to thirty minutes.

The run behind the file as it stands: 200 samples, 112 132 words, 7 990
sentences, five registers of 52, 50, 44, 41 and 13 letters. Read
`/tmp/person-fr/analysis.json` and `/tmp/person-fr/exemplars.md`: every figure
and every quotation in `VOICE.md` comes from one of the two.

## The fetch

`prepare.js` calls the MediaWiki API of `fr.wikisource.org`, one request at a
time, half a second apart.

1. `action=query&list=allpages` under `Correspondance de Gustave Flaubert/Tome N/`
   for each of the seven volumes, keeping the pages whose last path segment is a
   number. Those are the letters.
2. 29, 29, 29, 29, 28, 28 and 28 of them, evenly spaced over each volume with
   both ends kept, which is 200 letters spread over fifty years rather than the
   two hundred the site happens to list first.
3. `action=parse` on each, then the tags, the scripts, the tables and the
   footnote markers out of the HTML.

Wikisource is edited, and the picks are taken by index over the list the site
returns, so a replay is not a run of the same corpus with a figure nudged. One
page added to a volume moves about half that volume's picks onto other letters.
A pick that lands on a correspondent `recipients.json` does not hold stops
`prepare.js` with `recipients.json places nobody named X` and nothing is
written: add that heading to `recipients.json` under the relation that fits, and
run it again.

## The cleaning

The letters land in `/tmp/person-fr/letters` as plain text, one file per letter,
named `<volume>-<number>.txt`. Three kinds of editorial furniture go first,
because they belong to the 1927 edition and not to the writer, and because a
folder of plain text has no way to tell the collector about any of them:

- the heading that names the recipient, which `prepare.js` keeps for the table
  below and never writes into the corpus;
- the editor's notes hanging under a letter, each opening with `U+2191`, and
  everything after the first of them: 85 letters of the 200 carry some;
- the question mark the editor sets inside a conjectural dateline, `[1836 ?]`,
  with the space French typography puts before it. It marks the editor's doubt
  about a date, not a question the writer asked, and counting it puts three
  letters that ask nothing into the count of the letters that ask something.
  Nine datelines carry one.

Nothing else is touched: the place and date line, the greeting, the closing and
the signature are all measured, and `collect.js` separates them itself.

## The table

`collect.js` can guess a register from a recipient's mail domain, and a folder
of letters has none. With no domain to read, it falls back to counting tu
against vous, which here gives 126 personal and 74 professional: the
second-person split of the corpus over again, not the five relations this
correspondence runs on.

So `recipients.json` holds them, and `prepare.js` turns it into the
`registers.json` that `stylometry.js` reads with `--registers`, which replaces
the guess before anything is measured:

- `register_of` maps a recipient heading, verbatim from the edition, to one of
  the five register names. The correspondents are historical figures in a
  public domain edition, so naming them here costs nothing.
- `same_as` resolves the headings that only say "the same one". Their antecedent
  is a letter the 200-letter sample skipped, so each is settled by reading the
  letter, and written down rather than inferred at measuring time.
- `prepare.js` keys the result by sample id, `lettres-0001` and up, because
  `collect.js` numbers samples in the sorted order of the file names, which is
  the sorted order of `<volume>-<number>`.

`analysis.json` reports the table back under `corpus.register_table`, one line
per entry with the number of samples it matched, so an entry matching nothing
shows up instead of quietly doing nothing. On this corpus every entry matches
and `samples_kept_their_guess` is 0.

`VOICE.md` names none of these people. A register there is a relation to a kind
of recipient, which is all an agent writing a draft needs, and all the format
allows.
