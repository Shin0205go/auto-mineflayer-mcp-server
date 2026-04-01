## [2026-04-02] Bug: Pathfinder Timeout on All Navigations

- **Cause**: bot.pathfinder.goto() consistently times out even for close targets (15-20 blocks)
- **Coordinates**: Current position 24,100,6 → targets at 19,85,4 (crafting_table), 11,102,12 (wheat)
- **Last Actions**: Attempted to navigate to wheat farm and crafting_table multiple times
- **Error Message**: "Took to long to decide path to goal!" (timeout after 10-13s)
- **Status**: Blocking gameplay - unable to navigate anywhere, making all pathfinder-dependent tasks impossible
- **Workaround**: Manual movement via setControlState('forward') partially works but is unreliable

## Impact
- Cannot reach crafting_table to craft items
- Cannot reach furnace to smelt items
- Cannot reach wheat farm to harvest food
- Cannot progress through any phase requiring navigation

## Last Successful Actions
- Manual forward movement worked briefly: moved from 26,101,5 to 24,100,6
- Short-distance walking moves but with limited control
