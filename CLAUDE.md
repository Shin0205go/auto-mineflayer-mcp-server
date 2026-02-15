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

## スキルの優先順位

**`team-coordination` スキルが最優先。** 全ての行動判断でこのスキルに従うこと。
survival等の他スキルはteam-coordinationに矛盾しない範囲でのみ使用する。

スキルの参照順:
1. **team-coordination** — チーム連携・フェーズ進行・チャット（常に最優先）
2. その他スキル（survival, resource-gathering等）— フェーズ目標に沿う場合のみ

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

### チャットプロトコル（minecraft_chat）

3〜5アクションごとにチャットを確認すること。

#### タグ一覧
- `[フェーズ] Phase N 開始` — フェーズ宣言（リーダーのみ）
- `[指示] @Claude3 鉄を掘ってきて` — タスク指示（リーダーのみ）
- `[了解] @Claude1 鉄掘りに行きます` — 指示への応答
- `[報告] 鉄ピッケル完成` — 進捗報告
- `[食料] 牛5頭 (x=50, z=-30)` — 食料源の発見
- `[資源] 鉄鉱石 y=40 (x=10, z=-20)` — 有用な資源
- `[チェスト] (x=5, y=64, z=4) 焼肉10, パン5` — チェストの中身
- `[危険] クリーパー多数 (x=-30, z=50)` — 危険エリア
- `[拠点] (x=0, y=65, z=0) 作業台あり` — 拠点情報
- `[SOS] 食料ゼロ、瀕死 (x=20, z=-10)` — 助けを求める

#### 受信時の行動
- `[指示]` → 自分宛てなら最優先で実行、`[了解]`で応答
- `[フェーズ]` → フェーズ目標に沿って行動を切り替える
- `[SOS]` → 近くにいれば助けに行く
- 人間のチャット → 最優先で従う

### リーダー（Claude1）の責務

**接続したら最初にやること：チャットでフェーズ宣言 + 全員にタスク指示。自分の作業は後。**

1. フェーズ管理: `[フェーズ]` タグで宣言・進行
2. 役割分担: `[指示] @Claude番号 具体的なタスク` で各メンバーにタスクを割り当てる
3. 状況把握: 5アクションごとにチャットを確認
4. 判断: フェーズ完了の判定、次フェーズへの移行

指示は具体的に（×「手伝って」 ○「鉄鉱石を10個掘って拠点チェストに入れて」）。

### フォロワー（Claude2〜7）の行動原則

**優先順位：**
1. 人間のチャット（最優先）
2. リーダーの `[指示]`（`[了解]`で応答して実行）
3. `[SOS]` への対応
4. 現在フェーズの目標に向けた自律行動
5. 情報共有・報告

指示がなくても、現在のフェーズの目標に沿って自分で判断して行動する。

### ゲームプレイの基本

- 現在のフェーズの目標を最優先で行動する
- 食料が2個以下なら緊急で食料確保（フェーズに関係なく）
- HP半分以下なら安全確保を優先
- 夜間は拠点に戻るか安全な場所で待機
- 拠点の座標を常に覚えておく
- 拠点チェストに余った物資を入れて `[チェスト]` で報告

### コード改善

プレイ中にツールの不具合を見つけたら自分でコードを修正する。

1. `bug-issues/bot{N}.md` に記録
2. `src/` のコードを調査・修正
3. `npm run build` でビルド確認
4. git commit

編集可能: `src/`, `.claude/skills/`, `bug-issues/bot{自分の番号}.md` のみ。

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
