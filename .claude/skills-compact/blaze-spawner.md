---
name: blaze-spawner
description: ブレイズスポナー部屋の見つけ方・ブレイズロッド入手戦略
---
## Blaze Spawner Room（ブレイズスポナー部屋）

### 構造の特徴
- **部屋サイズ**: 約7x7x4のNether Bricks製小部屋
- **Nether Brick Fence（金属格子）**: 部屋の中心近くにスポナーがある
- **部屋へのアクセス**: 要塞のメイン通路・橋から側室として続く
- **スポナー数**: 要塞1つに通常2個（まれに3個以上）
- **Y座標**: 要塞本体と同じ高さ（通常Y=40-80）

### 見つけ方の手順（確実な方法）
1. まず要塞内部に入る: `mc_navigate(target_block="nether_bricks", max_distance=128)`
2. **nether_brick_fence を探す**: `mc_navigate(target_block="nether_brick_fence", max_distance=64)`
   - nether_brick_fence はスポナー部屋の壁にのみ大量に使われる
   - 通常の要塞通路には使われないため、高精度でスポナー部屋を特定できる
3. nether_brick_fence の近くまで来たら: `mc_navigate(target_block="mob_spawner", max_distance=32)`
4. または直接 `mc_status()` の threats で "blaze" を確認

### 座標(214,25,-134)からの探索戦略
現在の要塞座標から(優先順位順)：
1. `mc_navigate(x=214, y=25, z=-134)` で要塞中心へ
2. `mc_navigate(target_block="nether_brick_fence", max_distance=64)` でスポナー部屋を探す
   - これが最も信頼性が高い方法
3. 見つからない場合: Y座標を変えながら再探索
   - `mc_navigate(x=214, y=45, z=-134)` → `mc_navigate(target_block="nether_brick_fence", max_distance=64)`
   - `mc_navigate(x=214, y=65, z=-134)` → `mc_navigate(target_block="nether_brick_fence", max_distance=64)`
4. 最終手段: `mc_navigate(target_block="mob_spawner", max_distance=64)` で直接探索

### ブレイズ戦闘戦略（装備あり）
- **推奨HP**: 20（フル）+ 食料 + 鉄防具以上
- `mc_combat(target="blaze", flee_at_hp=10)` — 8より高い設定で安全確保
- ブレイズは距離があると火の玉、近接だと殴り攻撃
- **最適戦法**: 石/ネザーレンガで火の玉をブロックしながら近づいて近接攻撃
- **1回の戦闘で2-3本のブレイズロッドを目標**

### ブレイズ戦闘（装備なし・食料なし時のリスク管理）
- フル装備がない場合は戦闘しない
- adminに食料と鉄/ダイヤ防具を依頼してから挑む
- 最低限: 食料16個 + 鉄チェストプレートまたはヘルメット

### 必要アイテム確認
- [ ] 食料 x16以上（HP回復用）
- [ ] **金防具フルセット推奨**（gold_ingot x24でフルセット: helmet+chestplate+leggings+boots）
  - ネザーでgold armorを着るとゾンビピグリン/ピグリンに攻撃されない
  - gold_ingot x31 あり → 全piece作成可能！ `mc_craft(item="gold_helmet")` etc.
  - 鉄防具より効果は低いが、ピグリン回避は鉄防具より価値が高い
  - equipArmor()は自動的にネザーでgold priorityに切り替える（コード実装済み）
- [ ] 鉄の剣以上
- [ ] 丸石128（安全な足場・壁用）
- [ ] 弓 + 矢（あれば）

### スポナー部屋での立ち回り
1. 入口に丸石で壁を作り逃げ場を確保
2. ブレイズが1-2体の時に攻撃
3. スポナーを破壊しない（農場として使えるため）
4. HP < 10 になったら即退避して食料で回復
