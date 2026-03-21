# Mineflayer MCP Server

**Claude AIエージェントがMinecraftを自律プレイするMCPサーバー**

Mineflayer + MCPプロトコルで、Claude Codeから直接Minecraftを操作。
`minecraft-bugfix-agent`による自律プレイ＋リアルタイムバグ修正。

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

## アーキテクチャ: 3-Tier Tool System

48+ の低レベルツールを11個のコアツールに統合。

```
┌─────────────────────────┐
│  Claude Code / Agent    │  ← minecraft-bugfix-agent
└──────────┬──────────────┘
           │ MCP (stdio)
┌──────────▼──────────────┐
│  Tier 1: Core Tools     │  ← 10 + search_tools（常時表示）
│  Tier 2: Situational    │  ← 条件付き表示（夜間、低HP等）
│  Tier 3: Legacy         │  ← search_tools経由で検索可能
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│  Bot Manager (11モジュール) │  ← Mineflayer API
│  bot-core / bot-movement│
│  bot-blocks / bot-items │
│  bot-crafting / etc.    │
└─────────────────────────┘
```

### Tier 1: コアツール（常時表示）

| ツール | 機能 |
|--------|------|
| `mc_status` | HP・満腹度・位置・インベントリ・脅威・近くのリソースを一括取得 |
| `mc_gather` | ブロックの探索・移動・採掘・回収（木材・石・鉱石） |
| `mc_craft` | 依存関係自動解決クラフト（autoGather対応） |
| `mc_build` | プリセット建築（シェルター・壁・塔） |
| `mc_navigate` | 座標・ブロック・エンティティへの移動 |
| `mc_combat` | 戦闘（最適武器自動装備・ドロップ回収） |
| `mc_eat` | 食事（生肉は近くのかまどで自動調理） |
| `mc_store` | チェスト操作（一覧・預入・引出・一括保管） |
| `mc_chat` | チャット送受信 |
| `mc_connect` | サーバー接続・切断 |
| `search_tools` | Tier 3ツールの検索・発見 |

### Tier 2: 条件付きツール

| ツール | 表示条件 |
|--------|----------|
| `mc_sleep` | 夜間（timeOfDay > 12541） |
| `mc_flee` | HP < 10 |
| `mc_death_recovery` | リスポーン後 |

### Tier 3: レガシーツール

`search_tools` で検索可能。Tier 1で対応できない場合の最終手段。

## minecraft-bugfix-agent

Claude Codeのカスタムエージェント。自律的にMinecraftをプレイしながら、遭遇したバグをリアルタイムで修正。

### 設定

`.claude/agents/minecraft-bugfix-agent.md` で定義:
- **モデル**: sonnet（高速）
- **最大ターン**: 30
- **権限**: dontAsk（自律操作）
- **MCPサーバー**: mineflayer（stdio経由、プロキシ使用）

### 使い方

```
# Claude Codeで起動
> minecraft-bugfix-agentを起動してPhase 2を進めて

# またはcronで自動監視
> エージェントの状態を10分ごとに確認して、完了したら再起動
```

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

## 主要ファイル

```
src/
├── index.ts                # MCPサーバー（stdio）+ ルーティング
├── mcp-proxy.ts            # エージェント用プロキシ
├── viewer-server.ts        # Webビューア（port 3007）
├── tool-filters.ts         # 3-tier フィルタリング
├── tool-metadata.ts        # search_tools用タグ
├── bot-manager/            # Mineflayerボット管理
│   ├── index.ts            # 統合BotManager
│   ├── bot-core.ts         # 接続・pathfinder設定
│   ├── bot-movement.ts     # 移動・落下検知・flee
│   ├── bot-blocks.ts       # ブロック操作
│   ├── bot-crafting.ts     # クラフト・精錬
│   ├── bot-items.ts        # アイテム管理・装備
│   ├── bot-storage.ts      # チェスト操作
│   ├── bot-survival.ts     # 戦闘・食事・リスポーン
│   ├── minecraft-utils.ts  # ヘルパー
│   └── types.ts            # 型定義
└── tools/
    ├── core-tools.ts       # Tier 1 ツール実装
    ├── core-tools-mcp.ts   # MCP スキーマ定義
    └── high-level-actions.ts # 高レベルアクション

.claude/
├── agents/
│   └── minecraft-bugfix-agent.md  # 自律プレイエージェント定義
├── skills/                 # スキルプロトコル（.md）
├── skills-compact/         # コンパクト版スキル
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

## 安全機構

- **maxDropDown=1**: パスファインダーの最大落下を1ブロックに制限
- **allowFreeMotion=false**: 中間ノードスキップを禁止（崖落下防止）
- **physicsTick落下検知**: 累積2ブロック以上の落下で即時停止
- **HP安全チェック**: 低HPでの長距離移動をブロック
- **ポータル回避**: ネザー/エンドポータルブロックを自動回避
- **溶岩回避**: 溶岩ブロックをパスファインダーで回避

## ライセンス

MIT
