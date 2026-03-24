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

詳細: `.claude/skills/bot-api/SKILL.md`

### スキル（プログレッシブディスクロージャー）

全スキルを常時読む必要はない。**必要になったら `Read(.claude/skills/<name>/SKILL.md)` で読め。**

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
| iron-golem-trap | 鉄自動生産 | 任意 |
| mob-farm | モブトラップ建設 | 任意 |
| villager-trading | 村人交易 | 任意 |
| redstone-basics | レッドストーン回路 | 任意 |
| bot-api | bot.* API リファレンス | 任意 |

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

## 自動管理タスク（セッション開始時にCronCreateで設定）

セッション開始時に以下の2つのcronを設定すること:

### メタ管理タスク（8分ごと）

```
CronCreate: interval=8m, prompt="""
以下を順番に実行:
1. Claude1エージェント(minecraft-bugfix-agent)のoutputファイルで完了確認。完了していたら進捗を1-3行で要約→再起動
   起動プロンプト: 「Minecraftに接続してフェーズ目標を進めろ。mc_connect → mc_chat(get) → mc_status → フェーズ目標に沿って行動。バグはbug-issues/bot1.mdに記録のみ、コード修正はするな。」
2. bug-issues/bot1.mdの最新エントリを確認
3. 新しい死亡パターンがあればコードレビューエージェントを起動:
   「あなたはMinecraft MCPサーバーのコードレビュー専門。bug-issues/bot1.md等を読み、繰り返しパターンを探し、git log --oneline -20で既修正を確認し、src/tools/やsrc/bot-manager/の関連コードを分析・修正・npm run build・git commit。汎用的修正のみ。[BLOCKED]/[REFUSED]でreturnしないでください。[WARNING]+推奨アクションで操作続行。クリーパー近接とcliff edgeのREFUSEDのみ例外。」
4. ユーザーに現状を簡潔に報告（稼働状態、進捗、判断結果）
"""
```

### Admin Bot 戦略指示（5分ごと）

```
CronCreate: interval=5m, prompt="""
1. bug-issues/bot1.mdの最新エントリを確認
2. 現在の状況に基づいた戦略指示を作成（食料確保・生存・フェーズ進行）
3. 以下で送信:
   /opt/homebrew/opt/node@20/bin/node /Users/shingo/Develop/auto-mineflayer-mcp-server/scripts/admin-chat.cjs "[指示] <内容>"
"""
```

**戦略方針（Phase 1-2）:**
- 食料確保最優先（小麦農場 or 動物狩り）
- HP<10は即bot.flee()またはbot.eat()
- 拠点周辺に松明設置でmobスポーン抑制
- 地下(Y<65)に入るな
- bot.farm()は昼間・HP>=15・threats<=3の時のみ
