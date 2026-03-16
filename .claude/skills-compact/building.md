---
name: building
description: mc_buildで構造物を建設。place_blockの手動繰り返し不要
---
## 基本
```
mc_build(preset="shelter", size="small")
```
presets: shelter / wall / platform / tower
sizes: small(50ブロック) / medium(150) / large(300)

## Base Protocol (Phase 1)
1. `mc_gather(block="oak_log", count=16)`
2. `mc_craft(item="crafting_table")`
3. `mc_gather(block="cobblestone", count=24)`
4. `mc_craft(item="furnace")`
5. `mc_craft(item="chest", count=3)`
6. `mc_build(preset="shelter", size="small")`

## 個別ブロック設置が必要な時
`mc_place_block(block_type="furnace", x=..., y=..., z=...)`
