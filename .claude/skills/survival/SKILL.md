---
name: survival
description: |
  サバイバル行動の手順書。mc_*コアツールで食料確保・HP回復・夜間処理・緊急対応を実行。
  ALWAYS use when: お腹が空いた、HPが低い、食料がない、夜になった、リスポーン直後、生存の基本行動が必要な時。
---

# サバイバルスキル

mc_*コアツールを使ったサバイバル手順書。各ステップの結果を見て次の判断をせよ。

## Day 1 Protocol（初日プロトコル）

新規セッション開始時、この順番で1ステップずつ実行せよ。

| # | ツール | 目的 | 失敗時の代替 |
|---|--------|------|-------------|
| 1 | `mc_status()` | 状況把握（HP/位置/バイオーム/インベントリ） | — |
| 2 | `mc_gather(block="oak_log", count=10)` | 木材収集 | birch_log, spruce_logを試す |
| 3 | `mc_craft(item="crafting_table")` | 作業台 | — |
| 4 | `mc_craft(item="wooden_pickaxe")` | ツルハシ | — |
| 5 | `mc_craft(item="wooden_sword")` | 剣 | — |
| 6 | `mc_combat(target="cow")` | 食料狩り | pig→chicken→sheep→zombie(rotten_flesh) |
| 7 | `mc_eat()` | 食事 | — |
| 8 | `mc_gather(block="cobblestone", count=20)` | 石収集 | — |
| 9 | `mc_craft(item="stone_pickaxe")` | 石ツルハシ | — |
| 10 | `mc_craft(item="stone_sword")` | 石の剣 | — |
| 11 | `mc_build(preset="shelter", size="small")` | シェルター | 壁を建てるだけでも可 |

**各ステップは独立して完結。失敗したら次に進め（完璧を求めるな）。**

---

## Night Protocol（夜間プロトコル）

`mc_status()`でtime.phase="night"/"midnight"の時：

1. `mc_status()` — 脅威を確認
2. ベッドがインベントリにあれば → `mc_sleep()` (Tier2ツール、夜のみ表示)
3. ベッドがなければ：
   - シェルター内にいるか確認
   - シェルターがなければ `mc_build(preset="shelter", size="small")`
   - 敵が近ければ `mc_combat()` で排除
4. 夜明けまで `mc_status()` で状況監視

---

## Food Emergency Protocol（食料緊急プロトコル）

食料が尽きた時の優先順位：

1. `mc_status()` — インベントリ内の食料確認
2. `mc_eat()` — 何か食べられるものがあれば即食べる
3. `mc_store(action="list")` — チェストに食料があるか確認
4. チェストに食料あれば → `mc_store(action="withdraw", item_name="bread")`
5. チェストにもなければ → 狩猟:
   - `mc_combat(target="cow")` → cow>pig>chicken>sheep
   - `mc_eat()` — 生肉でも食べる
6. 動物もいなければ → ゾンビ狩り:
   - `mc_combat(target="zombie")` → rotten_fleshを得る
   - `mc_eat(food="rotten_flesh")` — 飢餓死よりマシ
7. 最終手段 → 釣り (search_toolsで"fish"を検索)

**HPが低くてもリスポーンするな。食料で回復せよ。**

---

## HP/食料の行動ガイド

| HP | 腹具合 | すべきこと |
|----|--------|-----------|
| 20 | < 15 | `mc_eat()` → 食料なければFood Emergency Protocol |
| < 10 | 任意 | 即 `mc_eat()` → 食料なければ上記プロトコル |
| < 5 | 任意 | `mc_flee()` (Tier2) → 安全な場所で `mc_eat()` |
| < 4 | 脅威あり | 絶対に戦闘するな。`mc_flee()` 最優先 |

---

## 食料の選好順

1. 調理済み肉（cooked_beef等）← 最高効率
2. パン・農作物 ← あれば使う
3. 生肉（beef, porkchop等）← 十分に有効
4. 腐った肉（rotten_flesh）← 飢餓死よりマシ。緊急時OK

---

## エラー対応

- `No food in inventory`: Food Emergency Protocol実行
- 動物がいない: チェスト確認 → ゾンビ狩り → 釣り
- サーバーに動物がスポーンしない: チェストのみが食料源
