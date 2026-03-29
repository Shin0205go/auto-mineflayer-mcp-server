# CLAUDE.md - Mineflayer Bot

Claude AIがMinecraftを自律プレイするボット。CLIモード。

## CLIスクリプト

```bash
# ボット接続
node scripts/mc-connect.cjs localhost 25565 Claude1

# コード実行（メイン操作）
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log(bot.health + ' ' + bot.food)"

# タイムアウト指定
MC_TIMEOUT=60000 BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "<code>"

# チャット送信
node scripts/admin-chat.cjs "[指示] メッセージ"
```

## mc_execute API

**`bot` は生の mineflayer Bot インスタンス。mineflayer の公式APIをそのまま使え。**
`bot.chat()`, `bot.dig()`, `bot.attack()`, `bot.craft()`, `bot.equip()`, `bot.consume()`,
`bot.pathfinder.goto()`, `bot.findBlock()`, `bot.nearestEntity()`, `bot.inventory.items()` 等。
わからなければ mineflayer ドキュメントを参照: https://github.com/PrismarineJS/mineflayer

**⚠️ mc_execute内では `require()` は使えない。以下の変数はすでにスコープに注入されている。自分でimport/requireするな。**

mc_execute 内で直接使えるオブジェクト・関数:

```js
// ─── mineflayer生Bot ──────────────────────────────────────────
bot              // mineflayer Bot インスタンス（全メソッド・プロパティ直接使用可）
bot.health       // HP (0-20)
bot.food         // hunger (0-20)
bot.entity.position // Vec3 座標
bot.inventory.items() // インベントリアイテム配列
bot.chat("msg")  // チャット送信
bot.dig(block)   // ブロック採掘
bot.attack(entity) // 攻撃
bot.equip(item, dest) // 装備
bot.craft(recipe, count, table) // クラフト（mineflayer標準）
bot.recipesFor(itemId, metadata, count, table) // レシピ取得
bot.findBlock({ matching, maxDistance }) // ブロック探索
bot.nearestEntity(filter) // エンティティ探索
bot.pathfinder.goto(goal) // pathfinder移動
bot.pathfinder.setMovements(movements) // pathfinder設定

// ─── pathfinder ───────────────────────────────────────────────
Movements        // new Movements(bot) でpathfinder設定
goals            // goals.GoalNear, goals.GoalBlock, goals.GoalXZ, goals.GoalY, goals.GoalFollow, ...
Vec3             // new Vec3(x, y, z)

// ─── ユーティリティ（トップレベル関数）────────────────────────
await wait(ms)   // 待機 (最大30000ms)
log("msg")       // デバッグログ
getMessages()    // チャット履歴 配列
```

**よく使うパターン:**

```js
// 状態確認（bot直読み）
log('HP:' + bot.health + ' Food:' + bot.food);
const pos = bot.entity.position;
log('Pos: ' + Math.floor(pos.x) + ',' + Math.floor(pos.y) + ',' + Math.floor(pos.z));

// インベントリ確認
const items = bot.inventory.items();
const wood = items.find(i => i.name === 'oak_log');
log('wood: ' + (wood?.count ?? 0));

// チャット確認
const msgs = getMessages();

// 移動
const movements = new Movements(bot);
movements.canDig = false;
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));

// ブロック採掘
const block = bot.findBlock({ matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32 });
if (block) {
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  await bot.dig(block);
}

// クラフト
const table = bot.findBlock({ matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4 });
const recipes = bot.recipesFor(bot.registry.itemsByName['stone_pickaxe'].id, null, 1, table);
if (recipes[0]) await bot.craft(recipes[0], 1, table);

// 戦闘
const mob = bot.nearestEntity(e => e.type === 'mob');
if (mob) {
  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  if (sword) await bot.equip(sword, 'hand');
  await bot.attack(mob);
}

// 食事
const food = bot.inventory.items().find(i => bot.isABed ? false : ['bread','cooked_beef','cooked_porkchop','cooked_chicken'].includes(i.name));
if (food && bot.food < 18) { await bot.equip(food, 'hand'); await bot.consume(); }
```

## スキル（プログレッシブディスクロージャー）

必要になったら `Read(.claude/skills/<name>/SKILL.md)` で読め。

| スキル | 説明 | 主なフェーズ |
|--------|------|-------------|
| survival | 食料・HP・夜対処 | 常時 |
| team-coordination | チーム連携ルール | 常時 |
| resource-gathering | 自動探索・採掘 | 1-3 |
| building | 構造物建設 | 1-2 |
| bed-crafting | ベッド作成・夜スキップ | 1 |
| auto-farm | 食料農場運用 | 2 |
| crafting-chain | 自動クラフト連鎖 | 3-4 |
| iron-mining | 鉄鉱採掘・精錬 | 4 |
| diamond-mining | ダイヤ採掘 | 5 |
| enchanting | エンチャント設置 | 5 |
| nether-gate | ネザーポータル建設 | 6 |
| nether-fortress | ネザー要塞探索 | 6 |
| blaze-spawner | ブレイズロッド入手 | 6 |
| potion-brewing | ポーション醸造 | 6-7 |
| ender-dragon | ドラゴン討伐 | 8 |
| exploration | 広範囲探索・発見 | 任意 |
| terrain-management | 採掘後の穴埋め・平地化 | 常時 |

## マルチボット協調

Claude1（リーダー）+ Claude2〜7（フォロワー）。最終目標: エンダードラゴン討伐。

### フェーズ

| Phase | 目標 | 完了条件 |
|-------|------|----------|
| 1 | 拠点確立 | 作業台・かまど・チェスト3個・シェルター |
| 2 | 食料安定化 | 畑or牧場、チェストに食料20個以上 |
| 3 | 石ツール | 全員が石ピッケル・斧・剣 |
| 4 | 鉄装備 | 全員が鉄ピッケル+鉄の剣 |
| 5 | ダイヤ | エンチャント台設置 |
| 6 | ネザー | ブレイズロッド7本+エンダーパール12個 |
| 7 | エンド要塞 | ポータル起動 |
| 8 | 討伐 | エンダードラゴン撃破 |

リーダーが `[フェーズ] Phase N 開始` を宣言。フォロワーは従う。
完了条件達成で `[報告] Phase N 完了条件達成` とチャット。

### チャットルール

- **毎アクションごとにチャットで報告しろ** — `bot.chat()` を mc-execute.cjs 内で呼ぶか、`node scripts/admin-chat.cjs` を使え
- リーダー: フェーズ宣言+タスク指示が最優先
- フォロワー: リーダー指示に従う。なければフェーズ目標で自律行動
- 人間のチャットは最優先

### 禁止事項

- **リスポーンでHP回復するな。** 食料を食べろ。食料がなければ牛を探してpathfinder+attackで確保。
- **adminの/giveに頼るな。** 全アイテム自力入手。
- 同じ行動を3回失敗したらアプローチを変えろ。
- **tmp_scripts/ にスクリプトを作るな。** mineflayer API で解決できないなら `src/tools/core-tools.ts` を修正しろ。
- **ゲーム仕様で詰まったら WebSearch で Minecraft Wiki を調べてから行動しろ。**

### 死亡 = バグ

死亡は全てバグ。`bug-issues/bot{N}.md` に死因・座標・直前の行動を記録しろ。
keepInventoryがONでもリスポーンHP回復を戦略にするな。死亡防止ルール:
1. HP < 10 で戦闘禁止。逃げろ。
2. 夜間（13000-23000 tick）に防具なしで長距離移動禁止。pillarUpして待機。
3. 空腹 < 5 で遠征禁止。まず食料確保。
4. 飢餓になる前に食料計画を立てろ。

### 地形管理

採掘後は不要な穴をdirt/cobblestoneで埋め戻せ。整地しながら作業しないとpathfinderが通らなくなる。拠点周辺は特に整地を維持。

### コード修正

ゲームエージェントはコード修正しない。バグは `bug-issues/bot{N}.md` に記録のみ。
別のコードレビューアーエージェントが定期的にバグレポートを読んで修正する。

---
*メタ管理者向け運用情報: `.claude/meta.md`*
