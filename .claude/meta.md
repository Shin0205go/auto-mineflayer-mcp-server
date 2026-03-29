# Meta管理者向け運用情報

## セットアップ

```bash
npm install && npm run build   # ビルド
npm run daemon                 # デーモン起動（port 3099）必須
npm run dev                    # 開発モード（ウォッチ）
```

**デーモンはセッション開始前に手動で起動しておくこと。**
CLIスクリプトは全てデーモンへのHTTP POSTなので、デーモンが落ちると全て失敗する。

## アーキテクチャ

```
Claude Code エージェント × N
    ↓ BOT_USERNAME=ClaudeN node scripts/mc-execute.cjs
デーモン (port 3099) — src/daemon.ts
    ↓
BotManager — src/bot-manager/
    ├── Claude1 (mineflayer bot)
    ├── Claude2 (mineflayer bot)
    └── ...
```

**主要ソースファイル:**
- `src/tools/core-tools.ts` — bot.status, bot.gather, bot.craft等の実装
- `src/tools/mc-execute.ts` — mc_execute sandbox (bot.* API)
- `src/tools/high-level-actions.ts` — bot.build, bot.farm等
- `src/bot-manager/` — botManager, pathfinder, combat, crafting等
- `src/daemon.ts` — デーモンエントリポイント
- `src/viewer-server.ts` — HTTP API + ダッシュボード (port 3099)
- `scripts/mc-execute.cjs` — コード実行CLIスクリプト
- `scripts/mc-connect.cjs` — 接続CLIスクリプト

## 運用ルール

- **1エージェント=1bot。** 複数エージェント同時起動禁止。前のが完了してから次を起動。
- **エージェント完了時はoutputを1-3行で要約して報告。** ユーザーはoutputを直接見れない。
- **デーモンが起動していることを前提とする。**
- **コードレビュー起動基準: 死亡だけでなく苦戦パターンも対象。**
  - gather/pillarUp/moveTo タイムアウト×3回以上
  - wait() auto-flee無限ループ
  - moveToが目標Y座標に届かない
  - craft/gather同じエラー連続
  - 地形スタック

## コードレビューのKPI目標

1. 死亡: 0回/セッション
2. 食料キープ: 常に5個以上
3. mc_execute成功率: 80%以上
4. 新アイテム種類: 3種以上/セッション
5. moveTo成功率: 90%以上

## 自動管理タスク（セッション開始時に設定）

### メタ管理タスク（8分ごと）

```
CronCreate: interval=8m, prompt="""
以下を順番に実行:
1. Claude1エージェント(minecraft-player)のoutputファイルで完了確認。完了していたら進捗を1-3行で要約→再起動
   起動プロンプト: 「Minecraftに接続して現在の状況を確認し、フェーズ目標を進めてください。バグは記録のみで、コード修正はしないでください。」
2. ユーザーに現状を簡潔に報告（稼働状態、進捗）
"""
```

### 苦戦検出・コードレビュー（OSのcrontab）

```
scripts/watch-claude.sh  # crontab: */5 * * * *
```

### Admin Bot 戦略指示（5分ごと）

```
CronCreate: interval=5m, prompt="""
1. エージェントのoutputで現在の状況を把握
2. 現在の状況に基づいた戦略指示を日本語で作成（食料確保・生存・フェーズ進行。コードレベルの指示は禁止）
3. 以下で送信:
   /opt/homebrew/opt/node@20/bin/node /Users/shingo/Develop/auto-mineflayer-mcp-server/scripts/admin-chat.cjs "[指示] <内容>"
"""
```

**戦略方針（Phase 1-2）:**
- 食料確保最優先（小麦農場 or 動物狩り）
- HPが低いときは即逃げるか食べるかどちらか
- 拠点周辺に松明設置でmobスポーン抑制
- 地下には入るな
- 農場作業は昼間・HPが十分・周囲の敵が少ないときだけ
