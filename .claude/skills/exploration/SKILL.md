---
name: exploration
description: 広範囲探索。mineflayer pathfinder + findBlock（mc_execute用）
---
## 基本パターン

ブロック探索: iron_ore、diamond_oreなど対象ブロックをnavigateで探索する。max_distanceパラメータで探索範囲を指定できる。
エンティティ探索: villager、cowなどエンティティをnavigateで探索する。
座標移動: moveToで特定座標に直接移動する。

## 探索後の周囲確認

statusでBiome・nearbyResources・nearbyEntitiesを確認してログ出力する。

## 重要な発見はチャット共有

`[資源] diamond_ore発見: x=123, y=-59, z=456` のようにチャットで座標を共有する。

## 見つからない時

別エリアに移動（現在位置から+100〜150ブロック）してから再探索する。
