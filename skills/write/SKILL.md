---
name: write
description: Drafts or rewrites a text in the author's own voice, from the VOICE.md that governs where the text is going. Use when someone asks for a draft in their voice, asks to rewrite something so it sounds like them, or names a register or a surface from their profile.
---

# Writing in the voice

The profile already carries its own Applying section, so this skill adds no
method. It adds a trigger. One line in the agent's instructions is advice the
model follows most of the time; a command is the explicit path next to that
implicit one, for the long session, the reply asked for in the middle of a
coding task, and the register the request does not name.

Three usages of the one command, and they differ only in what arrives:

- `write` - a text that does not exist yet.
- `rewrite` - a text supplied in the request, put into the voice without
  changing what it says.
- `force` - the same, with the profile read in full first and a register or a
  surface named on the command line rather than inferred.

Arguments are all optional: a register name, a surface name, both as written in
the file, and a path to a profile. A free tone is never an argument. A tone is a
measured register, and a free-text one would bypass the profile and invite
invention.

## The procedure

1. **Resolve the profile.** A path in the request first; otherwise the nearest
   `VOICE.md` walking up from where the text is going, `VOICE.md` then
   `.agents/VOICE.md` at each level; otherwise `~/.agents/VOICE.md`. Nothing is
   merged: the first file found is the whole profile. Found nothing? Say so,
   offer `/voice:setup`, and stop. Never invent a voice.
2. **Read it whole**, front matter included, before writing a word.
3. **Pick the register and the surface**, from the recipient and the channel, or
   take the ones named. No register matches? Use the one that applies the least
   voice and say which. `voice: off` means Mechanics and that register's own
   rules, and nothing else.
4. **Write, or rewrite,** following the file's own Applying section. A rewrite
   keeps what the text says and changes how it says it.
5. **Put the draft in a working file**, not in the answer, and outside any
   repository: `$HOME/.agents/voice-drafts/<date>-<subject>.md`, with the date as
   `YYYY-MM-DD` and a subject of two or three words. Say the path. It stays there
   until the person says where the text goes, and a draft written into a checkout
   is a draft that reaches a commit.
6. **Run the typography command on that file:**

   ```bash
   ROOT=${CLAUDE_PLUGIN_ROOT:-$HOME/.agents/skills/voice.md}
   node "$ROOT/scripts/typo.js" --fix --voice "$PROFILE" "$DRAFT"
   ```

   `PROFILE` is the file step 1 resolved and `DRAFT` the working file. It
   replaces the glyphs by itself. What it prints under `to rewrite` is the half
   it cannot do: each line is a whole sentence built on a dash, and each one is
   rewritten as a sentence before anything is shown. Rerun until that list is
   empty.
7. **Show the draft and ask what is off.** Not "here is your draft, let me know
   if you need changes": name the register and the surface used, and ask what
   does not sound like them.

## What this never does

Never sends, posts or files anything: the draft sits in its working file and the
person decides. Never for code, and never for the agent's own replies. Asked for
a language other than the profile's `lang`, keep Mechanics and the register,
weigh the Voice traits as unmeasured there, and say so.

A correction the person makes on a draft is not a correction to the draft. It
belongs in the profile, through its own Updating section, which is what "add
that to my voice" means.
