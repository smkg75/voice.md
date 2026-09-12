# Decisions

Why the format and the plugin are shaped the way they are. Each entry is an arbitrage that was
settled once, with the reason that settled it, so it is not re-litigated or silently undone.

What is deliberately left undone sits at the end, under [Deferred](#deferred).

**Writing an entry.** The reason is what was observed, never where it was observed. No mailbox, no
correspondent, no employer, no line of anyone's corpus: the repository is public, and this project
is built by reading what its author has written to real people. What is worth keeping from such an
exercise is the date, what was measured, and the count. The author's own VOICE.md is not in this
repository and never will be.

## The product

**The code is the product here** · 2026-09-10
The author's standing rule for his repositories is that a skill carries method and no frozen code:
a script written into a skill freezes a choice that belongs to the project using it. That rule does
not apply here, on his explicit request. What is distributed is a format and the one program that
enforces its character table; there is no host project to write that program in, and a table of
code points is not a choice a project gets to make. The exception is recorded so it is not read
later as a lapse.

**No lint; the typo command ships as an npm bin over the same file** · 2026-09-12
design.md carries a linter because its file feeds `export` and `diff`: a compiler needs a schema,
and a schema needs a check. A VOICE.md has one consumer, the model that reads it before drafting. A
linter over a file read by a model protects nothing, because the model already reads the whole file
and repairs what it does not understand. Two measurements settled it. The worked example contained
exactly one occurrence of the entire linting vocabulary, in the last words of its last line, so the
file produced while the linter existed never once leaned on it. And removing the linting frame took
the specification from 806 lines to 648 without losing a rule: what was a rule with a severity
became a written requirement, which is what a model reads anyway.

The refusal of a command line and of npm went with it, and was reversed on 2026-09-12. The
difference is the consumer. A lint over a profile had none. A typography command over a document
has one the moment the hook is archived: the skill that drafts runs it on its own draft, reads the
sentences it cannot repair, and rewrites them. Once there is a program a model calls by name, the
install is the thing to make cheap, so it ships as an npm bin over the same `scripts/typo.js` the
plugin uses. `npx voice.md typo` needs no plugin, no marketplace and no install; the package
declares no dependency, no build and no script entry, and a test asserts that its version and the
plugin's are the same number.

## The commands

**`/voice:write` exists, and `/voice:force` is one of its three usages** · 2026-09-12
A `/voice:write` was first refused: the file carries its Applying section, so a command would
restate to the model what it just read, and it would only work where the plugin is installed, which
is the opposite of a format meant to travel. That refusal holds for the format, and it is why the
skill adds no method: it resolves the profile, reads it, and follows the file's own Applying. What
it adds is a trigger. The file is otherwise read on the strength of one line in the agent's
instructions, which is advice the model follows most of the time, not a guarantee: in a long
session, or when a reply is asked for in the middle of a coding task, the file can go unread. So one
command with three usages that differ only in what arrives: `write` for a text that does not exist,
`rewrite` for one supplied in the request, `force` for the case that was going to be a command of
its own, where the profile is read in full and a register or a surface is named instead of
inferred. The
arguments are names as written in the file, never a free "tone": a tone is a measured register, and
a free-text tone would bypass the profile and invite invention. One SKILL.md, no code, sixty-eight
lines. It also has a second job now: it runs the typography command on its own draft and rewrites
the sentences the command reports and cannot repair.

## The collection

**A charset declaration is believed outside the windows-1252 family, and nowhere else** · 2026-09-11
The decoder used to ignore the declaration entirely and ask the bytes: a run that decodes as utf-8
is utf-8, anything else is a single byte codepage read as latin1. That is right for the family the
declarations get wrong in both directions, where latin1 reads everything and no character is lost.
It is wrong everywhere else, and silently. Measured on twelve messages declaring iso-8859-15, the
codepage French mail used for the euro through the 2000s: the oe ligature came back a fraction and
the euro sign a currency sign, the mojibake reached the shipped n-grams and the extracts, and
nothing in either output file could show the loss, since neither character is in the typography
table. So a label outside the family is tried first, and the sniff catches it when the label is
unknown or the bytes do not fit it.

**A body that is almost utf-8 is read sequence by sequence** · 2026-09-11
The sniff was all or nothing, over the whole part. One byte of another codepage anywhere in an
otherwise utf-8 body, or a tail an exporter cut mid-sequence, sent the entire message through the
cp1252 map: every apostrophe came back as three characters, and the em dashes and ellipses that had
been typed were reported at zero while quotation marks nobody wrote were counted. Fabricating
punctuation is worse than losing it here, because the count of that punctuation is the one measure
that exists to tell the mail client apart from the person. A body wholly one encoding or wholly the
other decodes exactly as before; only a body that is neither is changed, into the part of itself
that is readable. A width no narrower read approximates, utf-16 and utf-32, is refused instead:
counted as unreadable, named on the error channel, never measured.

## The specification

**The character table lives in the specification, written as `U+XXXX` escapes** · 2026-09-10
The repository holds itself to its own table: the continuous integration runs `--check` over every
file in it. A table that printed the characters it forbids would fail that check, and the
specification would then break the rule it states. Naming a character rather than typing it is what
keeps the document readable by its own program. The same constraint governs the tests: a fixture
holds `\u2014`, never the character, or it would pass vacuously against a table that had already
repaired it. This was written when a hook rewrote every file the agent wrote; the hook is archived
and the reason survives it unchanged.

**A test reads the table out of the specification and compares it to the code** · 2026-09-10
Two copies of one table, one normative in prose and one executable, drift the first time either is
extended. The test parses the table out of `docs/spec.md` and asserts that the code covers the same
code points and no others, so a character added on one side fails until it is added on the other.
It also fixes the order of work: the specification is edited first, the code follows.

**A rule is a replacement or a rewrite, and the table says which** · 2026-09-12
The table used to have one nature: every character in it had a straight equivalent, and a program
wrote that equivalent. `U+2014` broke it. Between two clauses it is not a character with an
equivalent, it is an aside, and the rule about it, older than this project, is that an aside is
rewritten as a sentence. A hyphen in its place satisfies the table and leaves a sentence nobody
wrote: not the author's, not a repair. So the table now carries two natures. A glyph is replaced,
one for one. A construction is reported with the whole sentence around it and left exactly where it
was, and whoever is writing rewrites the sentence. The same three characters with a digit on each
side are a range, which is a glyph, and the class `Ranges` sits before `Dashes` in the table so the
context decides. The report has the two halves, `--check` fails on either, and the measured
consequence is the one that made it worth doing: over five repositories, 91 per cent of what the
old table would have rewritten was an em dash, so the single nature was wrong about almost
everything it touched.

**A front matter that carries data, settled at one key: `typography`** · 2026-09-12
design.md splits its file in two layers: tokens in the front matter, which tools read and export,
and prose in the body, which agents read for the reasoning. The author wanted the same split here,
and the question that held it back was which values earn being data, since a value nobody parses is
better said in prose. The typography command answered it for exactly one: `typography`, a line per
class of the table with `replace` or `keep`. It earns the front matter because a program reads it,
the way a program reads `lang`, and because the alternative is a sentence in Mechanics that a
normalizer cannot act on. The perimeter stops there. The register names and their flags, the surface
names and their lengths, the sign-off block stay prose, because their consumer is the model and the
model reads prose. A profile never redefines the code points of a class: it says which of the
table's classes apply to the text it governs. The standalone rule holds: a file pasted naked into a
chat still works, because the body never depends on the front matter to be understood, and a class
not named keeps the nature the table gives it.

**A redirection inside a heredoc is read as a redirection** · 2026-09-11
The PostToolUse hook finds the targets of `>`, `>>` and `tee` by walking the command and tracking
quote state, which is enough for a quoted path and for a `>` inside a quoted string. A heredoc body
is not quoted, so a `>` written inside one is taken for a redirection, and a file that the command
never wrote can be normalized in passing. The case is rare, the effect is in the direction the
scope already goes, and the alternative is a shell parser inside a hook that must never block. It
is written down rather than fixed.

## Deferred

Known holes, kept visible on purpose.

**The typography hook, archived rather than deleted** · turned off before it ever ran · 2026-09-12
It shipped in scope `all`: every file the agent writes, code included, no opt-in, no per-file
exemption, active from install. The wager was that a rule with an exemption is a rule nobody can
rely on, and it was to be held honest by a dry run read before the hook was turned on. The dry run
is what ended it. Over five repositories it counted 9,645 characters across 1,012 files, and 91 per
cent of them were em dashes, the one character a hook cannot handle: an aside is rewritten as a
sentence, and a hook has no channel to ask for a sentence and no way to wait for one. It would have
done one thing in practice, and that one thing badly. So the tool became a command a model calls,
which replaces the glyphs and hands back the constructions with the sentence around each one, and
the skill that drafts runs it on its own draft. The hook is in `archive/hooks/`, requiring the same
library and passing the same tests, loaded by nothing, with a README saying how to turn it back on.
Whether a hook is wanted at all is a question use will answer; it was never once run in anger.

**Draft checking.** No tool judges a draft against a profile. The plugin produces a VOICE.md, and
nothing else: applying it and updating it are sections of the file itself, written for the model
that reads it. A checker would be a second opinion on prose, which is the author's job.

**A `diff` command.** Comparing two profiles, or a profile against a fresh analysis, is the obvious
way to see a voice move over time. It needs a stable machine reading of the body, which the format
deliberately does not have.

**`brand` and `project` examples.** The format admits three kinds; only `person-fr` ships. An
invented profile would contradict the format's own traceability requirement, since every trait has
to trace back to a measurement and an invented one traces to nothing, and a real one would name a
company and its correspondence.

**An adapter that drives the mail client.** Exporting a `.mbox` by hand takes three menu items and
grants nothing. An adapter would buy that convenience at the price of standing automation access to
a whole mailbox, for a step that runs once.

**A per-file escape marker.** A line that exempts one file from the typography rule was asked for
and refused, in the author's words, because you would use it all the time. An exemption available
everywhere ends the rule it belongs to.

**Inheritance between files.** A base profile that a team or project file extends. Refused by the
standalone rule: the file has to work pasted naked into a chat window, with nothing around it.
Repetition between two profiles is the price paid for that.

**`/voice:new`, the explicit path for Updating** · deferred until real use · 2026-09-11
The mirror of the entry that became `/voice:write`. Applying now has its explicit path; Updating
would have `/voice:new <register|surface> <name>`: record a new way of writing, for a new kind of
recipient or a new channel, instead of saying "add this to my voice" in plain words, which keeps
working. The open question is evidence. A register declared in one sentence is a cold start for
that register, and the file has to say so; a register measured from five to fifteen pasted samples,
or from a folder, traces every bullet the way the rest of the file does. The command should offer
both and never pretend the first is the second. As with any update, the change is shown before it
is written. Deferred when `/voice:write` was, and left deferred when `/voice:write` was built:
saying "add that to my voice" in plain words already works, and nothing has yet shown that it does
not.
