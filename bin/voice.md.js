#!/usr/bin/env node
'use strict';

// The npm entry point. One subcommand today, and a dispatcher rather than a
// direct bin on scripts/typo.js so that a second one costs a line here instead
// of a second name in package.json.

const { runCli, USAGE } = require('../scripts/typo.js');

const argv = process.argv.slice(2);
const out = (text) => process.stdout.write(text + '\n');
const err = (text) => process.stderr.write(text + '\n');

if (argv[0] === 'typo') {
  process.exitCode = runCli(argv.slice(1), out, err);
} else if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  out(USAGE);
  process.exitCode = 0;
} else {
  err('voice.md: no subcommand named ' + JSON.stringify(argv[0]) + '; the one there is is typo');
  process.exitCode = 2;
}
