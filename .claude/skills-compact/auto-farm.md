---
name: auto-farm
description: 食料の自動農場建設と運用
---
## 小麦農場（手動）
1. 水バケツを設置（4ブロック以内が耕作範囲）
2. クワで土を耕す（search_tools "use_item"）
3. 種を植える（search_tools "place"）
4. 収穫: `mc_gather(block="wheat", count=20)`

## サトウキビ
- 水に隣接した土/砂の上に設置
- `mc_place_block` で植えて自然成長を待つ
- 収穫: `mc_gather(block="sugar_cane", count=20)`

## 成長時間目安
- 小麦/ニンジン/ジャガイモ: 20-30分
- サトウキビ: 16分/段
- 骨粉で即時成長可能

## Phase 2 目標
チェストに食料20個以上 → `mc_store(action="deposit", item_name="bread")`
