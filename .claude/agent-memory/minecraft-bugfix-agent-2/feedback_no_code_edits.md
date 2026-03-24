---
name: Game agents must not edit code
description: Per CLAUDE.md, game agents (Claude2-7) must NOT edit src/ code. Report bugs to bug-issues/bot2.md only.
type: feedback
---

## Rule
Game agents (Claude2-7) must NOT edit code. Only report bugs to bug-issues/botN.md.

A separate general-purpose code reviewer agent reads bug-issues/*.md and applies fixes.

## Allowed file writes
- bug-issues/bot2.md (append new bug reports only)
- .claude/agent-memory/minecraft-bugfix-agent-2/ (memory files)

## NOT allowed
- src/tools/*.ts
- src/bot-manager/*
- Any other src/ files
- CLAUDE.md
