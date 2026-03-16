---
name: Coding Patterns for Standalone Bot Scripts
description: Important patterns for running MCP tools as standalone Node.js scripts in this project
type: feedback
---

## Must Import high-level-actions.ts for registry.highLevel

When running tools directly (not through MCP server), you must import the high-level actions
module to populate registry.highLevel. Without it, mc_craft autoGather fails with:
"Cannot read properties of undefined (reading 'minecraft_craft_chain')"

```typescript
// REQUIRED for mc_craft autoGather and mc_gather to work
import '/path/to/dist/tools/high-level-actions.js';
```

## mc_chat() has no 'mode' parameter

The system prompt describes mc_chat(mode='get') but the actual implementation is:
- mc_chat() = read messages only (no args)
- mc_chat('message text') = send message
- mc_chat('message text', false) = send without reading

Never call mc_chat({ mode: 'get' }) - this causes "message.startsWith is not a function" error.

## Background Tasks

When running long-running bot scripts, use run_in_background parameter and check output file.
Background tasks ID format: /private/tmp/claude-501/.../tasks/TASK_ID.output

## Bot Position Awareness

Bot can end up far from base (underground, in water) after failed navigation attempts.
Always check position via mc_status() before long-running tasks.
Infrastructure detected in mc_status changes based on current bot position (32-block radius search).
