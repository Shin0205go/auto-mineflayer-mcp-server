## [2026-04-02] Bug: Hunger Crisis - HP Dropping to 10/20, Hunger 0/20

### Cause
- Hunger dropped to 3 during mining at Y=60
- Attempted to eat wheat but consume() timed out
- AutoSafety did not prevent food depletion
- Current HP: 10, Hunger: 0 (critical)

### Timeline
1. T=00:00 Phase 3 mining started, HP 20, Hunger 14
2. T=03:00 Returned to base after mining, Hunger dropped to 3
3. T=03:30 wheat consumption failed (timeout on bot.consume())
4. T=03:45 HP 12, Hunger 0
5. T=04:00 HP 10, Hunger 0 (current)

### Coordinates
- Base: X=26, Y=101, Z=3 (bed location)
- Mining site: X=151, Y=60, Z=13

### Last Actions
- Attempted bot.consume() on wheat (timeout)
- Pathfinder returned to base
- Re-check inventory for food sources (wheat=1, no bread/meat available)

### Error Message
```
wheat を食べる
fail: Promise timed out.
Hunger: 0
```

### AutoSafety Issues
- AutoSafety did not auto-eat when Hunger dropped to 0
- No automatic regen on HP < 10
- consume() appears to have timeout issues when bot is in critical state

### Status
Reported (urgent - immediate action needed to prevent death)
