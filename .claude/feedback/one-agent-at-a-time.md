# Feedback: One Agent at a Time

**Type:** System Constraint
**Date:** 2026-03-20+
**Status:** Active (enforced)

## Rule

**1 エージェント = 1 ボット。複数ボット同時起動禁止。**

## Why

- Bot daemon is single-instance
- Pathfinder race conditions (concurrent goal conflicts)
- Chat message ordering ambiguity
- Context window overflow (multiple agents)

## Implementation

### Startup
```bash
# OK: 1 agent, 1 bot
node scripts/mc-connect.cjs localhost 25565 Claude1

# NOT OK: 2 agents simultaneously
node scripts/mc-connect.cjs localhost 25565 Claude1 &
node scripts/mc-connect.cjs localhost 25565 Claude2 &
```

### Sequencing
```
Session 1: Claude1 for 30 minutes
  → mc_disconnect or timeout

Session 2: Claude2 begins
  (bot respawned or reconnected)

Session N: Claude N continues
```

### Team Coordination
- Leader (Claude1) coordinates via chat
- Followers receive instructions sequentially
- Turn-taking model: one bot active at a time

## Monitoring

System checks:
- [ ] Only one bot `user.agents[0]` is active
- [ ] No concurrent mc_execute calls
- [ ] Bot disconnect before next agent starts
- [ ] Chat message history is clean (no overlaps)

## Links

- `CLAUDE.md` — Team coordination rules
- `.claude/rules/team-coordination.md` (if exists)
