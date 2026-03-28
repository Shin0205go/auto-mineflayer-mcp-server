/**
 * Minecraft Ender Dragon 8-phase plan
 *
 * Forbidden patterns are case-insensitive substrings checked against
 * the code string passed to /api/execute.
 */

import type { Plan } from "./validator.js";

export const minecraftPlan: Plan = {
  name: "minecraft-ender-dragon",
  description:
    "8-phase plan to defeat the Ender Dragon. Each phase restricts out-of-scope strategic actions.",
  steps: [
    {
      id: 1,
      name: "Base establishment",
      goal: "crafting_table, furnace, 3 chests, shelter",
      forbidden: [
        "end_portal", "stronghold", "eye of ender",
        "blaze", "nether_portal", "nether_brick", "nether_wart",
        "brewing_stand", "ender_pearl", "ender_eye",
        "enchanting_table",
        "diamond_pickaxe", "diamond_sword", "diamond_chestplate",
      ],
    },
    {
      id: 2,
      name: "Food stabilization",
      goal: "farm or ranch, 20+ food items in chest",
      forbidden: [
        "end_portal", "stronghold", "eye of ender",
        "blaze", "nether_portal", "nether_brick", "nether_wart",
        "brewing_stand", "ender_pearl", "ender_eye",
        "enchanting_table",
      ],
    },
    {
      id: 3,
      name: "Stone tools",
      goal: "stone_pickaxe, stone_axe, stone_sword for all bots",
      forbidden: [
        "end_portal", "stronghold", "eye of ender",
        "blaze", "nether_portal", "nether_brick", "nether_wart",
        "brewing_stand", "ender_pearl", "ender_eye",
        "enchanting_table",
      ],
    },
    {
      id: 4,
      name: "Iron equipment",
      goal: "iron_pickaxe + iron_sword for all bots",
      forbidden: [
        "end_portal", "stronghold", "eye of ender",
        "blaze", "nether_portal", "nether_brick", "nether_wart",
        "brewing_stand", "ender_pearl", "ender_eye",
        "enchanting_table",
      ],
    },
    {
      id: 5,
      name: "Diamond + Enchanting",
      goal: "enchanting_table placed, diamond tools",
      forbidden: [
        "end_portal", "stronghold", "eye of ender",
        "blaze", "nether_portal",
        "brewing_stand", "ender_pearl", "ender_eye",
      ],
    },
    {
      id: 6,
      name: "Nether expedition",
      goal: "7 blaze_rod + 12 ender_pearl",
      forbidden: ["end_portal", "stronghold", "eye of ender"],
    },
    {
      id: 7,
      name: "End fortress",
      goal: "activate End portal",
      forbidden: [],
    },
    {
      id: 8,
      name: "Ender Dragon",
      goal: "defeat the Ender Dragon",
      forbidden: [],
    },
  ],
};
