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
- `minecraft_attack` - Single attack only
- `minecraft_flee` - Run away from danger

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
