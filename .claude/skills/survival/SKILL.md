---
name: survival
description: |
  サバイバル最適化スキル。食料確保、シェルター建築、ツール作成を自動実行。
  Use when: 生存に必要な基本行動を効率化したい時
---

# サバイバルルーチンスキル

生存に必要な基本行動を自動で実行する高レベルスキル。

## 使用方法

```
minecraft_survival_routine {
  username: "BotName",
  priority: "auto"  // or "food", "shelter", "tools"
}
```

## 優先度モード

### auto（自動判定）
現在の状態から最適な行動を自動選択:
- 空腹度 < 10 → **food**
- ピッケルなし → **tools**
- その他 → **shelter**

### food（食料確保）
1. 近くの動物を探索（牛、豚、鶏、羊）
2. 動物を狩猟（武器があれば装備）
3. ドロップアイテムを回収
4. かまどがあれば肉を調理
5. 動物がいなければ植物性食料を収集

### shelter（シェルター建築）
1. ベッドの有無を確認
2. ベッドがなければ材料収集（羊毛 + 板材）
3. 小型シェルターを自動建築
4. ベッドを配置（未実装の場合は準備のみ）

### tools（ツール作成）
1. ピッケルがなければクラフト
2. 斧がなければクラフト
3. シャベルがなければクラフト
4. 基本ツールセットを揃える

## 自動実行される処理

### Food ルーチン
```
1. minecraft_get_nearby_entities で動物を検索
2. 武器があれば minecraft_equip_weapon
3. minecraft_attack で狩猟
4. minecraft_collect_items でドロップ回収
5. minecraft_smelt で肉を調理（かまど利用可能時）
```

### Shelter ルーチン
```
1. minecraft_get_inventory でベッド確認
2. ない場合は材料収集
3. minecraft_build_structure { type: "shelter", size: "small" }
```

### Tools ルーチン
```
1. minecraft_get_inventory でツール確認
2. minecraft_craft_chain { target: "wooden_pickaxe", autoGather: true }
3. 木の斧、シャベルも同様にクラフト
```

## 状態に応じた自動判断

| 条件 | 選択される優先度 | 理由 |
|------|----------------|------|
| 空腹度 < 10 | food | 飢餓ダメージ回避 |
| HP < 10 | shelter | 安全確保 |
| ピッケルなし | tools | 資源採掘の前提 |
| 夜間 | shelter | モブ対策 |

## Tips

- **初日の推奨順**: tools → food → shelter
- **定期実行**: 1時間ごとにautoモードで実行すると安定
- **カスタマイズ**: 特定の優先度を指定して個別実行も可能
- **連続実行**: 複数の優先度を順番に実行してもOK

## 組み合わせ例

```
# 初日の基本ルーチン
1. minecraft_survival_routine { priority: "tools" }
2. minecraft_survival_routine { priority: "food" }
3. minecraft_survival_routine { priority: "shelter" }

# または自動判定に任せる
minecraft_survival_routine { priority: "auto" }
```

## エラー対応

- `No food sources found`: 探索範囲を広げる、または釣りを検討
- `No suitable building materials`: resource-gatheringで木材や石を収集
- `Crafting failed`: 素材不足 → 収集してから再実行
