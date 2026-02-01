---
name: minecraft-survival
description: |
  Minecraft survival mode knowledge for AI agents controlling bots via MCP.
  Use when: (1) Playing Minecraft survival mode, (2) Mining/collecting resources,
  (3) Crafting tools and items, (4) Building structures, (5) Fighting mobs,
  (6) Coordinating with other agents in Minecraft.
---

# Minecraft Survival Basics

## Block Placement Rules

- **Reach: 4.5 blocks** - Cannot place beyond this distance
- **Adjacent block required** - Cannot place in mid-air
- **To build higher**: Build stairs or pillar-jump (jump + place block below)
- **Sneak (shift)**: Prevents falling off edges, allows placing on edges

## Item Collection

- Breaking blocks drops items
- Auto-pickup within ~1 block distance
- Items despawn after 5 minutes

## Survival Cycle

```
1. Punch trees → get wood
2. Craft planks → crafting table
3. Craft wooden pickaxe
4. Mine stone → cobblestone
5. Craft stone pickaxe
6. Find iron ore → smelt → iron tools
```

## Exact Item Names (Minecraft 1.21.4)

**IMPORTANT**: Use these exact names for minecraft_craft tool.

### Wood Types
- `oak_log`, `birch_log`, `spruce_log`, `jungle_log`, `acacia_log`, `dark_oak_log`
- `oak_planks`, `birch_planks`, `spruce_planks`, etc.
- `stick` (2 planks → 4 sticks, no table needed)

### Basic Crafting (No Table)
- `crafting_table` (4 planks)
- `stick` (2 planks vertically)

### Tools (Require Crafting Table)
| Tool | Item Name | Recipe |
|------|-----------|--------|
| Wooden Pickaxe | `wooden_pickaxe` | 3 planks + 2 sticks |
| Stone Pickaxe | `stone_pickaxe` | 3 cobblestone + 2 sticks |
| Iron Pickaxe | `iron_pickaxe` | 3 iron_ingot + 2 sticks |
| Diamond Pickaxe | `diamond_pickaxe` | 3 diamond + 2 sticks |
| Wooden Axe | `wooden_axe` | 3 planks + 2 sticks |
| Stone Axe | `stone_axe` | 3 cobblestone + 2 sticks |
| Wooden Sword | `wooden_sword` | 2 planks + 1 stick |
| Stone Sword | `stone_sword` | 2 cobblestone + 1 stick |
| Wooden Shovel | `wooden_shovel` | 1 plank + 2 sticks |

### Building Blocks
- `cobblestone` (mine stone)
- `stone_bricks` (4 stone in crafting table)
- `torch` (1 coal + 1 stick)
- `furnace` (8 cobblestone)
- `chest` (8 planks)

### Common Ores & Drops
- `coal` (from `coal_ore`)
- `raw_iron` (from `iron_ore`) → smelt to `iron_ingot`
- `raw_copper` (from `copper_ore`)
- `diamond` (from `diamond_ore`, needs iron pickaxe)

### Food
- `bread` (3 wheat)
- `cooked_beef`, `cooked_porkchop`, `cooked_chicken`

## Tools

| Tool | Use | Materials (weak→strong) |
|------|-----|------------------------|
| Pickaxe | Stone, ores | Wood → Stone → Iron → Diamond |
| Axe | Wood | Same |
| Shovel | Dirt, sand | Same |
| Sword | Combat | Same |

**Important**: Wrong tool = slow mining or no drops (e.g., need iron pickaxe for diamond ore)

## Combat

### Enemy Types
- **Zombies**: Melee, slow - easy to fight
- **Skeletons**: Ranged (bow) - close gap quickly or use cover
- **Creepers**: EXPLODE when close - bot auto-backs up
- **Spiders**: Fast, climb walls
- **Enderman**: Don't look at them unless ready to fight

### Combat Tools
- `minecraft_fight` - **Best option!** Fights until enemy dies or HP low
  - Auto-equips best weapon
  - Approaches and attacks repeatedly
  - Flees if HP drops below threshold (default: 6 = 3 hearts)
  - Backs away from creepers automatically
- `minecraft_flee` - Run away from danger

## New Essential Tools

### Crafting & Smelting
- `minecraft_craft` - Craft items (needs crafting table nearby for most items)
- `minecraft_smelt` - Smelt items in furnace (ore→ingot, meat→cooked)
  - Needs furnace within 4 blocks
  - Needs fuel (coal, charcoal, wood) in inventory

### Living
- `minecraft_sleep` - Sleep in bed to skip night
  - Only works at night
  - Needs bed within 4 blocks
- `minecraft_eat` - Eat food to restore hunger/health

### Item Management
- `minecraft_equip_item` - Equip item in hand (pickaxe, sword, etc.)
- `minecraft_drop_item` - Drop items from inventory (share with other bots)
- `minecraft_use_item` - Use held item (bucket, flint_and_steel, ender_eye)

### Combat Flow
```
1. minecraft_get_status (check HP first)
2. minecraft_fight { entity_name: "zombie" }
   → Auto: equip weapon, approach, attack loop, flee if HP low
3. minecraft_eat (heal after combat)
```

### Health & Hunger
- HP: 20 (10 hearts)
- Hunger depleted = no HP regen
- Keep food (meat, bread)
- Flee threshold: 6 HP (3 hearts) recommended

## Building Tips

1. Secure footing first
2. Spiral staircase for towers
3. Torches prevent mob spawns

## Multi-Agent Coordination

- Share inventory status on board
- Divide roles (miner, builder)
- Drop items at coordinates for sharing

## Crafting Tips

1. **Check inventory first**: Use `minecraft_get_inventory` before crafting
2. **Crafting table needed**: Most tools require being near a crafting_table (within 4 blocks)
3. **Simple items first**: Craft `stick` and `crafting_table` before tools
4. **Item names matter**: Use exact names like `wooden_pickaxe` not `wood_pickaxe`
5. **Equip tools**: Use `minecraft_equip_item` to hold tools before mining

## Movement Tips

1. **Stuck?** Use `minecraft_pillar_up` to jump and place blocks below
2. **Can't reach?** Move closer first, or pillar up to higher ground
3. **Check position**: Use `minecraft_get_position` to know where you are

## Finding Animals (Sheep, Cows, etc.)

Animals spawn in specific biomes. To find sheep:

1. **Check current biome**: `minecraft_get_biome`
2. **Search nearby**: `minecraft_find_entities` with `entity_type: "sheep"`
3. **Explore if not found**: `minecraft_explore_for_biome` to walk toward sheep-friendly biomes

### Biome → Animals

| Biome | Common Animals |
|-------|----------------|
| Plains, Meadow | Sheep, Cows, Pigs, Horses |
| Forest | Pigs, Wolves |
| Taiga | Foxes, Rabbits |
| Desert | Rabbits |
| Jungle | Parrots, Ocelots |

### Sheep-Friendly Biomes
- `plains`, `sunflower_plains`, `meadow`
- `forest`, `birch_forest`, `flower_forest`
- `snowy_plains`, `snowy_taiga`

**Tip**: If in a non-sheep biome (like desert), use `minecraft_explore_for_biome` with `target_biome: "plains"` to walk until you find one.

## Common Mistakes

- Using wrong item name (e.g., `wood_pickaxe` instead of `wooden_pickaxe`)
- Crafting without crafting_table nearby
- Placing blocks not in inventory → mine first
- Placing out of reach → move closer
- Placing in mid-air → need adjacent block
- Working in dark → mobs spawn, place torches
- Searching for animals in wrong biome → check biome first

---

# サバイバル攻略ロードマップ（序盤→エンダードラゴン）

## フェーズ1: 序盤（最初の1日目）

**優先度順：**
1. **木を伐採** - 全ての始まり。素手でOK
2. **作業台を作成** - 原木→板材(4)→作業台
3. **木のツール作成** - 木のピッケル、木の剣
4. **羊を狩る** - 羊毛3個でベッド作成可能
5. **ベッド作成** - 夜をスキップ（超重要！）
6. **簡易拠点** - 穴掘りでもOK、松明で明るく

**夜が来る前に：**
- ベッドがあれば寝て朝にスキップ
- なければ穴に籠もって朝を待つ

## フェーズ2: 石器時代

1. **石炭を見つける** - 洞窟の入口や崖に露出
2. **松明を量産** - 石炭+棒
3. **石のツール** - 石のピッケル、石の剣、石の斧
4. **かまどを作成** - 丸石8個
5. **食料を安定確保** - 動物を狩って肉を焼く

## フェーズ3: 鉄器時代

1. **鉄鉱石を採掘** - 高さY=16付近が多い
2. **鉄インゴットを精錬** - かまどで焼く
3. **鉄装備を作成**:
   - `iron_pickaxe` (必須！ダイヤ採掘に必要)
   - `iron_sword`
   - `iron_armor` (頭、胴、脚、足)
   - `shield` (盾)
   - `bucket` (水バケツ、溶岩対策)
4. **農業を始める** - 小麦、にんじん等

## フェーズ4: ダイヤモンド

1. **ダイヤ採掘** - 高さY=-59付近（深層岩）
2. **ダイヤ装備**:
   - `diamond_pickaxe` (必須)
   - `diamond_sword`
   - `diamond_armor` (フル装備推奨)
3. **エンチャントテーブル** - ダイヤ2+黒曜石4+本1
4. **装備をエンチャント** - 防護、鋭さ、落下軽減など

## フェーズ5: ネザー

**準備:**
- 黒曜石10個（ダイヤピッケルで採掘）
- ネザーポータル作成（4x5の枠）
- 火打ち石で着火

**ネザーでやること:**
1. **ブレイズを倒す** - ブレイズロッド入手（ネザー要塞）
2. **エンダーパール集め** - エンダーマンを倒す
3. **エンダーアイ作成** - ブレイズパウダー+エンダーパール

**必要数:**
- エンダーアイ: 最低12個（16個推奨）

## フェーズ6: エンダードラゴン討伐

### 準備アイテム
| アイテム | 数量 | 用途 |
|---------|------|------|
| ダイヤ装備一式 | フル | 防御 |
| ダイヤ剣（鋭さ付き） | 1 | 攻撃 |
| 弓（パワー付き） | 1 | クリスタル破壊 |
| 矢 | 64+ | 弓用 |
| 食料 | 64+ | 回復 |
| ブロック（丸石等） | 64+ | 足場 |
| エンダーパール | 16+ | 移動・落下回避 |
| 水バケツ | 1 | 落下軽減 |
| ベッド | 1 | リスポーン設定 |

### 討伐手順
1. **エンダーアイを投げる** - 要塞の方向を特定
2. **要塞を見つける** - エンドポータルがある
3. **エンドポータルを起動** - エンダーアイを12個はめる
4. **ジ・エンドに突入**

### ジ・エンドでの戦い
1. **エンドクリスタルを全て破壊** - 弓で撃つ
   - 鉄格子に囲まれたものは登って壊す
2. **エンダードラゴンを攻撃** - 止まった時に剣で
3. **吹き飛ばし注意** - エンダーパールで着地

**注意:** 一度入ったら倒すまで出られない！

---

## クラフトレシピ追加

### 序盤必須
| アイテム | レシピ |
|---------|--------|
| `bed` | 羊毛3 + 板材3 |
| `torch` | 石炭1 + 棒1 → 4本 |
| `furnace` | 丸石8 |

### 中盤
| アイテム | レシピ |
|---------|--------|
| `iron_ingot` | 鉄の原石をかまどで精錬 |
| `bucket` | 鉄インゴット3 |
| `shield` | 鉄インゴット1 + 板材6 |
| `flint_and_steel` | 鉄インゴット1 + 火打ち石1 |

### 終盤
| アイテム | レシピ |
|---------|--------|
| `ender_eye` | ブレイズパウダー1 + エンダーパール1 |
| `enchanting_table` | ダイヤ2 + 黒曜石4 + 本1 |
| `brewing_stand` | ブレイズロッド1 + 丸石3 |

---

Sources:
- [マイクラ攻略 初心者が序盤にやること](https://tech-teacher.jp/kids-blog/minecraft-capture-beginner/)
- [エンダードラゴンの攻略 - Minecraft Wiki](https://ja.minecraft.wiki/w/%E3%83%81%E3%83%A5%E3%83%BC%E3%83%88%E3%83%AA%E3%82%A2%E3%83%AB:%E3%82%A8%E3%83%B3%E3%83%80%E3%83%BC%E3%83%89%E3%83%A9%E3%82%B4%E3%83%B3%E3%81%AE%E6%94%BB%E7%95%A5)
- [エンドラ討伐のやり方](https://to-benefit7.com/enderdragon_subjugation/)
