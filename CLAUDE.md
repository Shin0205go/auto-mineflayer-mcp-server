# CLAUDE.md - Mineflayer MCP Server

## プロジェクト概要

Claude AIエージェントがMinecraftを自律的にプレイするためのスキルベースMCPサーバー。
Mineflayerライブラリでボットを制御し、MCPプロトコルでClaudeと連携。

**完全自律改善システム** - Claude Codeによる無限ループで、プレイ→エラー検出→修正→コミット→プッシュを自動実行。24時間で75+ループ、20+件の自動バグフィックスを実現。

**Dev Agent方式（代替）** - MCP経由のエージェント連携。ツール失敗時のソースコード修正と行動設定チューニングを自動実行。

## アーキテクチャ

```
┌─────────────────┐                     ┌──────────────────┐
│  Claude Code    │ ──── MCP Stdio ──── │  MCP Server      │
│  (CLI)          │                     │  (index.ts)      │
└─────────────────┘                     └────────┬─────────┘
                                                 │
┌─────────────────┐                     ┌────────▼─────────┐
│  Game Agent     │ ──── WebSocket ──── │  WebSocket MCP   │
│  (claude-agent) │                     │  (mcp-ws-server) │
│  基本ツール20個 │                     │  ツールフィルタ  │
│  スキル実行のみ │                     │                  │
└─────────────────┘                     └────────┬─────────┘
         ▲                                       │
         │ 起動/停止                             │ ログ・ループ結果
         │                               ┌───────▼──────────┐
┌────────┴──────────┐                    │   Bot Manager    │
│    Dev Agent      │                    │   (11モジュール) │
│  (dev-agent.ts)   │                    └────────┬─────────┘
│  全ツール45+      │                             │
│ - ソースコード修正│                    ┌────────▼─────────┐
│ - 設定チューニング│                    │   Minecraft      │
└───────────────────┘                    │   Server         │
                                         └──────────────────┘
```

## スキルベースアーキテクチャ

### エージェントタイプ別ツールアクセス

**Game Agent（ゲームプレイ特化）**
- 基本ツール20個のみ
- 複雑な操作はスキル経由
- 実装詳細を知らない

**Dev Agent（デバッグ・開発用）**
- 全ツール45個以上
- 低レベル操作も可能
- ソースコード修正用

### ツールフィルタリング

```typescript
// mcp-ws-server.ts
minecraft_connect({ agentType: "game" | "dev" })

// Game Agent → 基本ツールのみ (GAME_AGENT_TOOLS)
// Dev Agent → 全ツール（フィルタなし）
```

## ディレクトリ構造

```
src/
├── index.ts              # MCPサーバー (stdio)
├── mcp-ws-server.ts      # MCPサーバー (WebSocket) + ツールフィルタリング
├── bot-manager/          # Mineflayerボット管理（11モジュール）
│   ├── index.ts          # 統合エクスポート
│   ├── bot-core.ts       # 接続・基本機能
│   ├── bot-info.ts       # 情報取得
│   ├── bot-movement.ts   # 移動・探索
│   ├── bot-blocks.ts     # ブロック操作
│   ├── bot-crafting.ts   # クラフト・精錬
│   ├── bot-items.ts      # アイテム管理
│   ├── bot-storage.ts    # チェスト操作
│   ├── bot-survival.ts   # 戦闘・生存
│   ├── minecraft-utils.ts# ヘルパー関数
│   └── types.ts          # 型定義
│
├── tools/                # MCPツール実装
│   ├── high-level-actions.ts  # 高レベル操作（スキル内部用）
│   ├── connection.ts     # 接続・切断
│   ├── movement.ts       # 移動
│   ├── environment.ts    # 環境認識
│   ├── building.ts       # 建築
│   ├── crafting.ts       # クラフト
│   ├── combat.ts         # 戦闘
│   ├── coordination.ts   # エージェント間連携（掲示板）
│   └── learning.ts       # 学習・記憶・設定管理
│
├── agent/                # Claudeエージェント
│   ├── claude-agent.ts   # Game Agent（ゲームプレイ）
│   ├── dev-agent.ts      # Dev Agent（ソースコード修正 + 設定チューニング）
│   ├── claude-client.ts  # Claude SDK クライアント
│   └── mcp-ws-transport.ts
│
└── types/
    ├── tool-log.ts       # ツール実行ログ型
    └── agent-config.ts   # エージェント設定型

.claude/skills/           # スキル定義
├── resource-gathering/   # 自動リソース収集（新規）
├── building/             # 建築（新規）
├── crafting-chain/       # 複数段階クラフト（新規）
├── survival/             # サバイバル最適化（新規）
├── exploration/          # エリア探索（新規）
├── iron-mining/          # 鉄採掘
├── diamond-mining/       # ダイヤ採掘
├── bed-crafting/         # ベッド作成
└── nether-gate/          # ネザーポータル
```

## 開発コマンド

```bash
npm install      # 依存関係インストール
npm run build    # ビルド
npm run dev      # 開発モード（ウォッチ）
npm run typecheck # 型チェック
```

## 起動コマンド

### 完全自律改善ループ（推奨）

```bash
# MCP WSサーバー起動（別ターミナル）
npm run start:mcp-ws

# 完全自律改善ループ（無限実行、Ctrl+Cで停止）
./scripts/self-improve-minecraft.sh
```

Claude Codeによる完全自律システム。プレイ→エラー検出→修正→コミット→プッシュを無限ループで実行。

### Dev Agent方式（代替）

```bash
# MCP WSサーバー（必須）
npm run start:mcp-ws

# Dev Agent + Game Agent
npm run start:self-improve

# 個別起動
npm run start:game-agent    # Game Agent単体
npm run start:dev-agent     # Dev Agent単体
```

### その他

```bash
npm start                   # MCPサーバー (stdio)
npm run board               # 掲示板サーバー
```

## 自己改善システム

### 完全自律改善ループ（推奨）

**scripts/self-improve-minecraft.sh** - Claude Codeによる完全自律システム

```
┌─────────────────────────────────────────┐
│  Loop #N (commit: xxxxxx)               │
│  ┌───────────────────────────────────┐  │
│  │ 1. Minecraftプレイ（5分間）       │  │
│  │    - サバイバル                   │  │
│  │    - リソース収集                 │  │
│  │    - エラー発生？                 │  │
│  └───────────────────────────────────┘  │
│               ↓                         │
│  ┌───────────────────────────────────┐  │
│  │ 2. エラー分析                     │  │
│  │    - ソースコード読込             │  │
│  │    - 原因特定                     │  │
│  └───────────────────────────────────┘  │
│               ↓                         │
│  ┌───────────────────────────────────┐  │
│  │ 3. コード修正                     │  │
│  │    - Editツールで修正             │  │
│  │    - npm run build                │  │
│  └───────────────────────────────────┘  │
│               ↓                         │
│  ┌───────────────────────────────────┐  │
│  │ 4. Git管理                        │  │
│  │    - git commit                   │  │
│  │    - git push                     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
               ↓
     Loop #N+1（前回ログを含む）
               ↓
            無限ループ...
```

**特徴:**
- ✅ 完全自律（人間の介入不要）
- ✅ 無限ループ（Ctrl+Cで停止）
- ✅ 10分タイムアウト（macOS互換）
- ✅ 自動Git管理（コミット+プッシュ）
- ✅ ログ自動保存（`agent_logs/loop_*.log`）
- ✅ 前回ログを次ループに引き継ぎ
- ✅ sonnetモデル（安定したゲームプレイ）

**実行方法:**
```bash
./scripts/self-improve-minecraft.sh  # 無限ループで実行
```

**ログ確認:**
```bash
tail -f $(ls -t agent_logs/loop_*.log | head -1)  # 最新ログ監視
```

**実績:**
- 24時間で75+ループ完了
- 20+件の自動バグフィックスコミット
- インベントリ管理、アイテム収集、クラフトタイミング等の改善を自動実現

### Dev Agent方式（代替）

MCP経由のエージェント連携システム。Dev Agentは2つのモードで動作：
1. **ソースコード修正** - ツール失敗を検知してTypeScriptコードを修正
2. **設定チューニング** - ループ結果を分析してagent-config.jsonを更新

#### アーキテクチャ

```
┌────────────────────────────────────────────────────┐
│           MCP WS Server                            │
│  (ツール実行ログ + ループ結果 収集・配信)            │
└──────────┬─────────────────────┬───────────────────┘
           │                     │
    WebSocket              WebSocket
           │                     │
┌──────────▼──────────┐ ┌────────▼──────────────────┐
│   Game Agent        │ │     Dev Agent             │
│   (ゲームプレイ)     │ │  (ソースコード修正        │
│                     │ │   + 設定チューニング)      │
│ - スキル実行        │ │                           │
│ - ループ結果送信    │ │ - ツールログ受信          │
│ - 設定リロード      │ │ - 失敗パターン分析        │
│                     │ │ - Claude SDK Edit修正     │
│                     │ │ - ビルド・再起動          │
│                     │ │ - ループ結果分析          │
│                     │ │ - agent-config.json更新   │
└─────────────────────┘ └───────────────────────────┘
```

#### Dev Agent用MCPツール

**ツールログ系（ソースコード修正用）**
- `dev_subscribe` - ツール実行ログ + ループ結果の購読開始
- `dev_get_tool_logs` - ログ取得（フィルタ可能）
- `dev_get_failure_summary` - 失敗サマリー取得
- `dev_clear_logs` - ログクリア

**設定チューニング系**
- `dev_get_config` - agent-config.json取得
- `dev_save_config` - 設定保存 + evolution-history.jsonl追記
- `dev_get_evolution_history` - 進化履歴取得
- `dev_get_loop_results` - ループ結果取得
- `dev_publish_loop_result` - ループ結果公開（Game Agentが使用）

#### ログ・設定ファイル

| ファイル | 用途 | 形式 |
|---------|------|------|
| `logs/tool-execution.jsonl` | ツール実行ログ | JSONL（最大1000件メモリ保持） |
| `logs/loop-results.jsonl` | ループ実行結果 | JSONL（最大100件メモリ保持） |
| `learning/agent-config.json` | エージェント設定 | JSON（性格・優先度・閾値） |
| `learning/evolution-history.jsonl` | 設定変更履歴 | JSONL（全履歴永続保存） |

#### agent-config.json構造

```typescript
{
  version: number,              // 設定バージョン
  lastUpdated: string,          // 最終更新日時
  updatedBy: string,            // 更新者（DevAgent等）

  personality: {
    aggressiveness: 0-10,       // 攻撃性
    explorationDrive: 0-10,     // 探索意欲
    resourceHoarding: 0-10,     // 資源収集意欲
    riskTolerance: 0-10         // リスク許容度
  },

  priorities: {                  // 行動優先度（重み）
    survival: 100,
    food: 80,
    equipment: 70,
    shelter: 60,
    exploration: 50,
    mining: 50,
    building: 30
  },

  decisionRules: [               // 判断ルール
    {
      condition: string,
      action: string,
      priority: "high" | "medium" | "low",
      source: string
    }
  ],

  thresholds: {
    fleeHP: number,              // 逃走開始HP
    eatHunger: number,           // 食事開始空腹度
    nightShelterTime: number     // 夜間避難開始時刻
  }
}
```

#### ソースコード修正フロー

1. ツール失敗が3件以上蓄積
2. Dev Agentが失敗パターン分析（ツール名・エラー内容）
3. MCP Filesystem経由でソースコード読込
4. Claude SDK `query()` + Editツールで修正
5. TypeScript構文チェック
6. `npm run build`
7. Game Agent再起動

#### 設定チューニングフロー

1. Game Agentがループ完了（5回 or 3分経過）
2. `dev_publish_loop_result` でループ結果をMCP経由送信
3. Dev Agentがバッファに蓄積
4. Claude SDK `query()` (maxTurns:1, tools無し) で分析
5. JSON形式で変更内容を出力
6. `dev_save_config` で保存 + evolution-history.jsonl追記
7. Game Agent次ループで設定リロード

## Game Agent用MCPツール

Game Agentが使用できるツール（20個）：

### 接続・状態確認
- `minecraft_connect` - サーバーに接続（agentType: "game"を指定）
- `minecraft_disconnect` - 切断
- `minecraft_get_position` - 現在座標
- `minecraft_get_status` - HP/空腹確認
- `minecraft_get_inventory` - インベントリ確認
- `minecraft_get_surroundings` - 周囲の状況
- `minecraft_get_chat_messages` - チャット履歴
- `minecraft_get_nearby_entities` - 近くのエンティティ
- `minecraft_get_biome` - バイオーム確認

### コミュニケーション
- `minecraft_chat` - チャット送信
- `subscribe_events` - ゲームイベント購読

### スキルシステム
- `list_agent_skills` - 利用可能なスキル一覧
- `get_agent_skill` - スキル詳細取得（SKILL.md取得）

### 学習・記憶
- `save_memory` - 重要情報を記憶
- `recall_memory` - 記憶を参照
- `log_experience` - 経験を記録
- `get_recent_experiences` - 経験取得

### エージェント連携
- `agent_board_read` - 掲示板を読む
- `agent_board_write` - 掲示板に書く
- `agent_board_wait` - 新着メッセージ待機
- `agent_board_clear` - クリア

<<<<<<< Updated upstream
<<<<<<< Updated upstream
**設計原則**: Game Agentは採掘・建築・クラフトなどの複雑な操作を直接実行できません。すべてスキル経由でアクセスします。

## スキルシステム

### 高レベルスキル（新規）

| スキル | 説明 | 内部実装 |
|-------|------|---------|
| `resource-gathering` | 自動リソース収集 | minecraft_gather_resources |
| `building` | 建築 | minecraft_build_structure |
| `crafting-chain` | 複数段階クラフト | minecraft_craft_chain |
| `survival` | サバイバル最適化 | minecraft_survival_routine |
| `exploration` | エリア探索 | minecraft_explore_area |

### 既存スキル

| スキル | 説明 |
|-------|------|
| `iron-mining` | 鉄鉱石採掘→精錬→ツール作成 |
| `diamond-mining` | ダイヤモンド探索・採掘 |
| `bed-crafting` | 羊探索→羊毛収集→ベッド作成 |
| `nether-gate` | 黒曜石収集→ポータル建設 |

各スキルは `.claude/skills/<skill-name>/SKILL.md` に保存された専門知識とツールセットを持つ。

### スキル内部実装

```
┌──────────────────┐
│  Game Agent      │
│  get_agent_skill │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  SKILL.md        │  ← スキル知識（Game Agentが読む）
│  - 使用方法      │
│  - パラメータ    │
│  - Tips          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ high-level tool  │  ← 高レベルツール（スキル内部で使用）
│ (Game Agentは   │
│  知らない)       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Bot Manager      │  ← 11モジュール
│ (低レベル操作)   │
└──────────────────┘
```
=======
=======
>>>>>>> Stashed changes
### 自己学習（Reflexion）
- `log_experience` - 行動と結果を記録（成功・失敗問わず）
- `get_recent_experiences` - 過去の経験を振り返る
- `reflect_and_learn` - 経験からパターン分析、改善点抽出
- `save_skill` - 成功手順をスキルとして保存
- `get_skills` - 保存スキルを参照
- `get_reflection_insights` - 振り返り知見を取得

学習データは `learning/` ディレクトリに保存:
- `experience.jsonl` - 経験ログ
- `reflection.md` - 振り返りレポート
- `skills.json` - スキルライブラリ
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes

## 環境変数

```bash
# Minecraft接続
MC_HOST=localhost
MC_PORT=25565
BOT_USERNAME=Claude

# MCP WebSocket
MCP_WS_URL=ws://localhost:8765

# Dev Agent設定
MANAGE_GAME_AGENT=true        # Game Agent管理を有効化
START_MCP_SERVER=false        # MCP WSサーバー自動起動（通常false）

# Claude API
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=opus             # dev-agentのモデル（opus推奨）
```

## イベントプッシュシステム

WebSocket MCPサーバーはゲームイベントをクライアントにプッシュ配信。

### 発行されるイベント

| イベント | 発生条件 | 優先度 |
|---------|---------|--------|
| `damaged` | ダメージを受けた | 高 |
| `hostile_spawn` | 敵モブが20ブロック内にスポーン | 高 |
| `death` | 死亡 | 高 |
| `health_changed` | HP/空腹度変化 | 中 |
| `time_night` | 夜になった（13000 tick） | 中 |
| `time_dusk` | 夕暮れ（12000 tick） | 中 |
| `time_dawn` | 夜明け（23000 tick） | 低 |
| `entity_gone` | 敵モブが消滅 | 低 |
| `block_broken` | 6ブロック内でブロック破壊 | 低 |
| `item_collected` | アイテム拾得 | 低 |
| `chat` | チャットメッセージ | 低 |
| `heartbeat` | 5秒間イベントなし | 最低 |

## デザイン原則

### 1. スキルベース設計
- 複雑な操作はスキルに集約
- Game Agentは実装詳細を知らない
- 拡張性・保守性の向上

### 2. エージェント分離
- Game Agent: ゲームプレイに特化（20ツール）
- Dev Agent: デバッグ・開発用（45+ツール）
- 役割に応じた最適なツールセット

### 3. モジュール化
- bot-manager: 11ファイルに分割
- tools: 機能別に整理
- 各モジュールは単一責任

### 4. 自己改善
- ソースコード修正で技術的問題を解決
- 設定チューニングで行動最適化
- 完全自動化されたフィードバックループ

## 注意事項

- Minecraftサーバーでボットに`/op botname`が必要
- サバイバルモードで動作（自動切替）
- シングルプレイの「LANに公開」でもテスト可能
- Dev Agentはopusモデル推奨（ソースコード修正の精度）
- Game Agentはhaikuモデルで十分（ゲームプレイ）
