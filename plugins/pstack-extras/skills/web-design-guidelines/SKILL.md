---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned guidelines in `REFERENCE.md` next to this file
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in `REFERENCE.md`
4. Output findings in the terse `file:line` format

## Guidelines Source

The guidelines are pinned in `REFERENCE.md`, a byte-for-byte snapshot of `command.md` from vercel-labs/web-interface-guidelines at `434b7f91364665f2f733b310ec54809bf8f37937`. Read that file; do not fetch from the network. `REFERENCE.md` contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Read `REFERENCE.md`
2. Read the specified files
3. Apply all rules from `REFERENCE.md`
4. Output findings using the format specified in `REFERENCE.md`

If no files specified, ask the user which files to review.
