# The typography hook, archived

Nothing here is loaded. The plugin carries no `hooks.json` at its root, so
installing it installs no hook. The code still runs and its tests still pass;
this directory exists so the work is not lost and so turning it back on is a
file move rather than a rewrite.

## Why it was archived

A hook can do half the job. It replaces a character with a straight equivalent
and it cannot do anything else: it has no channel to say "this sentence needs
rewriting" and no way to wait for the answer.

Half the job is not the interesting half. The characters that matter most in
this table are `U+2013`, `U+2014` and `U+2015` between two clauses, and there
the rule is not a substitution. An aside set off by dashes has to become a
sentence, and only whoever is writing can write that sentence. A hook that puts
a hyphen there produces text nobody wrote: not the author's, not a repair.

So the tool became a command the model calls, `scripts/typo.js`, which replaces
the glyphs and hands back the constructions with the sentence around each one.
The skill `/voice:write` runs it on its own draft and rewrites what comes back.
That is the same table doing the whole job instead of the mechanical part of it.

It was also never turned on. A dry run over five repositories counted 9,645
characters across 1,012 files, 91 per cent of them em dashes, which is to say
that in practice the hook would have done one thing: the one thing it does
badly.

Whether a hook is needed at all is something use will say. It is archived, not
deleted, for that reason.

## What is here

- `typo.js` - the two hook modes, `pre` and `post-bash`, the JSON protocol on
  stdin, and the shell redirection parser. It requires the table and the
  resolution from `../../scripts/typo.js` and copies nothing, so a character
  added to the specification reaches this file too.
- `hooks.json` - the manifest, matchers and all.
- `test/` - the three test files that cover it: the PreToolUse protocol, the
  PostToolUse redirections, and the safety rule that no input, however broken,
  makes it exit anything but 0. They run with the rest of the suite.

The `pre` mode asks the library for `Dashes: replace`, which is how it behaved
when it was written. Without that, a hook would carry a construction it has no
way to report.

## Turning it back on

Move `hooks.json` to a `hooks/` directory at the root of the plugin and point
its three commands back at this file:

```bash
mkdir -p hooks && cp archive/hooks/hooks.json hooks/hooks.json
```

The commands already name `${CLAUDE_PLUGIN_ROOT}/archive/hooks/typo.js`, so the
code stays where it is. Reinstall the plugin, or restart, and read
`../../DECISIONS.md` first: the entry on the hook's scope says what was accepted
along with it.
