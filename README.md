# 🗣️ voice.md

One file that says how you write, for the agents that draft in your name.

VOICE.md is a plain-text format, like design.md for a design system: front matter a tool can parse,
prose a model reads. This repository holds the specification, a setup that builds your file from
what you have already sent, a skill that drafts with it, and one command that keeps the typography
straight.

## 🔍 What people use it for

- ✉️ **Stopping the tell.** An agent drafts your reply and everyone can see it was not you: the em dashes, the "I hope this finds you well", the three sentences of the same length. The profile is the counter-evidence, measured on your own mail.
- 🎚️ **Writing differently to different people.** A register per kind of recipient, each with a flag you set: your voice for a client, no voice at all for the tax office. Nothing is inferred from the corpus.
- 📐 **Making a claim checkable.** Every trait carries a figure or a quoted fragment from your own writing, so a line you disagree with is a line you can cut, and one you keep is one you can verify.
- 🏢 **Giving a brand or a project one voice.** Three kinds of author, one file each, no inheritance: a file works pasted naked into a chat window with nothing around it.
- ⌨️ **Straightening typography without thinking about it.** One command replaces the glyphs a mail client put in, and hands back the sentences only a writer can fix.

## 📦 Install

```bash
# the plugin, for /voice:setup and /voice:write
claude plugin marketplace add https://github.com/smkg75/voice.md.git
claude plugin install voice@voice
```

The typography command needs none of that:

```bash
npx voice.md typo --voice VOICE.md lettre.md
```

## 🚀 First run

`/voice:setup`, and answer the first question honestly, because nothing is read before you do.

It asks for your consent and for what it may read: one or two mailbox exports, a folder of letters
you have reread, or a dozen messages pasted into the conversation. It then collects the samples
locally, measures them, writes your `~/.agents/VOICE.md`, rereads it against the specification,
shows it to you, and cuts what you say is not yours. Last it adds one line to your `CLAUDE.md` so a
later draft finds the file, and deletes the working directory, which still held raw private text.

About thirty minutes, most of it yours: exporting the mailbox, and reading the profile.

## 🧾 Commands

| Command | Argument | Produces |
|---|---|---|
| `/voice:setup` | nothing | `~/.agents/VOICE.md`, measured, and the anchor line in `CLAUDE.md` |
| `/voice:write` | `write`, `rewrite` or `force`, a register, a surface, a profile | a draft in a working file, in your voice, never sent |
| `npx voice.md typo` | `--check`, `--fix`, `--voice`, `--lang` | what was replaced, and the sentences to rewrite |

## ⚙️ How it works

A VOICE.md is front matter and seven sections: **Mechanics** (what never changes: greeting,
sign-off, typography), **Voice** (the traits, each with its measure), **Registers** (one per kind of
recipient, each with a `voice: on` or `voice: off` flag you decide), **Surfaces** (one per channel),
**Do's and Don'ts**, **Applying** (the procedure on a real draft), **Updating**.

A consumer looks for the profile in one order and applies the first it finds: a path you name, then
the nearest `VOICE.md` walking up from where the text is going, then `~/.agents/VOICE.md`. Nothing
is merged along the way, and nothing inherits: the file has to work alone.

The character table has two natures, and the difference is what a tool can finish on its own. A
**glyph** has a straight equivalent that says the same thing, so it is replaced: curly apostrophes,
typographic quotes, non-breaking spaces, ellipses, ligatures. A **construction** carries the shape
of a sentence. `U+2014` between two clauses is an aside, and a hyphen in its place leaves a sentence
nobody wrote, so it is **reported with the whole sentence around it and left alone**. The writer
rewrites it. `/voice:write` runs the command on its own draft and does exactly that.

The full format is in [`docs/spec.md`](docs/spec.md). The arbitrages, with the reason that settled
each one, are in [`DECISIONS.md`](DECISIONS.md).

## 🔒 What leaves your machine

Nothing.

The two scripts run locally and read your mail from files you exported yourself. The model never
sees a mailbox: it reads `analysis.json`, which holds counts, medians and rates, and
`exemplars.md`, which holds a few short passages with addresses, amounts, references and
correspondents' names already masked. The profile carries no personally identifying information,
and the working directory is deleted at the end of the setup.

Your own VOICE.md is yours. It is not in this repository and never will be.

## 📖 The example

[`examples/person-fr/`](examples/person-fr) holds a profile for Flaubert, built by the real pipeline
from 200 letters fetched from Wikisource, which are public domain. The corpus is not stored; the
script downloads it again. [`REPLAY.md`](examples/person-fr/REPLAY.md) is the exact sequence, and
the result is reproducible byte for byte.

## 🛠️ Development

```bash
node --test                              # no argument: node finds the files itself
node scripts/typo.js --check --lang en . # the repository holds itself to its own table
```

Plain CommonJS, no dependency, no build. The typography hook that used to ship with this plugin is
in [`archive/hooks/`](archive/hooks), not loaded by anything, with the reason it was archived.

## 📄 License

MIT.
