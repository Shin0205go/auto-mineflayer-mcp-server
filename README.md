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

### MCPツール（4つのみ）

| ツール | 機能 |
|--------|------|
| `mc_execute` | **メインツール。** bot.* APIでJSコードを実行 |
| `mc_connect` | サーバー接続・切断 |
| `mc_chat` | チャット送受信 |
| `mc_reload` | コード変更後のホットリロード |

### bot.* API（mc_execute内で使用）

```js
bot.status()              // HP, hunger, position, inventory, nearbyEntities
bot.inventory()           // インベントリのみ
bot.moveTo(x, y, z)      // 座標移動
bot.navigate(target)      // ブロック/エンティティ検索+移動
bot.flee(distance?)       // 逃走
bot.gather(block, count?) // 採掘
bot.craft(item, count?, autoGather?) // クラフト
bot.combat(target?)       // 戦闘/狩猟
bot.eat(food?)            // 食事
bot.farm()                // 農場
bot.build(preset, size?)  // 建築
bot.store(action, ...)    // チェスト操作
// 他: pillarUp, smelt, equipArmor, place, drop, chat, getMessages, log, wait
```

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
├── index.ts                # MCPサーバー（4ツールのルーティング）
├── mcp-proxy.ts            # エージェント用プロキシ
├── tool-filters.ts         # tools/list可視性（VISIBLE_TOOLS set）
├── bot-manager/            # Mineflayerボット管理
│   ├── index.ts            # 統合BotManager
│   ├── bot-core.ts         # 接続・pathfinder設定
│   ├── bot-movement.ts     # 移動・落下検知・flee
│   ├── bot-survival.ts     # 戦闘・食事・リスポーン
│   ├── bot-crafting.ts     # クラフト・精錬
│   └── ...                 # blocks, items, storage, info, utils, types
└── tools/
    ├── core-tools.ts       # bot.* API実装（mc_status, mc_gather等）
    ├── core-tools-mcp.ts   # MCP スキーマ定義
    ├── mc-execute.ts       # vm sandbox + bot APIオブジェクト構築
    └── high-level-actions.ts # mc_build, mc_farm実装

.claude/
├── agents/                 # ゲームエージェント定義
├── skills-compact/         # スキルファイル（bot.* API形式）
└── hooks/                  # エージェント用フック

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
