---
paths:
  - "src/"
---

# Skills Guide - 21 スキル リファレンス

各スキルは `.claude/skills/<name>/SKILL.md` で定義。必要に応じて Read() で呼び出し。

## 常時スキル（全フェーズ）

| スキル | 説明 | 用途 |
|--------|------|------|
| **survival** | 食料・HP・夜間対策 | 毎アクション確認 |
| **team-coordination** | マルチボット協調 | 指示受信・報告 |
| **terrain-management** | 採掘後の穴埋め・整地 | 地形修復 |

## フェーズ別スキル

| Phase | スキル | 説明 |
|-------|--------|------|
| 1-2 | **resource-gathering** | 自動探索・採掘 |
| 1-2 | **building** | 構造物建設 |
| 1 | **bed-crafting** | ベッド作成・夜スキップ |
| 2 | **auto-farm** | 食料農場運用 |
| 3-4 | **crafting-chain** | 自動クラフト連鎖 |
| 4 | **iron-mining** | 鉄鉱採掘・精錬 |
| 5 | **diamond-mining** | ダイヤ採掘 |
| 5 | **enchanting** | エンチャント設置 |
| 6 | **nether-gate** | ネザーポータル建設 |
| 6 | **nether-fortress** | ネザー要塞探索 |
| 6 | **blaze-spawner** | ブレイズロッド入手 |
| 6-7 | **potion-brewing** | ポーション醸造 |
| 8 | **ender-dragon** | ドラゴン討伐 |
| 任意 | **exploration** | 広範囲探索・発見 |
| 任意 | **villager-trading** | 村人取引 |
| 任意 | **iron-golem-trap** | アイアンゴーレム罠 |
| 任意 | **mob-farm** | Mob ファーム構築 |

## スキル構成

各 SKILL.md は 3 層:

### 層 1: メタ情報（Frontmatter）
```yaml
---
phase: 1
priority: high
duration: 1-2 days
dependencies:
  - survival
  - team-coordination
---
```

### 層 2: コアガイダンス（本文）
- 目標
- ステップ
- チェックリスト
- よくある間違い

### 層 3: 詳細・参考（オプション）
- コード例
- 外部リンク
- 関連スキル

## 読み方

### 初回セッション（層 1 スキャン）
```bash
# frontmatter から必要なスキルだけ抽出
# 例: Phase 1 → survival, resource-gathering
```

### 実装開始（層 2 詳読）
```bash
# スキル本体を読み、ステップ・チェックリスト実行
Read(.claude/skills/resource-gathering/SKILL.md)
```

### トラブルシューティング（層 3 参照）
```bash
# コード例や詳細が必要な場合
# スキル内の参照リンク、または外部docs
```

## クイックリファレンス

### Phase 1: 拠点確立

```
1. survival (常時)
2. resource-gathering → Wood 20+, Stone tools
3. building → Crafting table, Furnace, Chest, Shelter
4. team-coordination → 進捗報告
```

**実行:**
```
Read(.claude/skills/survival/SKILL.md)
Read(.claude/skills/resource-gathering/SKILL.md)
Read(.claude/skills/building/SKILL.md)
```

### Phase 2: 食料安定化

```
1. survival (常時)
2. auto-farm → 畑または牧場
3. crafting-chain → 食料 20+ 確保
```

### Phase 3-4: 石・鉄装備

```
1. resource-gathering → Stone/Iron ore
2. crafting-chain → Stone → Iron tools
3. iron-mining → Deep mining technique
```

### Phase 5-6: ダイヤ・ネザー

```
1. diamond-mining → Y=60 以下探索
2. enchanting → テーブル設置
3. nether-gate → Portal 建設
4. nether-fortress → 要塞探索
5. blaze-spawner → Blaze combat
```

### Phase 7-8: エンド

```
1. ender-dragon → ドラゴン討伐
```

## 依存関係マップ

```
survival (常時必須)
  ├── resource-gathering → building
  │   └── crafting-chain → iron-mining
  │       └── diamond-mining → enchanting
  │           └── nether-gate → nether-fortress
  │               └── blaze-spawner
  │                   └── ender-dragon
  └── auto-farm (Phase 2)
  └── team-coordination (常時)
```

## スキル追加・修正

新しいスキルが追加されたら:

1. `.claude/skills/<name>/SKILL.md` が作成される
2. このガイドに追加
3. Phase/priority を frontmatter に記載
4. 関連スキルをリンク

---

詳細: 各スキルの SKILL.md を参照
最後の更新: 2026-03-29
