# VOICE.md Format

VOICE.md is a self-contained, plain-text description of how one person, brand or
project writes, addressed to agents. It records the constants of someone's
writing, the traits that make a draft recognizably theirs, the way both shift by
recipient and by channel, and the procedure for using all of that on a real
draft.

A VOICE.md file has two layers. The YAML front matter carries the few
machine-readable facts a tool needs to parse and route the file: whose voice it
is, what kind of author it describes, what language it is written in. The
markdown body carries the voice itself, in prose, in that language.

The file is read by an agent that is about to draft something the subject will
send or publish as themselves: an email, a letter, a message, an answer in a
form. It is not read to write code, and it is never applied to the agent's own
replies.

## Reading this document

**MUST** and **MUST NOT** mark what a valid file satisfies. **SHOULD** marks
what a good file does anyway, and what a valid file may still leave out. **MAY**
marks a choice left to the author.

The format separates *invalid* from *unmeasured*: only a MUST decides validity,
and an honest thin profile is a valid file with nothing measured in it yet. A
consumer MAY apply an invalid file, and [Consumer behavior](#consumer-behavior)
gives one reading for each such case, so a broken file degrades in one defined
way.

This document applies the format's own typography rule to itself: it names
characters (`U+2014`) and never prints them.

## The standalone rule

Everything else in this specification follows from one constraint: **a VOICE.md
file is complete on its own.** It has to work pasted naked into a chat window,
with no repository around it, no tool installed, no copy of this specification
in context, and no other VOICE.md to fall back on.

So the format states, normatively:

- **No inheritance.** A file never derives from, extends, or overrides another:
  no base profile, no team profile, no `extends:` key.
- **No external references.** A file never defers to this specification, to a
  tool, to a URL, or to a section elsewhere; every instruction is in the file.
- **Complete alone.** Everything this specification requires is decidable from
  that one file's bytes, never from the folder it sits in.
- **One file, one voice.** A file describes exactly one author, named in `name`.
  A file that covers a person and their company is two files.

Repetition between two files is the price: a profile that says the mechanics are
inherited from the team file is worth nothing in a chat window.

## Where a file lives

A consumer looks for a profile in this order, and applies the first it finds:

1. An explicit designation: a path passed in the request, or a profile the user
   names.
2. The nearest file walking up from where the text is destined, the folder of
   the file being written, otherwise the current repository. At each level,
   `VOICE.md` first, then `.agents/VOICE.md`.
3. `~/.agents/VOICE.md`.

Nothing is merged along the way: the first file found is the whole profile.

## File shape

```
<YAML front matter>             required
<H1 title>                      optional, not a section
<provenance block quotation>    SHOULD be present
<sections, in the order below>
```

The front matter block begins with a line containing exactly `---` and ends
with one containing exactly `---`. Sections use `##` headings. Entries inside
Registers and Surfaces use `###`, and a `####` under one of those is content of
the entry above it, not a new entry. An `#` title may appear for display and is
not parsed as a section. HTML comments are ignored wherever they appear.

The preamble, between the front matter and the first `##`, carries the
provenance quotation. Anything else there is content the format never applies.

## Front matter

```yaml
---
name: <string>                        # required
kind: person | brand | project        # required
lang: fr | en | ...                   # required, short BCP 47
version: 1                            # optional
updated: 2026-09                      # optional, YYYY-MM
typography:                           # optional, one line per class
  Dashes: replace
---
```

| Field | Required | What it carries |
|:--|:--|:--|
| `name` | yes | Whose voice this is. |
| `kind` | yes | `person`, `brand` or `project`. Sets the default register names below. |
| `lang` | yes | The language the file is written in and the language of the drafts it governs. Drives the quote convention and any per-language analysis. |
| `version` | no | Format version. `1` today. |
| `updated` | no | `YYYY-MM`. More than twelve months old means the profile is due for a reread. |
| `typography` | no | One line per class of the [typography table](#typography), `replace` or `keep`. |

The front matter MUST be present, with `name`, `kind` and `lang` in it, and
`kind` MUST be `person`, `brand` or `project`. No other keys are defined.

**`name`** matters more than it looks: two profiles end up in one chat, and
without a name on each the agent blends them. The subject's own name is not
personally identifying information; the rule below is about correspondents.

**`kind`** changes exactly one thing, which registers a setup proposes by
default: a `person` file with no `voice: off` register is still valid.

**`lang`** is the only field that changes what a correct file looks like: a `fr`
file is written in French throughout, and its double quotes are the French pair.
It is also the language of the drafts the file governs: an author who writes in
two languages has two files, one per `lang`. Asked for a draft in another
language with only this file, an agent keeps Mechanics and the register, weighs
the Voice traits as unmeasured there, and says so. `lang` MUST be well-formed;
every rule of the file's form but the quote convention is language-independent.

**`version`** is the version of *this format*, not a revision counter for the
profile; that is `updated`, the only date the format reads. The provenance line
usually restates that month in prose; if the two disagree, the front matter
governs.

**`typography`** is the one key a tool acts on rather than a reader. Under it,
each key is a class name from the [typography table](#typography) and each value
is `replace` or `keep`: `replace` rewrites that class, `keep` leaves it alone and
says nothing about it. A class not named keeps the nature the table gives it, and
the key absent is the whole table as written. A profile never redefines the code
points of a class; it says which of the table's classes apply to the text it
governs, and a normalizer reads it from the profile it resolved, the way it reads
`lang`. It changes nothing about the file itself: the typography rule above holds
whatever this key says.

## The provenance line

A block quotation sits between the front matter and the first `##` heading, and
says what the file was built from:

```
> Built from 412 emails (work), 233 emails (personal), 6 letters · en · updated 2026-09
```

It carries, in this order: the sources and how many samples each contributed,
the language, and the date of the last update. The separator is the middle dot
`U+00B7`. The line is content, written in `lang`; the second file below was
declared rather than measured, and says so with the figure zero:

```
> Construit à partir de 200 lettres, Correspondance, Wikisource · fr · mis à jour 2026-09

> Built from 0 samples (cold start) · en · updated 2026-09
```

The line is a **structure, not an English string**: written in `lang`, never a
fixed English wording. It SHOULD carry at least one digit, since a count
separates a profile drawn from six hundred messages from one a model invented in
a turn. Nothing reads it by machine: the date that governs staleness is
`updated` in the front matter.

## Sections

Sections that are present SHOULD appear in this order.

| # | Section | Presence | What it holds |
|:--|:--|:--|:--|
| 1 | Mechanics | optional | What holds even when the voice is switched off |
| 2 | Voice | optional | How the subject always writes |
| 3 | Registers | **required**, at least one register | How the writing shifts for who is being written to |
| 4 | Surfaces | optional | How the channel shapes the piece |
| 5 | Do's and Don'ts | optional | Guardrails, and the words that are never used |
| 6 | Applying | **required** | How to use this file, in this file |
| 7 | Updating | optional | Where a piece of feedback goes |

An absent section means the file does not cover that point, and nothing
declares the absence. Registers and Applying are the two required sections: one
makes the file usable on a real recipient, the other makes it act.

`Dos and Don'ts` is the format's one alias for `Do's and Don'ts`, whose
apostrophes are the straight `U+0027`, like every other in the file.

### Mechanics

What holds even when the voice is switched off: accents, straight apostrophes,
no long dash, numbered lists for anything that asks for something, the sign-off
block, the layout of a formal letter, date and number formats.

Mechanics is the floor, and every register applies it, including the ones that
run with `voice: off`. Letter layout belongs here and not in Surfaces, because
Surfaces is one of the layers a `voice: off` register suspends.

Write mechanics as facts about the finished text, not as preferences. "Numbers a
request as a list, one item per ask" is checkable against a draft, "Cares about
clarity" is not, and a mechanic carries its measurement as readily as a trait:

```markdown
- Straight apostrophes and straight double quotes throughout: 0 typographic
  apostrophes in 412 sent messages.
- A plain hyphen where a typesetter would use `U+2014`; the corpus contains none.
- Requests arrive as a numbered list, one ask per line, never as a paragraph
  of questions.
- Signs a message with the first name alone, a letter with the full name.
- Letters carry the sender block, then the recipient block, then place and date.
```

A typographic habit in a corpus often belongs to the tool that produced it:
record what the subject would keep if they typed the text somewhere else.

### Voice

The traits that make a draft recognizably this author's: sentence length and
its variation, how a text opens and closes, connectors and tics, formality,
appetite for questions and lists. Five to eight bullets is the useful range.

**A trait SHOULD trace back to a measure**, carried in the same bullet: a figure
(a count, a median, a rate, a quartile: anything a reader could disagree with by
recounting) or a short quoted fragment of the subject's own writing. Untraced
and traced sit side by side below, the annotation in the right-hand column:

```markdown
- Writes warmly and professionally.                      untraced
- Opens with one line of context before the ask: "quick
  one, the invoice bounced".                             traced by a quotation
- Uses exclamation marks sparingly: 3 in 412 messages.   traced by a figure
```

A trait without a measure is a guess dressed as a fact. Voice is the one
section a register can switch off.

### Registers

How the writing shifts by **who is being written to**. The section MUST be
present, and it MUST carry at least one register.

Each register is a `###` heading whose title carries a free name and a mandatory
flag:

```markdown
### administrative (voice: off)
### professional (voice: on)
### personal (voice: on)
```

The name is everything before the **final** parenthetical, so
`### legal (external) (voice: off)` names the register `legal (external)`. The
flag is read case-insensitively and tolerates spaces inside the parentheses. A
`(voice: ...)` parenthetical outside Registers is ordinary heading text.

The register is chosen from the recipient, never from the mailbox it leaves
from. Each register SHOULD open with a line naming the recipients it covers, in
terms an agent can match against a real one, then its own rules: address,
greeting, sign-off, how direct a request may be, what is never done there.

```markdown
### administrative (voice: off)

Use for public bodies, tax and social security, courts, insurers, and any
counterparty in a dispute.

- Mechanics only, no voice.
- Neutral tone, dated facts, one numbered request per paragraph.
- Formal greeting and the full closing formula, no first names.
- Never a joke, never an opinion about the person on the other side.
```

**The flag is declared, not observed.** `voice: on|off` is the subject's choice,
proposed by default from `kind` and **never inferred from the corpus**. A flag
MUST be **present**; nothing decides whether it is **right**, and a consumer
MUST NOT read a register's bullets to second-guess it. A register flagged off
SHOULD carry its own bullets: neutral tone, dated facts, numbered requests.

**What `voice: off` suspends.** A draft there is built from Mechanics and that
register's own rules, from nothing else: Voice does not apply, Surfaces does not
apply. It is not a colder version of the voice, it is the absence of the voice.

Prose before the first `###` is read and applies to every register, in Registers
and in Surfaces alike.

Default names by `kind`, proposals for a fresh file confirmed by the subject:

| `kind` | Default registers |
|:--|:--|
| `person` | administrative (voice: off), professional (voice: on), personal (voice: on) |
| `brand` | customer (voice: on), partner (voice: on), press (voice: on), legal (voice: off) |
| `project` | users (voice: on), contributors (voice: on), changelog (voice: on) |

A register answers *who is this for*, a surface *where does this land*. When a
name could be either, that test decides.

### Surfaces

How the writing shifts by **where it lands**: email, letter, chat message, form
field. One `###` per channel, free names, each stating which channels it covers
and then the shape of a text there: typical and maximum length, greeting and
sign-off, whether lists are used, whether formatting is available at all.

```markdown
### message

Chat, SMS, and any field under a few lines.

- One to three sentences, no greeting, no sign-off.
- No lists, no bold, no headings.
- A question goes at the end, alone on its line.
```

Surface and register are set independently: a warm message and a warm letter
share a register and share nothing else.

### Do's and Don'ts

Short, checkable, one line each: words and formulas that are never used, habits
that are always kept, verifiable in one pass over a finished draft.

```markdown
- Do put the request in the first three lines.
- Don't write "n'hésitez pas" or any equivalent.
```

This is where feedback lands that is too specific to be a trait and too absolute
to be a tendency. The section grows from real corrections on real drafts.

### Applying

Required, a few lines, in the file's language, addressed to the agent. It makes
the file operative when this specification is nowhere in sight, so it MUST NOT
depend on anything outside the file: no path, no tool. It states the procedure:

1. Pick the register from the recipient, and the surface from the channel.
2. If the register is `voice: off`, apply Mechanics and that register's own
   rules only.
3. Otherwise apply Voice, then the register, then the surface. Where the
   register and the surface disagree, the register wins.
4. Reread against Do's and Don'ts before showing anything.
5. Show the draft and ask what is off, rather than announcing that it is done.
6. Never for code, never for the agent's own replies. In another language than
   this file's, keep Mechanics and the register and say the voice was not
   measured there.

The section MUST be present, and covering these six beats binds the author.
Do's and Don'ts, Applying and Updating instruct the agent, in the imperative;
the third-person rule below governs the sections that describe the author.

### Updating

Where each kind of feedback goes, so the file absorbs corrections instead of
losing them in a chat or piling up loose notes at the bottom:

```markdown
- A habit tied to a channel goes to Surfaces.
- A tone shift toward a kind of recipient goes to Registers.
- A word to ban goes to Don'ts.
- Anything true everywhere goes to Voice, with its evidence.
- Show the change before writing it, refresh `updated` and the provenance,
  strip any personal data, then reread the file: third person, a measure in
  every Voice bullet, a flag on every register, straight typography.
```

## Content rules

### Third person

Every description of the author is third person, in the file's language:
"Writes short sentences", "Écrit des phrases courtes". Never "I": a file
written from inside the writer's head reads as a script for the agent to speak.
Bullets in Mechanics, Voice, Registers and Surfaces MUST NOT be written in the
first person. A quoted fragment may of course be first person, since the rule
reads the bullet's own words, not the words it quotes.

### Traceability

Every Voice trait SHOULD carry a number or a quoted fragment in the same
bullet, as above; an untraced bullet is kept and weighed below the traced ones.
A quotation in a Voice bullet MUST be a fragment of the subject's own writing:
quoting the subject's *instructions* ("keep it short") to satisfy the rule is a
violation of the format even though only a reader can catch it.

### No personally identifying information

A VOICE.md MUST NOT contain an email address, a phone number, a bank identifier,
a correspondent's name, or a judgment about a named person. Quoted fragments are
depersonalized before they enter the file: a fragment that only works with a
name in it is not style evidence, and a different fragment is used. Where a role
has to be named, it is named as a role, in square brackets: `[the accountant]`.

Record the pattern, never the value: the file says the sign-off carries a direct
line, never the number. Addresses and identifiers are mechanical patterns, names
of correspondents are not: that part is the author's discipline.

### Language

The file is written in `lang` throughout: prose, section bodies, quoted
fragments. The **structure is English** in every language, the front matter
keys, the `##` section names, the `voice:` flag; the **content is in `lang`**.

### Typography

A VOICE.md MUST contain none of the characters in the table below.

The rule **has no exemption anywhere in the file**: not in a code span, not in
a fenced block, not inside a quotation, and there is no per-file escape marker.
Exemplars pass through this table before insertion, keeping the subject's words
and not their glyphs: straight apostrophes, `U+00AB` and `U+00BB` kept as they
are, any thin or non-breaking space inside them replaced by an ordinary space.
An analysis may record the curly apostrophes of a corpus **as a measurement**;
the file contains none. A character that must be discussed is named rather than
typed:

```markdown
- Types `U+2014` where a comma would do; the profile writes a plain hyphen.
```

The table holds **two natures**, and what separates them is whether a tool can
finish the job alone. A **glyph** has a straight equivalent that says the same
thing: it is replaced, one for one, and nothing else in the sentence moves. A
**construction** carries the shape of a sentence. `U+2014` between two clauses
is an aside, and the aside is what the rule is about: a hyphen in its place
leaves a sentence nobody wrote, neither the author's nor a repaired one. A
construction is therefore **reported and never rewritten**, with the whole
sentence it sits in, and the sentence is rewritten by whoever is writing. The
same three characters with a digit on each side are a range and not an aside,
so they are a glyph and are replaced.

The table is **normative**: a normalizer that repairs these characters
implements this table, the language branch under it and the two natures, with
`lang` from the front matter and nothing else. It is exhaustive for version 1,
extensible in a later version, applied character by character: nothing added,
nothing merged.

| Class | Code points | Written instead |
|:--|:--|:--|
| Hyphens | `U+2010` `U+2011` `U+2012` `U+2212` `U+FE58` `U+FE63` `U+FF0D` | `-` (`U+002D`), one for one, no spacing added or removed |
| Ranges | `U+2013` `U+2014` `U+2015` with a digit on each side | `-` (`U+002D`) |
| Apostrophes | `U+2018` `U+2019` `U+201A` `U+201B` `U+2032` `U+02BC` `U+FF07` | `'` (`U+0027`), never the backtick `U+0060` |
| Double quotes | `U+201C` `U+201D` `U+201E` `U+201F` | by `lang`, see below |
| Double primes | `U+2033` | `"` (`U+0022`), in every language: it measures rather than quotes |
| Spaces | `U+00A0` `U+1680` `U+2000` to `U+200A` `U+202F` `U+205F` `U+3000` | one `U+0020` each, consecutive spaces never merged |
| Invisibles | `U+200B` `U+2060` `U+00AD` `U+2061` to `U+2064` `U+FEFF` except at offset 0 | removed |
| Ellipsis | `U+2026` | three dots |
| Ligatures | `U+FB00` to `U+FB06` | `ff` `fi` `fl` `ffi` `ffl` `ft` `st` |
| Fraction slashes | `U+2044` `U+2215` | `/` |
| Dashes | `U+2013` `U+2014` `U+2015` anywhere else | reported, never rewritten: the sentence around it is rewritten |

Double quotes follow `lang`. When `lang` is `fr`, an opening double quote
becomes `U+00AB` followed by one `U+0020`, and a closing double quote becomes
one `U+0020` followed by `U+00BB`; guillemets already in the text and straight
`U+0022` are left alone. For every other language, all four become `U+0022`.
The double prime `U+2033` is not in that branch: it writes a measure, as in a
height or a duration, and a French file that turned it into a guillemet would
say something the author did not. It follows `U+2032`, which becomes a straight
apostrophe, and becomes a straight double quote everywhere.

Only the replacement depends on the language, never the input set: a curly
double quote is forbidden in a French file too.

A report over a document therefore has two halves: what was replaced, counted
per character and per file, and the constructions, one whole sentence each,
which is the list a writer works through. An exemplar is the one place the
second half does not apply, because a quoted fragment is not a sentence being
written: it passes through every class, `Dashes` included, so that the file it
lands in contains none of these characters.

Preserved, never rewritten: `U+200C` and `U+200D` (composed emoji, Indic and
Persian scripts), `U+FE0E` and `U+FE0F` (variation selectors), `U+200E` and
`U+200F` (direction marks), `U+00B7` (inclusive writing, and the recommended
separator in a provenance line), `U+0153`, `U+00E6`, `U+2022`, `U+2192`,
`U+00D7`, and the guillemets `U+00AB` and `U+00BB`.

### Size

A file SHOULD stay under 150 lines and 10,000 characters, counting the whole
file including front matter, in newline-separated lines and Unicode code
points: a profile that fills the window competes with the task it was pasted
beside. The figures are an indication, not a limit, and splitting the file is
not a remedy, because a file never inherits from another. The remedies, in
order:

1. Cut every bullet that carries no measure. They are the ones nobody can check.
2. Merge two registers that differ by less than a sentence.
3. Move surface detail into a single quoted exemplar per surface.

### Judged rules

Six rules about the writing itself, which no pattern holds and no tool serves.
They are stated here because the model reads them at the moment it drafts:

- A fact, then what it changes for the recipient.
- Never explain the same thing twice.
- An aside set off by dashes is rewritten as a sentence. This is the rule the
  `Dashes` class of [Typography](#typography) reports and leaves alone, because
  nothing but a rewrite settles it.
- No "n'hésitez pas", "je me permets", "dans l'attente de votre retour", nor
  their English equivalents.
- Sentence length varies.
- Every sentence can be said aloud in one breath.

They hold for every draft the file governs, in any `lang`, and repeating one in
Do's and Don'ts adds nothing. Adapted from Anbeeld/WRITING.md (MIT) and
blader/humanizer.

## Consumer behavior

The consumer is the model reading the file in order to draft from it. Holding a
VOICE.md it does not fully understand, it still has to produce a draft. These
rows govern drafting from a finished file; a model authoring one repairs the
defect instead.

Three rules hold for every row below, and for a file being written as much as
one being read. **A name is claimed once**: at a given level, the first heading
with a given name owns it, sections, registers and surfaces each on their own,
compared case-insensitively after trimming and after removing a register's flag;
a later heading claiming that name is kept in the file and never applied, and
what sits under it still answers to the content rules above. **An empty section
is an absent section**: a section holds content when at least one non-blank line
that is not itself a heading sits between its heading and the next `##`.
**Written intent wins, missing intent takes the safe side**: the first thing the
author wrote governs, and where they wrote nothing a consumer needs, the
consumer applies *less* voice, never more.

| Case | What the model does |
|:--|:--|
| No front matter | Reads the body anyway, and treats every front matter field as absent |
| `name` absent | Applies the file; the profile describes whoever supplied it |
| `kind` outside the three | Reads it as `person` for the default register names, and changes nothing else |
| `lang` absent, or a language the reader does not know | Non-French quote convention; every other rule is language-independent |
| A draft asked for in a language other than `lang` | Keeps Mechanics and the register, weighs the Voice traits as unmeasured in that language, and says so; uses the VOICE.md of that language if the user names one |
| Unknown front matter key | Carries it through, ignores it |
| `typography` naming a class the table does not define, or a value that is neither `replace` nor `keep` | Ignores that line and applies the table's own nature for that class |
| `version` unrecognized | Reads the file as version 1 |
| `updated` absent, unreadable, or in the future | Applies the file; staleness is unknown |
| `updated` older than twelve months | Applies it in full, and says it is due for a reread rather than falling back to generic prose |
| More than one block quotation before the first section | Takes the first as provenance, reads the rest as ordinary content |
| No block quotation before the first section | Applies the file, and assumes nothing about how much of it was measured |
| Provenance quoting zero samples | Applies it as a declared profile, and treats every trait as unmeasured |
| A `##` outside the section table | Reads it, carries it through, never applies it as a section |
| A section name used twice | Applies the first block; the second is kept in the file and never applied |
| Sections out of order | Reads by heading, never by position; the order changes no meaning |
| A section heading with nothing under it | Treats it as absent |
| `## Registers` absent, or with no register under it | Applies Mechanics only, applies no voice, and says the file carries no register |
| Register heading with no flag | Reads it as `voice: off`. Nobody authorized a personal voice there |
| Register flagged `voice: off` that also lists voice traits | Follows the flag: Mechanics and that register's own rules only |
| A register heading with no bullets under it | Applies Mechanics and nothing else for that register |
| Two registers or two surfaces with the same name | Applies the first; the second is not applied |
| Registers present, none matching this recipient | Uses the register that applies the least voice, and says which one it used |
| Missing Surfaces, or a channel with no surface | Leaves the surface layer empty, takes the shape from the channel, and borrows nothing from a neighboring surface |
| A surface matching no channel | Applies nothing from Surfaces |
| Missing Mechanics | Applies Voice and the register; nothing in the file constrains typography |
| `## Applying` absent or empty | Applies the file anyway, following the six beats in [Applying](#applying), and says the file carried no procedure |
| Voice bullet with no measure | Keeps it, weighs it below the traced traits, and does not act on it as if it were measured |
| A forbidden code point anywhere | Reads it as though the table had been applied, and never reproduces the character in a draft |
| An address, a number or a bank identifier in the file | Applies the file without that fragment, and never reproduces it in a draft |
| File over the size indication | Applies it in full, never truncates |

## Who judges, and when

Nothing mechanical decides whether a VOICE.md is any good. Three readings do, in
this order.

1. **The model rereads the finished file against this specification**, at the
   end of a setup or after the skeleton is filled in by hand, and before anyone
   else sees it: the structure and the order of the sections, a `voice:` flag on
   every register, third person in the sections that describe the author, every
   Voice trait carrying its measure where the corpus supplies one, no personally
   identifying information, the typography table. What it finds, it fixes before
   it shows the file. A register with no flag is not silently read as
   `voice: off` here: the model writes the default from `kind` and puts it to
   the subject.
2. **The subject reads it and cuts what is not theirs.** They are the only
   reader who can separate a habit of their own from a habit of their mail
   client, a trait from an accident of the corpus, and a line they want kept
   from one they want to be rid of.
3. **The blind comparison settles whether the voice is worth following**: one
   real task written twice, with the profile and without it, same register and
   same surface, and the subject choosing without knowing which draft is which.
   Nothing else settles that question.

What those readings look for cannot be stated as a check:

- **The provenance is honest.** Nothing verifies that 412 messages were read.
- **A digit measures its claim.** A figure next to a claim is easy to produce; a
  figure that measures the claim is the point.
- **The prose is third person.** A paragraph written from inside the writer's
  head describes nobody, and reads as a script for the agent to speak.
- **A quoted sample is depersonalized.** A first name, a company, a case only
  one person could be in: a human reads for those before the file is published.
- **The flag is the subject's decision.** Nothing checks whether `voice: off` is
  the right call for a register, and nothing should: a reader that disagreed
  would overrule the person the file describes.
- **The register and surface names are the ones an agent will meet.** Nothing in
  the file knows the recipients or the channels, so nothing in it tells a live
  register from dead weight.
- **Applying says what to apply.** Its presence is required; whether it says
  anything useful is judged.

None of this can be automated, and a heuristic that tried would trade a judgment
for a guess.

## A complete skeleton

Copy this, replace every bracketed slot with something measured, and delete the
sections that do not apply.

```markdown
---
name: <who>
kind: person
lang: en
version: 1
updated: <YYYY-MM>
---

> Built from <N> emails (work), <N> emails (personal), <N> letters · en · updated <YYYY-MM>

## Mechanics

- <A constant of the finished text, true even with the voice off.>
- <Sign-off block, as it is actually written.>
- <Layout or formatting habit that never varies.>

## Voice

- <Trait, with a number: median sentence length, paragraph count, a rate.>
- <Trait, with a quoted fragment: "<short depersonalized fragment>">
- <Trait, with a number or a fragment.>

## Registers

### <name> (voice: off)

Use for <the recipients this covers, in matchable terms>.

- Mechanics only, no voice.
- <Rule of address, greeting, closing.>
- <What is never done in this register.>

### <name> (voice: on)

Use for <the recipients this covers>.

- <Form of address, greeting, sign-off.>
- <How direct a request may be.>

## Surfaces

### <channel>

<Which channels this covers.>

- <Typical and maximum length.>
- <Greeting and sign-off, or their absence.>
- <Lists and formatting, or their absence.>

## Do's and Don'ts

- Do <checkable obligation>.
- Don't <banned word or formula>.

## Applying

1. Pick the register from the recipient, the surface from the channel.
2. If the register is `voice: off`, apply Mechanics and that register's own
   rules only.
3. Otherwise apply Voice, then the register, then the surface. Where the
   register and the surface disagree, the register wins.
4. Reread against Do's and Don'ts before showing anything.
5. Show the draft and ask what is off.
6. Never for code, never for your own replies. In another language than this
   file's, keep Mechanics and the register and say the voice was not measured
   there.

## Updating

- A habit tied to a channel goes to Surfaces.
- A tone shift toward a kind of recipient goes to Registers.
- A word to ban goes to Don'ts.
- Anything true everywhere goes to Voice, with its evidence.
- Show the change before writing it, refresh `updated` and the provenance, strip
  any personal data, then reread the file: third person, a measure in every
  Voice bullet, a flag on every register, straight typography.
```

As printed it is not yet a profile: the slots carry no figures, so provenance and
the Voice bullets claim nothing until they are filled with real measurements.

The cheap test takes a minute: paste the file, and nothing else, into a fresh
chat, ask for a letter to a tax office and a message to a colleague, and see
whether both come back in the right register, in the right shape, with the
mechanics intact. What it cannot settle is whether the voice is worth following
at all; only the blind comparison settles that.
