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
│
├── tools/                # MCPツール実装
│   ├── connection.ts     # 接続・切断
│   ├── movement.ts       # 移動
│   ├── environment.ts    # 環境認識
│   ├── building.ts       # 建築・ブロック操作
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

## IMPORTANT: ツール選択の優先度

**YOU MUST スキルと高レベルツールを優先して使うこと。** 低レベルツールの直接呼び出しは最終手段。

### 優先度（上が最優先）

1. **スキル（/skill-name）** — 該当するスキルがあれば必ず使う
2. **高レベルMCPツール** — minecraft_survival_routine, minecraft_craft_chain, minecraft_gather_resources, minecraft_explore_area, minecraft_build_structure
3. **低レベルMCPツール** — move_to, dig_block, place_block, craft 等（スキルや高レベルツールでカバーできない場合のみ）

### やりたいこと → 使うべきスキル/ツール

| やりたいこと | ALWAYS使うスキル/ツール | 使ってはいけない方法 |
|---|---|---|
| 食料確保・HP回復 | `/survival` → minecraft_survival_routine | move_to→attack→collect_itemsを手動で繰り返す |
| 木・石・鉱石の収集 | `/resource-gathering` → minecraft_gather_resources | find_block→move_to→dig_blockを手動で繰り返す |
| ピッケル・道具の作成 | `/crafting-chain` → minecraft_craft_chain | craftを何度も呼ぶ |
| シェルター・拠点建築 | `/building` → minecraft_build_structure | place_blockを何十回も呼ぶ |
| 広範囲の探索 | `/exploration` → minecraft_explore_area | move_toで手動探索 |
| チーム連携 | `/team-coordination`（最優先） | 個人判断で勝手に動く |

### スキルの優先順位

1. **team-coordination** — 最優先。全ての行動判断でこのスキルに従う
2. **survival** — 生存の基本行動（食料・シェルター・ツール）
3. **crafting-chain / resource-gathering / building / exploration** — フェーズ目標に応じて使用
4. **その他スキル** — 状況に応じて（iron-mining, diamond-mining, auto-farm等）

## マルチボット協調プレイ

Claude1〜Claude7の7体がチームで同じMinecraftワールドをプレイする。
Claude1がリーダー、Claude2〜7がフォロワー。最終目標はエンダードラゴン討伐。

### フェーズ制 共通目標

チーム全体で以下のフェーズを順番に達成する。自分だけ先に進まず、チーム全体の進行を意識すること。

| Phase | 目標 | 完了条件 |
|-------|------|----------|
| 1 拠点確立 | spawn付近に共有拠点 | 作業台、かまど、チェスト3個以上、簡易シェルター |
| 2 食料安定化 | 全員が食料確保できる | 拠点に畑or牧場、チェストに食料20個以上 |
| 3 石ツール | 全員石ツール装備 | 全員が石ピッケル・斧・剣を所持 |
| 4 鉄装備 | 全員鉄装備 | 全員が鉄ピッケル+鉄の剣を所持 |
| 5 ダイヤモンド | エンチャント台設置 | ダイヤ5個+黒曜石4個+本1冊→エンチャント台 |
| 6 ネザー | ブレイズロッド+エンダーパール | ブレイズロッド7本以上、エンダーパール12個以上 |
| 7 エンド要塞 | ポータル起動 | エンダーアイ12個でポータルを起動 |
| 8 ドラゴン討伐 | エンダードラゴン撃破 | 全員で討伐 |

#### フェーズ判定ルール
- リーダー（Claude1）がチャットで `[フェーズ] Phase N 開始` を宣言
- フォロワーはリーダーの宣言に従う
- 完了条件を満たしたら `[報告] Phase N 完了条件達成` とチャットで報告
- リーダーが確認して `[フェーズ] Phase N 完了、Phase N+1 開始` を宣言

### チャット・役割・ゲームプレイ

**`team-coordination` スキルに詳細が記載されている。** そちらを参照すること。

要点:
- **毎アクションごとにチャット確認**（`minecraft_get_chat_messages()` を頻繁に呼ぶ）
- リーダー（Claude1）: 接続後すぐにフェーズ宣言+全員にタスク指示。自分の作業は後
- フォロワー（Claude2〜7）: リーダーの指示に従う。なければフェーズ目標に沿って自律行動
- 人間のチャットは最優先

### コード改善

プレイ中にツールの不具合を見つけたら自分でコードを修正する。

1. `bug-issues/bot{N}.md` に記録
2. `src/tools/` のコードを調査・修正（src/tools/以外は編集禁止）
3. `npm run build` でビルド確認
4. git commit

編集可能: `src/tools/`, `bug-issues/bot{自分の番号}.md` のみ。それ以外のファイルは読み取り専用。

### gitコンフリクト解決

1. `git status` でコンフリクトファイルを確認
2. `<<<<<<<` `=======` `>>>>>>>` を読んで両方の変更を活かすように修正
3. `git add <file>` → `git commit` で解決

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
