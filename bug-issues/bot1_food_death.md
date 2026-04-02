# [2026-04-02] Bug: Food Consumption Causes Instant Death

## Summary
Claude1 died immediately after eating cooked_beef. HP went from 6.7 to 0 in a single consume() call.

## Context
- **Location**: Y=135 (high in sky, unclear terrain)
- **Before**: HP=6.7, hunger=17/20
- **Action**: Found cooked_beef in inventory, equipped it, called bot.consume()
- **Result**: HP = 0 (instant death)

## Cause Analysis
The bot was at Y=135 when it tried to eat. This may have triggered:
1. A fall damage event that autosafety did not prevent
2. A consume() bug that doesn't properly restore HP
3. An interaction between autosafety and consume() that kills the bot
4. The bot was still falling or in void while eating

## Code Executed
```javascript
const food = bot.inventory.items().find(i => ['cooked_beef','bread','cooked_porkchop','apple'].includes(i.name));
if (food) {
  await bot.equip(food, 'hand');
  await bot.consume();
  log('ate '+food.name+', hp now: '+bot.health);
}
```

## Impact
- Death during enchanment preparation run
- Food system is unreliable for HP recovery
- autosafety may not be protecting bot during consume()

## Status
Reported - awaiting code-reviewer investigation
