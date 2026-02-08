# CLAUDE.md - Mineflayer MCP Server

## プロジェクト概要

Claude AIエージェントがMinecraftを自律的にプレイするためのMCPサーバー。
Mineflayerライブラリでボットを制御し、MCPプロトコルでClaudeと連携。
自己改善システム（Dev Agent）により、ツール失敗時のソースコード修正と行動設定チューニングを自動実行。

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
└─────────────────┘                     └────────┬─────────┘
         ▲                                       │
         │ 起動/停止                             │ ログ・ループ結果
         │                               ┌───────▼──────────┐
┌────────┴──────────┐                    │   Bot Manager    │
│    Dev Agent      │                    │   (Mineflayer)   │
│  (dev-agent.ts)   │                    └────────┬─────────┘
│                   │                             │
│ - ソースコード修正│                    ┌────────▼─────────┐
│ - 設定チューニング│                    │   Minecraft      │
└───────────────────┘                    │   Server         │
                                         └──────────────────┘
```

## ディレクトリ構造

```
src/
├── index.ts              # MCPサーバー (stdio)
├── mcp-ws-server.ts      # MCPサーバー (WebSocket)
├── bot-manager.ts        # Mineflayerボット管理
│
├── tools/                # MCPツール実装
│   ├── connection.ts     # 接続・切断
│   ├── movement.ts       # 移動
│   ├── environment.ts    # 環境認識
│   ├── building.ts       # 建築・ブロック操作
│   ├── crafting.ts       # クラフト
│   ├── combat.ts         # 戦闘
│   ├── coordination.ts   # エージェント間連携（掲示板）
│   └── learning.ts       # 学習・記憶・設定管理
│
├── agent/                # Claudeエージェント
│   ├── claude-agent.ts   # Game Agent（ゲームプレイ）
│   ├── dev-agent.ts      # Dev Agent（ソースコード修正 + 設定チューニング）
│   ├── report-agent.ts   # Report Agent（進化レポート生成）
│   ├── claude-client.ts  # Claude SDK クライアント
│   └── mcp-ws-transport.ts
│
└── types/
    ├── tool-log.ts       # ツール実行ログ型
    └── agent-config.ts   # エージェント設定型
```

## 開発コマンド

```bash
npm install      # 依存関係インストール
npm run build    # ビルド
npm run dev      # 開発モード（ウォッチ）
npm run typecheck # 型チェック
```

## 起動コマンド

```bash
# MCP WSサーバー（必須）
npm run start:mcp-ws

# 自己改善システム（推奨）
npm run start:self-improve  # Dev Agent + Game Agent

# 個別起動
npm run start:game-agent    # Game Agent単体
npm run start:dev-agent     # Dev Agent単体
npm run start:report-agent  # Report Agent単体

# その他
npm start                   # MCPサーバー (stdio)
npm run board               # 掲示板サーバー
```

## 自己改善システム（Dev Agent）

### 概要

Dev Agentは2つのモードで動作：
1. **ソースコード修正** - ツール失敗を検知してTypeScriptコードを修正
2. **設定チューニング** - ループ結果を分析してagent-config.jsonを更新

### アーキテクチャ

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
│ - ツール実行        │ │                           │
│ - ループ結果送信    │ │ - ツールログ受信          │
│ - 設定リロード      │ │ - 失敗パターン分析        │
│                     │ │ - Claude SDK Edit修正     │
│                     │ │ - ビルド・再起動          │
│                     │ │ - ループ結果分析          │
│                     │ │ - agent-config.json更新   │
└─────────────────────┘ └───────────────────────────┘
```

### Dev Agent用MCPツール

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

### ログ・設定ファイル

| ファイル | 用途 | 形式 |
|---------|------|------|
| `logs/tool-execution.jsonl` | ツール実行ログ | JSONL（最大1000件メモリ保持） |
| `logs/loop-results.jsonl` | ループ実行結果 | JSONL（最大100件メモリ保持） |
| `learning/agent-config.json` | エージェント設定 | JSON（性格・優先度・閾値） |
| `learning/evolution-history.jsonl` | 設定変更履歴 | JSONL（全履歴永続保存） |
| `learning/evolution-reports/` | 進化レポート | Markdown（30分ごと生成） |

### agent-config.json構造

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

### ソースコード修正フロー

1. ツール失敗が3件以上蓄積
2. Dev Agentが失敗パターン分析（ツール名・エラー内容）
3. MCP Filesystem経由でソースコード読込
4. Claude SDK `query()` + Editツールで修正
5. TypeScript構文チェック
6. `npm run build`
7. Game Agent再起動

### 設定チューニングフロー

1. Game Agentがループ完了（5回 or 3分経過）
2. `dev_publish_loop_result` でループ結果をMCP経由送信
3. Dev Agentがバッファに蓄積
4. Claude SDK `query()` (maxTurns:1, tools無し) で分析
5. JSON形式で変更内容を出力
6. `dev_save_config` で保存 + evolution-history.jsonl追記
7. Game Agent次ループで設定リロード

## MCPツール一覧

### 接続・基本
- `minecraft_connect` - サーバーに接続
- `minecraft_disconnect` - 切断
- `minecraft_get_position` - 現在座標
- `minecraft_move_to` - 移動（solid blockは自動で隣のair blockへリダイレクト）
- `minecraft_chat` - チャット送信

### 環境認識
- `minecraft_get_surroundings` - 周囲の状況（移動可能方向、近くの資源）
- `minecraft_get_biome` - バイオーム確認
- `minecraft_find_block` - ブロック検索
- `minecraft_get_nearby_entities` - 近くのエンティティ
- `minecraft_check_infrastructure` - クラフト台・かまど検索

### サバイバル
- `minecraft_dig_block` - ブロック破壊
- `minecraft_get_inventory` - インベントリ確認
- `minecraft_craft` - クラフト（自動でクラフト台検索）
- `minecraft_smelt` - 精錬（自動でかまど検索）
- `minecraft_equip` - アイテム装備
- `minecraft_collect_items` - アイテム回収

### 戦闘・生存
- `minecraft_get_status` - HP/空腹確認
- `minecraft_eat` - 食事
- `minecraft_fight` - 敵と戦う（自動装備・攻撃・逃走）
- `minecraft_attack` - 単発攻撃
- `minecraft_flee` - 逃走
- `minecraft_equip_armor` - 防具装備
- `minecraft_equip_weapon` - 武器装備

### 建築・移動補助
- `minecraft_place_block` - ブロック設置
- `minecraft_pillar_up` - ジャンプ設置で上昇
- `minecraft_tunnel` - トンネル掘削
- `minecraft_level_ground` - 地面整地

### エージェント連携
- `agent_board_read` - 掲示板を読む
- `agent_board_write` - 掲示板に書く
- `agent_board_wait` - 新着を待つ
- `agent_board_clear` - クリア

### 学習・記憶
- `save_memory` - 重要情報を記憶 (`learning/memory.json`)
- `recall_memory` - 記憶を参照
- `log_experience` - 経験を記録 (`learning/experience.jsonl`)
- `get_skills` - スキルライブラリ参照

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

### イベント購読

```javascript
// WebSocket接続後
await callTool("subscribe_events", { username: "BotName" });

// イベント受信
ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.method === "notifications/gameEvent") {
    const { username, event } = msg.params;
    console.log(`[${username}] ${event.type}: ${event.message}`);
  }
});
```

## スキルベースサブエージェント

Task toolを使って専門スキルを実行。各スキルは独立したサブエージェントとして動作。

### 利用可能スキル

| スキル | 説明 | 使用例 |
|--------|------|--------|
| `iron-mining` | 鉄鉱石採掘→精錬→ツール作成 | `Task skill="iron-mining"` |
| `diamond-mining` | ダイヤモンド探索・採掘 | `Task skill="diamond-mining"` |
| `bed-crafting` | 羊探索→羊毛収集→ベッド作成 | `Task skill="bed-crafting"` |
| `nether-gate` | 黒曜石収集→ポータル建設 | `Task skill="nether-gate"` |

各スキルは `~/.claude/skills/` に保存された専門知識とツールセットを持つ。

## 注意事項

- Minecraftサーバーでボットに`/op botname`が必要
- サバイバルモードで動作（自動切替）
- シングルプレイの「LANに公開」でもテスト可能
- Dev Agentはopusモデル推奨（ソースコード修正の精度）
- Game Agentはhaikuモデルで十分（ゲームプレイ）
