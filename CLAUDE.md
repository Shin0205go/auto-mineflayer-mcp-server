# CLAUDE.md - Mineflayer MCP Server

## プロジェクト概要

AIエージェントの思考と行動をMinecraft上で可視化するMCPサーバー。
Mineflayerライブラリでボットを制御し、MCPプロトコルでClaudeやGeminiなどのAIエージェントと連携。
マルチエージェント協調、BTC価格チャート表示、画面認識機能も搭載。

## アーキテクチャ

```
┌─────────────────┐                     ┌──────────────────┐
│  Claude Code    │ ──── MCP Stdio ──── │  MCP Server      │
│  (CLI)          │                     │  (index.ts)      │
└─────────────────┘                     └────────┬─────────┘
                                                 │
┌─────────────────┐                     ┌────────▼─────────┐
│  Gemini Agent   │ ──── WebSocket ──── │  WebSocket MCP   │
│  (agent/)       │                     │  (mcp-ws-server) │
└─────────────────┘                     └────────┬─────────┘
                                                 │
┌─────────────────┐                     ┌────────▼─────────┐
│  Gemini Watcher │ ──── WebSocket ──── │  Realtime Board  │
│  (画面監視)      │                     │  (realtime-board)│
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
│
├── tools/                # MCPツール実装
│   ├── connection.ts     # 接続・切断
│   ├── movement.ts       # 移動
│   ├── environment.ts    # 環境認識
│   ├── visualization.ts  # 思考可視化
│   ├── building.ts       # 建築・ブロック操作
│   ├── coordination.ts   # エージェント間連携（掲示板）
│   └── trading.ts        # BTC価格表示
│
├── agent/                # Gemini Liveエージェント
│   ├── index.ts          # エージェントエントリポイント
│   ├── gemini-live-client.ts
│   ├── action-controller.ts
│   ├── mcp-ws-transport.ts
│   └── vision-provider.ts
│
├── bitflyer.ts           # BitFlyer API クライアント
├── realtime-board.ts     # 掲示板 WebSocketサーバー
├── gemini-watcher.ts     # Gemini画面監視
├── gemini-voice.ts       # Gemini音声操作（CLI）
│
└── types/
    └── screenshot-desktop.d.ts
```

## 開発コマンド

```bash
# 依存関係インストール
npm install

# ビルド
npm run build

# 開発モード（ウォッチ）
npm run dev

# 型チェック
npm run typecheck
```

## 起動コマンド

```bash
# MCPサーバー（stdio）
npm start

# Gemini Liveエージェント
npm run start:agent

# WebSocket MCPサーバー
npm run start:mcp-ws

# リアルタイム掲示板サーバー
npm run board

# Gemini画面監視
npm run gemini
```

## MCPツール一覧

### 接続・基本
- `minecraft_connect` - サーバーに接続
- `minecraft_disconnect` - サーバーから切断
- `minecraft_get_position` - 現在座標を取得
- `minecraft_move_to` - 指定座標に移動
- `minecraft_chat` - チャットメッセージ送信
- `minecraft_get_chat_messages` - チャット取得

### 環境認識
- `minecraft_look_around` - 周囲のブロックをスキャン

### 可視化
- `minecraft_visualize_thinking` - 思考状態をパーティクルで表示
  - `idle`: 灰色ダスト（待機中）
  - `processing`: 炎（処理中）
  - `searching`: エンチャント（情報収集中）
  - `executing`: 緑の光（実行中）
  - `error`: 赤い光（エラー）

### 建築
- `minecraft_place_block` - 単一ブロック設置
- `minecraft_dig_block` - ブロック破壊
- `minecraft_dig_area` - エリア破壊
- `minecraft_build_structure` - プリセット構造物（house, tower, marker）
- `minecraft_build_road` - 道路建築
- `minecraft_build_village` - 村建築

### ワーカーボット
- `minecraft_spawn_worker` - ワーカーボット生成
- `minecraft_despawn_worker` - ワーカー削除
- `minecraft_list_workers` - ワーカー一覧
- `minecraft_assign_task` - タスク割り当て

### エージェント間連携
- `agent_board_read` - 掲示板を読む
- `agent_board_write` - 掲示板に書く
- `agent_board_wait` - 新着メッセージを待つ
- `agent_board_clear` - 掲示板クリア

### BitFlyer価格表示
- `minecraft_get_btc_price` - BTC/JPY価格取得
- `minecraft_show_price_sign` - 看板に価格表示
- `minecraft_draw_price_chart` - 価格チャート描画
- `minecraft_draw_candlestick_chart` - ローソク足チャート

## 環境変数

```bash
# .env.example 参照
GEMINI_API_KEY=your_key_here
MC_HOST=localhost
MC_PORT=25565
```

## MCPトランスポート

### Stdio (標準)
```
Claude Desktop → stdio → index.ts → Bot Manager → Minecraft
```
- `npm start` で起動
- Claude Desktop等のMCPクライアントから利用

### WebSocket
```
Gemini Agent → WebSocket → mcp-ws-server.ts → Bot Manager → Minecraft
```
- `npm run start:mcp-ws` で起動（デフォルト: ws://localhost:8765）
- JSON-RPC 2.0 over WebSocket
- クライアント実装: `src/agent/mcp-ws-transport.ts`

**メソッド:**
- `tools/list` - ツール一覧取得
- `tools/call` - ツール実行 (`{ name, arguments }`)
- `ping` - ヘルスチェック

## 注意事項

- Minecraftサーバーでボットにオペレーター権限が必要（`/op botname`）
- `/setblock`, `/particle` コマンドを使用
- シングルプレイの「LANに公開」でもテスト可能
