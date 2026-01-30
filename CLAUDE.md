# CLAUDE.md - Mineflayer MCP Server

## プロジェクト概要

AIエージェントの思考と行動をMinecraft上で可視化するMCPサーバー。
MineflayerライブラリでMinecraftボットを制御し、MCPプロトコルでClaudeなどのAIエージェントと連携する。

## アーキテクチャ

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐
│  Claude/AI      │ ◄──────────────────► │  MCP Server      │
│  エージェント    │                       │  (このプロジェクト) │
└─────────────────┘                       └────────┬─────────┘
                                                   │
                                          Mineflayer API
                                                   │
                                          ┌────────▼─────────┐
                                          │  Minecraft       │
                                          │  Server          │
                                          └──────────────────┘
```

## ディレクトリ構造

```
mineflayer-mcp-server/
├── src/
│   ├── index.ts          # MCPサーバーエントリポイント
│   ├── bot-manager.ts    # Mineflayerボット管理
│   └── tools/            # MCPツール実装
│       ├── connection.ts # 接続・切断ツール
│       ├── movement.ts   # 移動ツール
│       ├── environment.ts# 環境認識ツール
│       ├── visualization.ts # 思考可視化ツール
│       └── building.ts   # 建築ツール
├── dist/                 # ビルド出力
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## 開発コマンド

```bash
# 依存関係インストール
npm install

# ビルド（TypeScript → JavaScript）
npm run build

# 開発モード（ウォッチ）
npm run dev

# 型チェック
npm run typecheck
```

## MCPツール一覧

### 接続・基本
- `minecraft_connect` - サーバーに接続（host, port, username）
- `minecraft_disconnect` - サーバーから切断
- `minecraft_get_position` - 現在座標を取得
- `minecraft_move_to` - 指定座標に移動
- `minecraft_chat` - チャットメッセージ送信

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
- `minecraft_build_structure` - プリセット構造物建築（house, tower, marker）

## 技術スタック

- **TypeScript** - 型安全な開発
- **@modelcontextprotocol/sdk** - MCPサーバー実装
- **mineflayer** - Minecraftボット制御
- **prismarine-viewer** - (将来) ブラウザ表示

## 注意事項

- Minecraftサーバーでボットにオペレーター権限が必要（`/op botname`）
- `/setblock`, `/particle` コマンドを使用するため
- シングルプレイの「LANに公開」でもテスト可能
