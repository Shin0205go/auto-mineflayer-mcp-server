# CLAUDE.md - Mineflayer MCP Server

Claude AIがMinecraftを自律プレイするMCPサーバー。Mineflayer + MCPプロトコル。

## コマンド

```bash
npm install && npm run build   # セットアップ
npm run dev                    # 開発モード（ウォッチ）
npm start                      # MCPサーバー起動
```

## ツール選択ルール

**スキル・高レベルツールを必ず優先。低レベルツールは最終手段。**

| やりたいこと | 使うもの |
|---|---|
| 食料・HP回復 | `/survival` → `minecraft_survival_routine` |
| 素材収集 | `/resource-gathering` → `minecraft_gather_resources` |
| 道具作成 | `/crafting-chain` → `minecraft_craft_chain` |
| 建築 | `/building` → `minecraft_build_structure` |
| 探索 | `/exploration` → `minecraft_explore_area` |
| チーム連携 | `/team-coordination`（最優先） |

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

リーダーが `[フェーズ] Phase N 開始` を宣言。フォロワーは従う。
完了条件達成で `[報告] Phase N 完了条件達成` とチャット。

### チャットルール

- **毎アクションごとに `minecraft_get_chat_messages()` を呼べ**
- リーダー: フェーズ宣言+タスク指示が最優先
- フォロワー: リーダー指示に従う。なければフェーズ目標で自律行動
- 人間のチャットは最優先

### 禁止事項

- **リスポーンでHP回復するな。** 食料を食べろ。食料がなければ `/survival` で確保。
- **adminの/giveに頼るな。** 全アイテム自力入手。
- 同じ行動を3回失敗したらアプローチを変えろ。

### 死亡 = バグ

死亡は全てバグ。`bug-issues/bot{N}.md` に死因・座標・直前の行動を記録しろ。

### コード修正（全ボット可・worktree必須）

プレイ中にバグや改善点を発見したら、その場でコードを修正してよい。
プレイ中に遭遇した本人が最もコンテキストを持っているため、即時修正が最も効率的。

**修正手順：**
1. バグ発見 → `bug-issues/bot{N}.md` に記録
2. `src/tools/`, `src/bot-manager/`, `.claude/skills/` を修正
3. `npm run build` で動作確認
4. `git add` & `git commit`（修正内容を明記）
5. チャットで `[報告] コード修正: 内容` と共有

**worktree管理：** ランチャースクリプトが各ボットをworktreeで隔離実行する。
ボットはworktree内で普通にコード編集・コミットするだけでよい。
マージはスクリプトがセッション終了時に自動で行う。
