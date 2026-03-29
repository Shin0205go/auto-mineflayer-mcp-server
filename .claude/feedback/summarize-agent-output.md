# Feedback: Summarize Agent Output

**Type:** Output Format
**Date:** 2026-03-20+
**Status:** Active (enforced)

## Rule

**エージェント完了時は output を簡潔に 1-3 行で要約。ユーザーはフル output を直接見れない。**

## Why

- System prompt context has 200K token limit
- Agent output is 3-5x more expensive than input
- User reads concise summary, not full trace
- Token efficiency is critical

## Implementation

### Hook: post-execute-summarize.sh

```bash
#!/bin/bash
# Located at: .claude/hooks/post-execute-summarize.sh

INPUT=$(cat)

# Extract last 3 lines only
OUTPUT=$(echo "$INPUT" | tail -3)

# Count reduction
ORIG_LINES=$(echo "$INPUT" | wc -l)
NEW_LINES=$(echo "$OUTPUT" | wc -l)

# Replace in response
RESULT=$(echo "$INPUT" | jq ".content[0].text = $(echo "$OUTPUT" | jq -Rs '.')")

echo "$RESULT"
echo "[SUMMARY] Lines: $ORIG_LINES → $NEW_LINES" >&2
```

### Agent Output Format

**Bad (verbose):**
```
[START] Gathering wood logs
Walking to forest at (100, 64, 200)
Scanning for oak_log...
Found oak_log at (102, 65, 198), distance 5.2 blocks
Moving to tree...
Reached tree
Starting dig...
Digging completed
Got oak_log
Checking inventory...
wood count: 1
Repeating...
Found oak_log at (105, 64, 195)
...
[END] Gathered 5 oak_logs, HP=19, food=17
```

**Good (1-3 lines):**
```
[GATHER] oak_log x5, HP=19, food=17
```

### Bot Chat Format

```js
// Bad: long explanatory message
bot.chat("I am starting wood gathering operations at coordinates 100, 64, 200, I will search for oak trees and collect logs to build tools");

// Good: structured + brief
bot.chat("[GATHER] oak_log x5, HP=19, food=17");
```

### Status Report Format

```js
// Use fixed format for logs
log('[ACTION] ' + action_name);
log('[RESULT] ' + short_result);
log('[STATE] HP=' + bot.health + ' Food=' + bot.food);

// Example:
log('[ACTION] gather_wood');
log('[RESULT] oak_log x5 collected');
log('[STATE] HP=19 Food=17');
```

## Monitoring

Code reviewer checks:
- [ ] Output summarization hook is active
- [ ] Agent messages < 5 lines per action
- [ ] Chat format follows [TAG] convention
- [ ] No verbose trace logging

## Token Savings

```
Typical execute output: 500 tokens
Summarized output: 50-100 tokens
Per-action savings: 400 tokens
1000 actions/day: 400K tokens削減!

Expected reduction: 20-30% of total session tokens
```

## Links

- `.claude/hooks/post-execute-summarize.sh`
- `.claude/IMPLEMENTATION_GUIDE.md` — Step 2
