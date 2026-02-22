import { describe, it, expect, vi } from "vitest";
import {
  isOreBlock,
  isLogBlock,
  isFuelItem,
  isBedBlock,
  isHostileMob,
  isPassiveMob,
  isFoodItem,
  isScaffoldBlock,
} from "../src/bot-manager/minecraft-utils.js";

// ==============================
// Pure functions (no bot dependency)
// ==============================

describe("isOreBlock", () => {
  it("returns true for standard ore blocks", () => {
    expect(isOreBlock("iron_ore")).toBe(true);
    expect(isOreBlock("diamond_ore")).toBe(true);
    expect(isOreBlock("coal_ore")).toBe(true);
    expect(isOreBlock("gold_ore")).toBe(true);
    expect(isOreBlock("redstone_ore")).toBe(true);
    expect(isOreBlock("lapis_ore")).toBe(true);
    expect(isOreBlock("emerald_ore")).toBe(true);
    expect(isOreBlock("copper_ore")).toBe(true);
  });

  it("returns true for deepslate ore variants", () => {
    expect(isOreBlock("deepslate_iron_ore")).toBe(true);
    expect(isOreBlock("deepslate_diamond_ore")).toBe(true);
    expect(isOreBlock("deepslate_gold_ore")).toBe(true);
  });

  it("returns false for non-ore blocks", () => {
    expect(isOreBlock("stone")).toBe(false);
    expect(isOreBlock("dirt")).toBe(false);
    expect(isOreBlock("cobblestone")).toBe(false);
    expect(isOreBlock("iron_ingot")).toBe(false);
    expect(isOreBlock("diamond")).toBe(false);
  });
});

describe("isLogBlock", () => {
  it("returns true for log blocks", () => {
    expect(isLogBlock("oak_log")).toBe(true);
    expect(isLogBlock("spruce_log")).toBe(true);
    expect(isLogBlock("birch_log")).toBe(true);
    expect(isLogBlock("jungle_log")).toBe(true);
    expect(isLogBlock("acacia_log")).toBe(true);
    expect(isLogBlock("dark_oak_log")).toBe(true);
    expect(isLogBlock("cherry_log")).toBe(true);
    expect(isLogBlock("mangrove_log")).toBe(true);
  });

  it("returns false for non-log blocks", () => {
    expect(isLogBlock("oak_planks")).toBe(false);
    expect(isLogBlock("stone")).toBe(false);
    expect(isLogBlock("oak_wood")).toBe(false);
  });
});

describe("isFuelItem", () => {
  it("returns true for coal and charcoal", () => {
    expect(isFuelItem("coal")).toBe(true);
    expect(isFuelItem("charcoal")).toBe(true);
  });

  it("returns true for wood-based items", () => {
    expect(isFuelItem("oak_log")).toBe(true);
    expect(isFuelItem("oak_planks")).toBe(true);
    expect(isFuelItem("stick")).toBe(true);
    expect(isFuelItem("wooden_pickaxe")).toBe(true);
    expect(isFuelItem("wooden_sword")).toBe(true);
  });

  it("returns true for other fuel items", () => {
    expect(isFuelItem("bamboo")).toBe(true);
    expect(isFuelItem("scaffolding")).toBe(true);
    expect(isFuelItem("bookshelf")).toBe(true);
    expect(isFuelItem("dried_kelp_block")).toBe(true);
    expect(isFuelItem("lava_bucket")).toBe(true);
  });

  it("returns false for non-fuel items", () => {
    expect(isFuelItem("iron_ingot")).toBe(false);
    expect(isFuelItem("diamond")).toBe(false);
    expect(isFuelItem("stone")).toBe(false);
    expect(isFuelItem("dirt")).toBe(false);
  });
});

describe("isBedBlock", () => {
  it("returns true for bed blocks", () => {
    expect(isBedBlock("white_bed")).toBe(true);
    expect(isBedBlock("red_bed")).toBe(true);
    expect(isBedBlock("blue_bed")).toBe(true);
    expect(isBedBlock("black_bed")).toBe(true);
  });

  it("returns false for non-bed blocks", () => {
    expect(isBedBlock("wool")).toBe(false);
    expect(isBedBlock("oak_planks")).toBe(false);
    expect(isBedBlock("stone")).toBe(false);
  });
});

// ==============================
// Functions requiring a mock bot
// ==============================

function createMockBot(overrides: Record<string, unknown> = {}): any {
  return {
    registry: {
      entitiesByName: {
        zombie: { type: "hostile" },
        skeleton: { type: "hostile" },
        creeper: { type: "hostile" },
        cow: { type: "passive" },
        pig: { type: "passive" },
        chicken: { type: "animal" },
        sheep: { type: "animal" },
        horse: { type: "passive" },
        villager: { type: "passive" },
      },
      itemsByName: {
        bread: { id: 1 },
        apple: { id: 2 },
        cooked_beef: { id: 3 },
        golden_apple: { id: 4 },
        enchanted_golden_apple: { id: 40 },
        iron_ingot: { id: 5 },
        diamond: { id: 6 },
        cobblestone: { id: 7, boundingBox: "block" },
        dirt: { id: 8, boundingBox: "block" },
        // Food items needed for isFoodItem tests
        cooked_porkchop: { id: 10 },
        cooked_chicken: { id: 11 },
        cooked_mutton: { id: 12 },
        cooked_cod: { id: 13 },
        cooked_salmon: { id: 14 },
        beef: { id: 15 },
        porkchop: { id: 16 },
        chicken: { id: 17 },
        mutton: { id: 18 },
        rabbit: { id: 19 },
        carrot: { id: 20 },
        potato: { id: 21 },
        melon_slice: { id: 22 },
        sweet_berries: { id: 23 },
        cookie: { id: 24 },
        baked_potato: { id: 25 },
      },
      blocksByName: {
        cobblestone: { id: 100, boundingBox: "block" },
        dirt: { id: 101, boundingBox: "block" },
        diamond_ore: { id: 102, harvestTools: { 10: true, 11: true } },
        diamond_block: { id: 103, boundingBox: "block" },
        obsidian: { id: 104, boundingBox: "block" },
        air: { id: 0, boundingBox: "empty" },
        water: { id: 9, boundingBox: "empty" },
      },
    },
    ...overrides,
  };
}

describe("isHostileMob", () => {
  it("returns true for known hostile mobs from fallback list", () => {
    const bot = createMockBot();
    expect(isHostileMob(bot, "zombie")).toBe(true);
    expect(isHostileMob(bot, "skeleton")).toBe(true);
    expect(isHostileMob(bot, "creeper")).toBe(true);
    expect(isHostileMob(bot, "enderman")).toBe(true);
    expect(isHostileMob(bot, "blaze")).toBe(true);
    expect(isHostileMob(bot, "ghast")).toBe(true);
    expect(isHostileMob(bot, "wither")).toBe(true);
    expect(isHostileMob(bot, "ender_dragon")).toBe(true);
  });

  it("returns false for passive mobs", () => {
    const bot = createMockBot();
    expect(isHostileMob(bot, "cow")).toBe(false);
    expect(isHostileMob(bot, "pig")).toBe(false);
    expect(isHostileMob(bot, "chicken")).toBe(false);
    expect(isHostileMob(bot, "sheep")).toBe(false);
  });

  it("returns false for empty or falsy entity names", () => {
    const bot = createMockBot();
    expect(isHostileMob(bot, "")).toBe(false);
  });

  it("checks registry as fallback if not in hardcoded list", () => {
    const bot = createMockBot({
      registry: {
        entitiesByName: {
          custom_hostile: { type: "hostile" },
          custom_passive: { type: "passive" },
        },
      },
    });
    expect(isHostileMob(bot, "custom_hostile")).toBe(true);
    expect(isHostileMob(bot, "custom_passive")).toBe(false);
  });
});

describe("isPassiveMob", () => {
  it("returns true for passive mobs from registry", () => {
    const bot = createMockBot();
    expect(isPassiveMob(bot, "cow")).toBe(true);
    expect(isPassiveMob(bot, "pig")).toBe(true);
    expect(isPassiveMob(bot, "horse")).toBe(true);
    expect(isPassiveMob(bot, "villager")).toBe(true);
  });

  it("returns true for animal type in registry", () => {
    const bot = createMockBot();
    expect(isPassiveMob(bot, "chicken")).toBe(true);
    expect(isPassiveMob(bot, "sheep")).toBe(true);
  });

  it("returns false for hostile mobs", () => {
    const bot = createMockBot();
    expect(isPassiveMob(bot, "zombie")).toBe(false);
    expect(isPassiveMob(bot, "skeleton")).toBe(false);
  });

  it("returns false for empty string", () => {
    const bot = createMockBot();
    expect(isPassiveMob(bot, "")).toBe(false);
  });
});

describe("isFoodItem", () => {
  it("returns true for cooked meats", () => {
    const bot = createMockBot();
    expect(isFoodItem(bot, "cooked_beef")).toBe(true);
    expect(isFoodItem(bot, "cooked_porkchop")).toBe(true);
    expect(isFoodItem(bot, "cooked_chicken")).toBe(true);
    expect(isFoodItem(bot, "cooked_mutton")).toBe(true);
    expect(isFoodItem(bot, "cooked_cod")).toBe(true);
    expect(isFoodItem(bot, "cooked_salmon")).toBe(true);
  });

  it("returns true for raw meats", () => {
    const bot = createMockBot();
    expect(isFoodItem(bot, "beef")).toBe(true);
    expect(isFoodItem(bot, "porkchop")).toBe(true);
    expect(isFoodItem(bot, "chicken")).toBe(true);
    expect(isFoodItem(bot, "mutton")).toBe(true);
    expect(isFoodItem(bot, "rabbit")).toBe(true);
  });

  it("returns true for common foods", () => {
    const bot = createMockBot();
    expect(isFoodItem(bot, "bread")).toBe(true);
    expect(isFoodItem(bot, "apple")).toBe(true);
    expect(isFoodItem(bot, "carrot")).toBe(true);
    expect(isFoodItem(bot, "potato")).toBe(true);
    expect(isFoodItem(bot, "melon_slice")).toBe(true);
    expect(isFoodItem(bot, "sweet_berries")).toBe(true);
    expect(isFoodItem(bot, "cookie")).toBe(true);
  });

  it("returns true for golden apples", () => {
    const bot = createMockBot();
    expect(isFoodItem(bot, "golden_apple")).toBe(true);
    expect(isFoodItem(bot, "enchanted_golden_apple")).toBe(true);
  });

  it("returns true for baked items", () => {
    const bot = createMockBot();
    expect(isFoodItem(bot, "baked_potato")).toBe(true);
  });

  it("returns false for non-food items when item not in registry", () => {
    const bot = createMockBot();
    // iron_ingot is in registry but doesn't match food patterns
    expect(isFoodItem(bot, "iron_ingot")).toBe(false);
    expect(isFoodItem(bot, "diamond")).toBe(false);
  });

  it("returns false for items not in registry", () => {
    const bot = createMockBot();
    // non-existent item
    expect(isFoodItem(bot, "nonexistent_item")).toBe(false);
  });
});

describe("isScaffoldBlock", () => {
  it("returns true for common building blocks", () => {
    const bot = createMockBot();
    expect(isScaffoldBlock(bot, "cobblestone")).toBe(true);
    expect(isScaffoldBlock(bot, "dirt")).toBe(true);
  });

  it("returns false for valuable blocks", () => {
    const bot = createMockBot();
    expect(isScaffoldBlock(bot, "diamond_ore")).toBe(false);
    expect(isScaffoldBlock(bot, "diamond_block")).toBe(false);
    expect(isScaffoldBlock(bot, "obsidian")).toBe(false);
  });

  it("returns false for non-solid blocks", () => {
    const bot = createMockBot();
    expect(isScaffoldBlock(bot, "air")).toBe(false);
    expect(isScaffoldBlock(bot, "water")).toBe(false);
  });

  it("returns false for blocks not in registry", () => {
    const bot = createMockBot();
    expect(isScaffoldBlock(bot, "nonexistent_block")).toBe(false);
  });
});
