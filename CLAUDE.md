# CLAUDE.md - Mineflayer MCP Server

Claude AIがMinecraftを自律プレイするMCPサーバー。Mineflayer + MCPプロトコル。

## コマンド

```bash
npm install && npm run build   # セットアップ
npm run dev                    # 開発モード（ウォッチ）
npm start                      # MCPサーバー起動
```

## アーキテクチャ

MCPツールは4つだけ:

| ツール | 用途 |
|--------|------|
| `mc_execute` | **メインツール。** bot.* APIでJSコードを実行 |
| `mc_connect` | Minecraftサーバーへの接続/切断 |
| `mc_chat` | チャット送受信（毎アクション確認必須） |
| `mc_reload` | コード変更後のホットリロード |

### mc_execute の bot.* API

```js
// mc_execute 内で使える全API（全てasync、await必須）
await bot.status()           // HP, hunger, position, inventory, nearbyEntities
await bot.inventory()        // インベントリのみ
await bot.moveTo(x, y, z)   // 座標移動
await bot.navigate(target)   // ブロック/エンティティ検索+移動
await bot.flee(distance?)    // 逃走
await bot.pillarUp(height?)  // 積み上げ
await bot.gather(block, count?) // 採掘
await bot.craft(item, count?, autoGather?) // クラフト
await bot.smelt(item, count?) // 精錬
await bot.eat(food?)         // 食事
await bot.combat(target?)    // 戦闘/狩猟
await bot.equipArmor()       // 防具自動装備
await bot.place(block, x, y, z) // ブロック設置
await bot.build(preset, size?) // 建築
await bot.farm()             // 農場
await bot.store(action, ...) // チェスト操作
await bot.drop(item, count?) // アイテム破棄
await bot.chat(message)      // チャット送信
await bot.getMessages()      // メッセージ取得
bot.log(message)             // ログ出力
await bot.wait(ms)           // 待機（最大30秒/回）
```

詳細: `.claude/skills-compact/bot-api.md`
フェーズ別手順: `.claude/skills-compact/` 参照

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

- **毎アクションごとに `mc_chat()` を呼べ**
- リーダー: フェーズ宣言+タスク指示が最優先
- フォロワー: リーダー指示に従う。なければフェーズ目標で自律行動
- 人間のチャットは最優先

### 禁止事項

- **リスポーンでHP回復するな。** 食料を食べろ。食料がなければ `bot.combat("cow")` で確保。
- **adminの/giveに頼るな。** 全アイテム自力入手。
- 同じ行動を3回失敗したらアプローチを変えろ。
- **tmp_scripts/ にスクリプトを作るな。** mc_execute の bot.* API で解決できないなら `src/tools/core-tools.ts` を修正しろ。
- **ゲーム仕様で詰まったら WebSearch で Minecraft Wiki を調べてから行動しろ。** 例: `WebSearch("minecraft blaze spawner location wiki")`

### 死亡 = バグ

死亡は全てバグ。`bug-issues/bot{N}.md` に死因・座標・直前の行動を記録しろ。

### コード修正

ゲームエージェントはコード修正しない。バグは `bug-issues/bot{N}.md` に記録のみ。
別のコードレビューアーエージェント（general-purpose）が定期的にバグレポートを読んで修正する。

**主要ソースファイル：**
- `src/tools/core-tools.ts` — mc_status, mc_gather, mc_craft等の実装
- `src/tools/core-tools-mcp.ts` — MCP schema + handler
- `src/tools/mc-execute.ts` — mc_execute sandbox (bot.* API)
- `src/tools/high-level-actions.ts` — mc_build, mc_farm等
- `src/bot-manager/` — botManager, pathfinder, combat, crafting等
- `src/index.ts` — MCPサーバーエントリポイント（4ツールのみルーティング）
- `src/tool-filters.ts` — tools/listの可視性フィルター
