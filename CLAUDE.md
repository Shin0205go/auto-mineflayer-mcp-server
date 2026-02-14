# CLAUDE.md - Mineflayer MCP Server

## プロジェクト概要

Claude AIエージェントがMinecraftを自律的にプレイするためのMCPサーバー。
Mineflayerライブラリでボットを制御し、MCPプロトコルでClaudeと連携。
マルチボット対応、サバイバルモード、エージェント間協調機能を搭載。

## アーキテクチャ

```
┌─────────────────┐                     ┌──────────────────┐
│  Claude Code    │ ──── MCP Stdio ──── │  MCP Server      │
│  (CLI)          │                     │  (index.ts)      │
└─────────────────┘                     └────────┬─────────┘
                                                 │
┌─────────────────┐                     ┌────────▼─────────┐
│  Claude Agent   │ ──── WebSocket ──── │  WebSocket MCP   │
│  (claude-agent) │                     │  (mcp-ws-server) │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                                        ┌────────▼─────────┐
                                        │  Bot Manager     │
                                        │  (Mineflayer)    │
                                        └────────┬─────────┘
                                                 │
                                        ┌────────▼─────────┐
                                        │  Minecraft       │
                                        │  Server          │
                                        └──────────────────┘
```

## ディレクトリ構造

```
src/
├── index.ts              # MCPサーバー (stdio)
├── mcp-ws-server.ts      # MCPサーバー (WebSocket)
├── bot-manager.ts        # Mineflayerボット管理
├── realtime-board.ts     # 掲示板サーバー
│
├── tools/                # MCPツール実装
│   ├── connection.ts     # 接続・切断
│   ├── movement.ts       # 移動
│   ├── environment.ts    # 環境認識
│   ├── building.ts       # 建築・ブロック操作
│   ├── coordination.ts   # エージェント間連携（掲示板）
│   ├── combat.ts         # 戦闘
│   └── crafting.ts       # クラフト
│
└── agent/                # Claudeエージェント
    ├── claude-agent.ts   # 自律エージェント
    ├── claude-client.ts  # Claude SDK クライアント
    ├── mcp-bridge.ts     # stdio→WebSocket変換
    └── mcp-ws-transport.ts
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
# MCPサーバー（stdio）- Claude Desktop等から利用
npm start

# Claudeエージェント起動
npm run start:claude

# 2体目のClaude（別名）
BOT_USERNAME=Claude2 MC_PORT=58896 npm run start:claude

# WebSocket MCPサーバー（エージェント用）
npm run start:mcp-ws

# 掲示板サーバー
npm run board
```

## MCPツール一覧

### 接続・基本
- `minecraft_connect` - サーバーに接続
- `minecraft_disconnect` - 切断
- `minecraft_get_position` - 現在座標
- `minecraft_move_to` - 移動
- `minecraft_chat` - チャット送信

### 環境認識
- `minecraft_get_surroundings` - 周囲の状況（移動可能方向、近くの資源）
- `minecraft_get_biome` - バイオーム確認
- `minecraft_find_entities` - エンティティ検索（羊、ゾンビ等）
- `minecraft_explore_for_biome` - バイオーム探索

### サバイバル
- `minecraft_dig_block` - ブロック破壊
- `minecraft_get_inventory` - インベントリ確認
- `minecraft_craft` - クラフト
- `minecraft_equip_item` - アイテム装備
- `minecraft_pillar_up` - ジャンプ設置で上昇

### 戦闘
- `minecraft_fight` - 敵と戦う（自動装備・攻撃・逃走）
- `minecraft_attack` - 単発攻撃
- `minecraft_flee` - 逃走
- `minecraft_get_status` - HP/空腹確認
- `minecraft_eat` - 食事

### 建築
- `minecraft_place_block` - ブロック設置
- `minecraft_build_structure` - 構造物（house, tower, marker）
- `minecraft_build_road` - 道路
- `minecraft_build_village` - 村

### エージェント連携
- `agent_board_read` - 掲示板を読む
- `agent_board_write` - 掲示板に書く
- `agent_board_wait` - 新着を待つ
- `agent_board_clear` - クリア

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

## 環境変数

```bash
MC_HOST=localhost
MC_PORT=25565
BOT_USERNAME=Claude    # ボット名（変更可能）
MCP_WS_URL=ws://localhost:8765
```

## 注意事項

- Minecraftサーバーでボットに`/op botname`が必要
- サバイバルモードで動作（自動切替）
- シングルプレイの「LANに公開」でもテスト可能
