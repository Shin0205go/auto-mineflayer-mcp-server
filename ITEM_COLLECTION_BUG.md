# Item Collection Bug Report

## Problem
Mineflayer bot cannot collect items from mining, despite items spawning within auto-pickup range.

## Evidence
- Items spawn correctly (confirmed via get_nearby_entities)
- Items within 0.5-1 block range (should auto-collect)
- Server gamerules OK (doTileDrops=true)
- collectNearbyItems() fails

## Intermittent Success
- Y=95+: items collected ✅
- Y=65-80: items NOT collected ❌
- Likely chunk loading or entity tracking issue

## Attempted Fixes
1. Changed bot.dig forceLook to false
2. Improved collectNearbyItems logic
3. Still fails in certain Y-levels

## Root Cause
Likely Mineflayer/server version incompatibility or entity tracking bug.

## Workaround
Use auto_collect=false in affected areas, collect at surface.
