# Bot5 - Bug & Issue Report

このファイルはBot5専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

---

## [2026-03-28] Bug: Session 100 - バックグラウンドタスクがpathfinderを継続的に制御する

- **Cause**: mc-execute.cjsをバックグラウンドで実行した際（run_in_background=true）、そのコマンドが完了しても内部でpathfinderのゴールを継続的に変更し続ける。bot.pathfinder.stop()を呼んでもisMoving=trueのまま。新しいpathfinder.goto()を呼ぶと"The goal was changed before it could be completed!"エラーになる。
- **Coordinates**: Y=60-110付近をランダムに移動中
- **Last Actions**: 3つのバックグラウンドタスク（be1134gen, be5bruex7, bj9uc78vq）を実行後、pathfinder制御が戻らなくなった
- **Error Message**: `The goal was changed before it could be completed!`, `Path was stopped before it could be completed!`
- **Status**: Reported 2026-03-28 Session 100 - CRITICAL
- **推奨**: バックグラウンドタスクの完了時にpathfinder.stop()を確実に呼ぶか、タスクIDの管理システムを追加する。

---

## [2026-03-28] Bug: Session 100 - ゾンビに夜間に殺される（防具なし屋外待機中）

- **Cause**: 夜間(time=22993)にY=66付近で屋外待機中にゾンビに殺された。防具なし・食料なし（wheat x2のみ）の状態で夜間にオープンエリアにいた。
- **Coordinates**: (4, 66, 2)付近
- **Last Actions**: 朝を待つためにwait()で待機中 → HP: 20 → 15 → 13 → "Claude5 was slain by Zombie"
- **Error Message**: `Claude5 was slain by Zombie`
- **Status**: Reported 2026-03-28 Session 100
- **推奨**: 夜間は自動的にシェルターに入るか、pillarUpして待機する処理が必要。

---

## [2026-03-28] Bug: Session 99 - デーモンが頻繁にクラッシュして mc-execute が使用不可

- **Cause**: npm run daemon でデーモンを起動しても、数回のmc-execute.cjs呼び出し後にクラッシュして終了する。"Daemon not running" エラーが繰り返し発生する。Claude1/Claude3/Claude4の再接続処理が衝突している可能性。
- **Coordinates**: (8, 103, 58)
- **Last Actions**: mc-connect.cjs 接続成功 → mc-execute.cjs 1-2回実行 → デーモンクラッシュ → 再起動が必要
- **Error Message**: `Daemon not running. Start with: npm run daemon` / `socket hang up`
- **Status**: Reported 2026-03-28 Session 99 - CRITICAL
- **推奨**: daemon.ts の終了条件を確認。複数ボット（Claude1/3/4/5）接続時のエラーハンドリング改善。

---

## [2026-03-28] Bug: Session 99 - status() が bot.health と矛盾した値を返す

- **Cause**: bot.health が 2.33（HP低下状態）なのに、status() は hp:20 を返した。status() の値が古い可能性がある。
- **Coordinates**: (8, 103, 58)
- **Last Actions**: bot.health で raw HP 確認 → status() 呼び出し → 異なる値
- **Error Message**: なし（サイレントな不一致）
- **Status**: Reported 2026-03-28 Session 99

---

## [2026-03-28] Bug: Session 98 - SKILL.md の bot.* API と実際の mc-execute sandbox が不一致

- **Cause**: SKILL.mdには `bot.status()`, `bot.gather()`, `bot.combat()`, `bot.moveTo()`, `bot.log()` 等のAPIが記載されているが、実際のmc-execute.ts sandboxには `bot` (raw mineflayer bot), `status()`, `log()`, `getMessages()`, `chat()`, `wait()`, `reconnect()` のみ定義されている。高レベルAPI (gather, combat, moveTo, navigate, flee, pillarUp, craft, smelt, eat, equipArmor, place, build, farm, store, drop) は一切sandboxに含まれていない。
- **Coordinates**: (8.4, 103, 58.7)
- **Last Actions**: mc-execute.cjs で bot.status() 呼び出し → TypeError: bot.status is not a function
- **Error Message**: `TypeError: bot.status is not a function`, `TypeError: bot.log is not a function`
- **Status**: Reported 2026-03-28 Session 98 - CRITICAL
- **推奨**: mc-execute.ts のsandboxに高レベルAPIラッパー (gather, combat, moveTo, craft等) を追加するか、SKILL.mdのドキュメントを実際のsandbox構成に合わせて修正する。

---

## [2026-03-28] Bug: Session 98 - mc-execute sandbox で bot.* API ラッパーが使用不可

- **Cause**: 接続直後、mc-execute.cjs でコードを実行すると `bot.status()`, `bot.log()`, `bot.gather()` 等の bot.* API ラッパーが全て "not a function" エラーになる。`Object.keys(bot)` でチェックするとraw mineflayer botオブジェクトのみ存在し、カスタムAPIラッパーが初期化されていない。
- **Coordinates**: (8.4, 103, 58.7)
- **Last Actions**: mc-connect.cjs で接続成功 → mc-execute.cjs で bot.status() 呼び出し → TypeError: bot.status is not a function
- **Error Message**: `TypeError: bot.status is not a function`, `TypeError: bot.log is not a function`, `TypeError: bot.getMessages is not a function`
- **Status**: Reported 2026-03-28 Session 98 - CRITICAL
- **推奨**: mc-execute.ts の bot API オブジェクト構築処理を確認。接続後のサンドボックス初期化フローを確認。

---

## [2026-03-28] Bug: Session 97 - gather()/combat()がアイテムドロップを拾わない (item pickup bug)

- **Cause**: gather('iron_ore', 3)は「成功」と返すが、raw_ironがインベントリに増えない。combat('cow'/'chicken'/'pig')を実行しても食料がインベントリに入らない。featherのみ追加される場合あり。
- **Coordinates**: Y=50-94付近（birch_forest）
- **Last Actions**:
  1. gather('iron_ore', 3) → 成功ログ → raw_iron: 0
  2. combat('cow') → 完了 → 食料なし
  3. combat('chicken') → feather x5のみ取得、raw_chickenなし
- **Error Message**: なし（成功と表示されるがアイテムが増えない）
- **Status**: Reported 2026-03-28 Session 97 - CRITICAL
- **推奨**: item pickup処理の修正。特にドロップアイテムのcollect処理を確認。

---

## [2026-03-28] Bug: Session 97 - farm()が120秒タイムアウト

- **Cause**: bot.farm()を呼び出すと120秒後にタイムアウトエラー。農場建設・収穫どちらも機能しない。
- **Coordinates**: Y=50-100付近
- **Last Actions**: bot.farm() → 120秒待機 → タイムアウト
- **Error Message**: `Execution timed out after 120000ms`
- **Status**: Reported 2026-03-28 Session 97

---

## [2026-03-28] Bug: Session 97 - HP=2.5から突然HP=20に (疑いのあるリスポーン)

- **Cause**: HP=2.5の状態でbot.flee()を呼び出した後、HP=20/Hunger=20になった。インベントリ内容も変化（iron_swordがなくなりcobblestone大量スタック追加）。keepInventoryはONだが、リスポーンが起きた可能性あり。
- **Coordinates**: Before: (2.3, 85, 48.7) / After: (12.8, 102.2, -4.1)
- **Last Actions**: flee(30) → HP=20に急増 → 位置変化 → インベントリ変化
- **Error Message**: なし
- **Status**: Reported 2026-03-28 Session 97
- **推奨**: flee()実装の確認。HP回復処理の見直し。

---

### [2026-02-15] use_item_on_block でバケツが水/溶岩を汲めない ✅ **FIXED**
- **症状**: `minecraft_use_item_on_block(item_name="bucket", x, y, z)` で水源や溶岩源を右クリックしても、`water_bucket` や `lava_bucket` にならず、空の `bucket` のままになる。ツール出力は "Collected water/lava with bucket → now holding bucket" と表示されるが、実際にはアイテムが変化していない。
- **原因**: `activateBlock()`ではなく`activateItem()`+`deactivateItem()`が必要。サーバー同期待ち時間不足。
- **修正**: Bot1がコミット8c753a6で修正完了。
- **修正内容**:
  - `bot.activateItem()`→100ms待機→`bot.deactivateItem()`の流れに変更
  - インベントリ更新を3秒間ポーリングで待機
  - 同期待ち時間を1000msに延長
- **ファイル**: `src/bot-manager/bot-blocks.ts` (useItemOnBlock関数)
- **ステータス**: ✅ FIXED (2026-02-15, コミット8c753a6)

---

### [2026-02-15] minecraft_open_chest と minecraft_take_from_chest でチェスト取り違え
- **症状**: `minecraft_open_chest(x=-80, y=80, z=-53)` で開いたはずが、`minecraft_take_from_chest()` を呼ぶと別のチェスト (x=-81, y=79, z=-53) の内容が表示される。open_chestで "obsidian(1)" が表示されても、take_from_chestでは "diamond(5), leather(3), sugar_cane(10), book(1)" となり、obsidianが取得できない。
- **原因**: MCPツールの内部状態管理で、複数のチェストが近くにある場合に、最後に開いたチェストではなく、別のチェストを参照している可能性がある。
- **影響**: チェストから特定のアイテムを取り出せず、Phase 5の進行に支障。
- **回避策**: チェストから取り出す代わりに、自分で黒曜石4個を作成する（溶岩+水バケツ）。
- **修正予定**: `src/tools/crafting.ts` または `src/bot-manager/bot-items.ts` のチェスト操作関連コードを調査。
- **ファイル**: `src/tools/crafting.ts`, `src/bot-manager/bot-items.ts`
- **関連修正 (2026-02-22, autofix-1)**: `takeFromChest` でチェストopen失敗時にロックが解放されないバグを修正。
  チェストアクセス競合時のデッドロックリスクを低減。ファイル: `src/bot-manager/bot-storage.ts`
- **修正済み (autofix-3, 2026-02-22)**: 座標未指定時の `findBlock` 検索範囲を 6→4 ブロックに縮小。インタラクション範囲内のチェストのみ対象とすることで、離れた別チェストを誤って選択するリスクを低減。座標を必ず指定するよう促すエラーメッセージも改善。ファイル: `src/bot-manager/bot-storage.ts`

**修正済み**

---

### [2026-02-16] iron_pickaxe と iron_sword がインベントリから消失
- **症状**: チェストから `iron_pickaxe` と `iron_sword` を取得（take_from_chest成功確認）し、装備もした（equip成功確認）。その後 pillar_up や move_to を実行したところ、いつの間にかインベントリから消失。stone_pickaxe と stone_sword のみ残っている。チェストにも戻っていない。
- **発生状況**:
  1. チェスト(-3,96,0)から iron_pickaxe と iron_sword を取得（成功）
  2. iron_pickaxe を装備（成功）
  3. pillar_up で11ブロック上昇
  4. チェスト(2,106,-1)から diamond を取得
  5. 拠点に戻る（move_to）
  6. インベントリ確認 → iron_pickaxe/iron_sword が消失、stone系に戻っている
- **原因**: 不明。インベントリ同期の問題か、アイテム管理のバグの可能性。
- **影響**: Phase 4未達成。鉄装備を再取得する必要がある。
- **修正予定**: インベントリ管理周りのコードを調査。
- **ファイル**: `src/bot-manager/bot-items.ts`, `src/tools/crafting.ts`

---

### [2026-02-16] stick クラフトで birch_planks を使わず dark_oak_planks を選択 ✅ **FIXED**
- **症状**: インベントリに `birch_planks x50` がある状態で `minecraft_craft(item_name="stick", count=2)` を実行すると、"missing ingredient" エラーになる。
- **エラーメッセージ**: `Failed to craft stick from birch_planks: Error: missing ingredient. Try crafting planks from logs first`
- **原因**:
  1. bot.recipesAll(item.id, null, null)が何かレシピを返している
  2. その後のクラフト実行で「missing ingredient」エラーが発生
  3. マニュアルレシピの条件`allRecipes.length === 0`に到達していない
  4. つまり、有効なレシピが存在しないのにrecipesAllが何かを返している（Mineflayer/mcDataのバグの可能性）
- **影響**: stickが作成できず、石ツール作成に支障。ただし既にダイヤ装備があるため優先度は低い。
- **修正内容**:
  - `src/bot-manager/bot-crafting.ts` (lines 355-469): `stick` と `crafting_table` は `recipesAll()` の結果を無視し、常にマニュアルレシピを使用するよう変更
  - 最も数量の多い planks タイプを自動選択（`sort()` で最大数のものを使用）
  - `simpleWoodenRecipes` リストで stick/crafting_table を特別扱いし、確実にクラフト可能に
- **ファイル**: `src/bot-manager/bot-crafting.ts` (lines 355-469)
- **ステータス**: ✅ FIXED (autofix-4, 2026-02-22)

**修正済み**

### [2026-02-17] stick クラフト bug - GIT MERGE CONFLICT FOUND ✅ **FIXED**
- **症状**: dark_oak_planks x4 を持っているのに stick craft が失敗
- **エラー**: "Failed to craft stick from dark_oak_planks: Error: missing ingredient"
- **根本原因**: **git merge conflict が未解決のままコミット済みだった**
  - bot-crafting.ts line 706-777 に `<<<<<<< HEAD` と `>>>>>>> origin/main` マーカーが存在
  - TypeScript解析時にこれが`any`型として扱われ、実行時バグを引き起こしていた
  - 実装上は存在する修正（BUGFIX 2026-02-17）がコンフリクトマーカーに埋もれていた
- **修正内容**:
  - bot-crafting.ts line 706-777 のコンフリクトマーカーを削除
  - HEADバージョン（BUGFIX BUGFIX 2026-02-17の修正）を採用
  - compatibleRecipe.find()で常に互換性検証を実施するように統一
- **ファイル**: `src/bot-manager/bot-crafting.ts` (lines 706-777)
- **修正日**: 2026-02-17
- **ステータス**: ✅ FIXED

---

## [2026-03-28] Bug: Session 101 - bot.placeBlock() がblockUpdateイベントタイムアウトで失敗

- **Cause**: bot.placeBlock()を呼び出すと "Event blockUpdate:(x, y, z) did not fire within timeout of 5000ms" エラーが発生する。複数の場所（dirt, iron_ore, stone）で試みたが全て同じエラー。ブロック設置コマンドはサーバーに届いているかもしれないが、blockUpdateイベントが返ってこない。
- **Coordinates**: (16, 107, 73) 付近
- **Last Actions**: crafting_tableをdirtブロック(16, 106, 73)の上に設置しようとした → blockUpdateタイムアウト
- **Error Message**: `Event blockUpdate:(16, 107, 73) did not fire within timeout of 5000ms`
- **Status**: Reported 2026-03-28 Session 101 - CRITICAL
- **推奨**: bot.placeBlock()の実装を確認。blockUpdateのタイムアウト時間を延ばすか、イベント待ちをスキップする実装に変更する。

---

## [2026-03-28] Bug: Session 101 - pathfinderが長距離移動中に"goal was changed"エラーを繰り返す

- **Cause**: 長距離移動（20ブロック以上）でpathfinder.goto()を呼ぶと "The goal was changed before it could be completed!" エラーが頻発する。自動flee処理かauto-escape処理が移動中にpathfinderを横取りしている可能性がある。短距離（10ブロック以下）では問題ない。
- **Coordinates**: (16, 107, 73) → (3, 93, 61) の移動時
- **Last Actions**: 複数回の長距離pathfinder.goto() → "goal was changed" エラー
- **Error Message**: `The goal was changed before it could be completed!`, `Path was stopped before it could be completed!`
- **Status**: Reported 2026-03-28 Session 101
- **推奨**: 長距離移動時の自動flee/escape処理の無効化オプションを追加。または段階的移動（ウェイポイント経由）で回避。

---

### [2026-02-17] Respawn HP/Hunger Recovery Bug - keepInventory ON but healing broken ✅ **FIXED**
- **症状**: `minecraft_respawn()` を実行しても HP/Hunger が 20/20 に回復しない。keepInventory=true でアイテムは保持されるが、HP/Hunger は元の値のまま。
- **発生例**: Claude5 respawn実行 → HP 1/20 Hunger 11/20 → respawn実行 → 同じく HP 1/20 Hunger 11/20 (変わらず)
- **期待動作**: keepInventory=true の場合、プレイヤーは spawn地点で全回復（HP 20/20, Hunger 20/20）+インベントリ保持
- **実際の動作**: respawn後もHP/Hungerは元の値のままで変わらない
- **根本原因**: `/kill` コマンドでボットを死亡させた後、`bot.respawn()` を呼び出していなかった。ボットは死亡画面のまま実際にリスポーンしていなかった。
- **修正内容**: `src/bot-manager/bot-survival.ts` の `respawn()` 関数を修正:
  1. `/kill` 送信前に death イベントリスナーを設定
  2. death イベント後に `bot.respawn()` を呼び出してリスポーンを実行
  3. spawn イベントを待ってリスポーン完了を確認
  4. 1秒待機後にHP/Food値を読み取る
- **ファイル**: `src/bot-manager/bot-survival.ts` (respawn function)
- **ステータス**: ✅ FIXED (2026-02-22, autofix-2)

**修正済み**

---

