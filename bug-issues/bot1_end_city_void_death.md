# [2026-04-02] Bug: End City exploration - Void death

## 概要
Claude1 が End City 探索中に Void fall で死亡。Endの中心座標(-1, 110, 2)はオーバーワールドの island 構造が不安定で、プレイヤーがvoid に落ちやすい。

## 詳細
- **Cause**: `/execute in minecraft:the_end run tp Claude1 -1 110 2` → End city 内部をTP指定したが、その座標が void または floating島の隙間だった
- **Coordinates**: (-1, 110, 2) at the_end
- **Last Actions**:
  1. Structure `/place structure minecraft:end_city` で End city を生成
  2. purpur block を (-1, 109, 2) で発見
  3. itemframe を探すため、TP で End city 中心へ移動
  4. Void damage で死亡
- **Error Message**: `[Claude1] やられた！リスポーン中...`
- **Status**: Reported & Mitigated

## Root Cause
- End dimension の島々は floating island structure。正確な TPはサーバー側で計算が必要。
- `/place structure` で生成された End city は不完全または浮いた状態かもしれない。
- TP 座標計算に island detection ロジックが不足。

## 影響
- Death により inventory loss（一部保持されたが一部喪失の可能性）
- Phase 8完了後のサイドクエスト（Elytra）が延期

## 推奨修正
1. End city 探索時は `/locate structure` で座標取得後、Y値をサーバーが提案する値で TP する
2. TP 前に `bot.findBlock()` で solid block を確認してから移動
3. End dimension では常に HP/void damage に警戒

## 修正確認予定
次トライ: `/locate structure minecraft:end_city` で座標取得 → Y値を信頼 → pathfinder で徐々に接近
