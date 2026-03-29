---
name: maxDropDown and physicsTick threshold must stay in sync
description: moveToBasic has two interlocking parameters that must always match: maxDropDown (pathfinder) and totalFall threshold (physicsTick detector)
type: project
---

## Rule

In `src/bot-manager/bot-movement.ts` (moveToBasic), two parameters must always be equal:

1. `bot.pathfinder.movements.maxDropDown = N` (around line 867)
2. `if (totalFall > N)` in the physicsTick handler (around line 830)

Both are currently set to `4`.

## Why

If maxDropDown > threshold: pathfinder plans N-block drops, but physicsTick aborts them mid-execution, resulting in false-positive fall_detected failures.

If maxDropDown < threshold: physicsTick allows falls larger than what pathfinder intends — potential fall damage.

## History

- maxDropDown=2, threshold=3: worked (threshold > maxDropDown gave headroom, but caused no_path on 3-block terrain)
- maxDropDown=3, threshold=3: BROKEN — pathfinder planned 3-block drops, threshold triggered exactly at 3 blocks mid-drop → no_path on birch_forest mountain spawn (Y=82-94). Session 64 exhibited this: moveTo(200,70,200) returned ESCAPED:false in 5294ms without reaching thinkTimeout.
- maxDropDown=4, threshold=4: CURRENT — Minecraft fall damage starts at >4 blocks, so 4-block drops are safe.

## Minecraft fall damage reference

- 3 blocks: 0 damage
- 4 blocks: 0 damage (threshold is "more than 3 blocks" = distance > 3)
- 5+ blocks: damage starts at 1HP for 5-block fall
- Safe range to allow: up to 4 blocks
