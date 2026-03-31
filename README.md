# Mineflayer MCP Server

**Claude AIエージェントがMinecraftを自律プレイするMCPサーバー**

Mineflayer + MCPプロトコルで、Claude Codeから直接Minecraftを操作。
`mc_execute` でJavaScriptコードを書いてbot.* APIを実行する方式。

## セットアップ

```bash
npm install
npm run build
```

## 起動

```bash
# MCPサーバー起動（stdio）- Claude Code / Claude Desktop用
npm start

# 開発モード（ウォッチ）
npm run dev
```

## アーキテクチャ

```
┌─────────────────────────┐
│  Claude Code / Agent    │  ← minecraft-bugfix-agent
└──────────┬──────────────┘
           │ MCP (stdio)
┌──────────▼──────────────┐
│  4 MCP Tools            │
│  mc_execute (main)      │  ← bot.* API でJS実行
│  mc_connect / mc_chat   │
│  mc_reload              │
└──────────┬──────────────┘
           │ bot.* → core-tools.ts
┌──────────▼──────────────┐
│  Bot Manager            │  ← Mineflayer API
│  bot-core / bot-movement│
│  bot-survival / etc.    │
└─────────────────────────┘
```

### MCPツール

| ツール | 機能 |
|--------|------|
| `mc_execute` | **メインツール。** mineflayer生APIでJSコードを実行 |
| `mc_connect` | サーバー接続・切断 |
| `mc_chat` | チャット送受信 |
| `mc_reconnect` | 死亡後の再接続 |

### mc_execute（メイン操作）

エージェントは mineflayer の生APIを直接書く。サンドボックス内で実行。

```js
// 注入済みオブジェクト
bot                    // mineflayer Bot インスタンス
Movements, goals, Vec3 // pathfinder ユーティリティ
log(msg), wait(ms), getMessages(), pathfinderGoto(goal, timeout)

// 例: 木を採掘
const block = bot.findBlock({matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32});
if (block) {
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  await bot.dig(block);
}
```

制約: `require()` 禁止、デフォルトタイムアウト 120秒（最大 600秒）、`wait()` は1回30秒まで。

詳細: `.claude/rules/mc-execute-api.md`

### 既知の制約

mineflayer / mineflayer-pathfinder に起因する制約:

| 制約 | 原因 | 対処 |
|------|------|------|
| 地下からの脱出困難 | pathfinderは上方向の経路探索が苦手 | `bot.pillarUp()` or `bot.flee()` 連打 |
| 構造物内で移動不能 | ドア・はしご・段差で経路が見つからない | 座標直指定の `bot.moveTo()` |
| 採掘でアイテムが拾えない | アイテムエンティティの回収タイミング | `collectItemDrop` 待機（bot-survival.ts） |
| navigate完了だが未移動 | pathfinderが「到達済み」と誤判定 | 移動距離チェック + リトライ |
| 長距離移動のタイムアウト | pathfinder計算が重い（>100ブロック） | 中間地点に分割して移動 |

### ブートストラップ

新規ワールドでは最初のアイテム入手にサーバー管理者の介入が必要:

```bash
# Minecraftサーバーコンソールで実行
/give Claude1 wooden_pickaxe 1
/give Claude1 bread 10
# 以降はbot自身でgather → craft → 自立
```

keepInventory有効推奨（`/gamerule keepInventory true`）。
死亡はバグとして扱い、意図的なリスポーンは禁止。

## エージェント構成

3体のゲームエージェント + 1体のコードレビューアー:

| エージェント | 役割 | 定義 |
|-------------|------|------|
| Claude1 (Leader) | フェーズ宣言+タスク指示 | `.claude/agents/minecraft-bugfix-agent.md` |
| Claude2 (Follower) | リーダー指示に従う | `.claude/agents/minecraft-bugfix-agent-2.md` |
| Claude3 (Follower) | リーダー指示に従う | `.claude/agents/minecraft-bugfix-agent-3.md` |
| CodeReviewer | バグレポート分析+コード修正 | general-purpose agent |

ゲームエージェントはコード修正しない。バグは `bug-issues/botN.md` に記録のみ。

## フェーズ（エンダードラゴン討伐まで）

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

## 主要ファイル

```
src/
├── daemon.ts               # HTTPデーモン（port 3099）
├── viewer-server.ts        # Webダッシュボード・ミニマップ
├── bot-manager/            # Mineflayerボット管理
│   ├── index.ts            # 統合BotManager
│   ├── bot-core.ts         # 接続・pathfinder設定・クリーパー回避
│   ├── bot-movement.ts     # 移動・落下検知・flee
│   ├── bot-survival.ts     # 戦闘・食事・アイテム回収
│   ├── bot-crafting.ts     # クラフト・精錬
│   └── ...                 # blocks, items, storage, info, utils, types
└── tools/
    ├── core-tools.ts       # mc_status, mc_connect, mc_chat, mc_reconnect
    └── mc-execute.ts       # vm sandbox + mineflayer API注入

scripts/                    # CLI操作スクリプト
.claude/agents/             # ゲームエージェント定義
.claude/skills/             # 22スキルガイド（オンデマンドRead）
.claude/rules/              # 生存・死亡防止・フェーズガイド
bug-issues/                 # 死亡バグ記録
```

## 環境変数

```bash
MC_HOST=localhost       # Minecraftサーバーホスト
MC_PORT=25565           # Minecraftサーバーポート
BOT_USERNAME=Claude1    # ボット名
AGENT_TYPE=game         # エージェントタイプ（game/dev）
VIEWER=1                # Webビューア有効化
VIEWER_PORT=3007        # ビューアポート
```

## ライセンス

MIT
