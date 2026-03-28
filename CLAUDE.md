# CLAUDE.md - Mineflayer Bot

Claude AIがMinecraftを自律プレイするボット。CLIモード。

## CLIスクリプト

```bash
# ボット接続
node scripts/mc-connect.cjs localhost 25565 Claude1

# コード実行（メイン操作）
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "await bot.status()"
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "await bot.gather('oak_log', 10)"

# タイムアウト指定
MC_TIMEOUT=60000 BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "await bot.moveTo(100, 70, 100)"

# チャット送信
node scripts/admin-chat.cjs "[指示] メッセージ"
```

## mc_execute サンドボックスAPI

mc_execute 内で直接使えるオブジェクト・関数:

```js
// ─── mineflayer生Bot（全メソッド・プロパティにアクセス可能）───
bot              // mineflayer Bot インスタンス

// ─── pathfinder ───────────────────────────────────────────────
Movements        // new Movements(bot) でpathfinder設定
goals            // goals.GoalNear, goals.GoalBlock, goals.GoalXZ, goals.GoalY, goals.GoalFollow, ...
Vec3             // new Vec3(x, y, z)

// ─── シンヘルパー ──────────────────────────────────────────────
await status()   // { hp, hunger, position, inventory, nearbyEntities, warnings, ... }
await wait(ms)   // 待機 (最大30000ms)
log("msg")       // デバッグログ
getMessages()    // チャット履歴 配列
await reconnect() // ボット再接続
await chat(msg)  // チャット送信
```

**よく使うパターン:**

```js
// 移動
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));

// ブロック採掘
const block = bot.findBlock({ matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32 });
if (block) await bot.dig(block);

// クラフト (crafting_tableなし: null, ありなら blockオブジェクト)
const table = bot.findBlock({ matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4 });
const recipes = bot.recipesFor(bot.registry.itemsByName['wooden_pickaxe'].id, null, 1, table);
if (recipes[0]) await bot.craft(recipes[0], 1, table);

// 戦闘
const mob = bot.nearestEntity(e => e.name === 'zombie');
if (mob) {
  await bot.equip(bot.inventory.items().find(i => i.name.includes('sword')), 'hand');
  await bot.attack(mob);
}

// アイテム収集（ドロップアイテムはentity）
const dropped = Object.values(bot.entities).filter(e =>
  e.name === 'item' && e.position.distanceTo(bot.entity.position) < 5
);
// アイテムは自動収集される（近づけばOK）

// インベントリ確認
const items = bot.inventory.items();
const wood = items.find(i => i.name === 'oak_log');
log('wood count: ' + (wood?.count ?? 0));

// ブロック設置
const pos = bot.entity.position.floored();
const refBlock = bot.blockAt(pos.offset(0, -1, 0));
if (refBlock) await bot.placeBlock(refBlock, new Vec3(0, 1, 0));

// 状態確認
const s = await status();
log('HP:' + s.hp + ' Pos:' + JSON.stringify(s.position));
if (s.warnings) s.warnings.forEach(w => log('[WARNING] ' + w));
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

- **リスポーンでHP回復するな。** 食料を食べろ。食料がなければ `bot.combat("cow")` で確保。
- **adminの/giveに頼るな。** 全アイテム自力入手。
- 同じ行動を3回失敗したらアプローチを変えろ。
- **tmp_scripts/ にスクリプトを作るな。** bot.* API で解決できないなら `src/tools/core-tools.ts` を修正しろ。
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
