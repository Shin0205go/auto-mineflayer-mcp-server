import { describe, it, expect } from "vitest";
import { searchTools, TOOL_METADATA, getToolCategories } from "../src/tool-metadata.js";

// Suppress console.error from searchTools debug logging
vi.spyOn(console, "error").mockImplementation(() => {});

// Simulate the full set of tool names as registered in index.ts
const ALL_TOOL_NAMES = new Set(Object.keys(TOOL_METADATA));

describe("TOOL_METADATA", () => {
  it("has metadata for all expected core tools", () => {
    const coreTools = [
      "minecraft_connect",
      "minecraft_disconnect",
      "minecraft_get_position",
      "minecraft_move_to",
      "minecraft_chat",
      "minecraft_get_surroundings",
      "minecraft_find_block",
      "minecraft_get_inventory",
      "minecraft_craft",
      "minecraft_smelt",
      "minecraft_dig_block",
      "minecraft_place_block",
      "minecraft_attack",
      "minecraft_eat",
      "minecraft_flee",
      "minecraft_get_status",
      "minecraft_gather_resources",
      "minecraft_build_structure",
      "minecraft_craft_chain",
      "minecraft_survival_routine",
      "minecraft_explore_area",
    ];
    for (const tool of coreTools) {
      expect(TOOL_METADATA[tool], `Missing metadata for ${tool}`).toBeDefined();
    }
  });

  it("every tool has a non-empty category", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(meta.category, `${name} has empty category`).toBeTruthy();
    }
  });

  it("every tool has at least one tag", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(meta.tags.length, `${name} has no tags`).toBeGreaterThan(0);
    }
  });

  it("high-level action tools have high priority", () => {
    const highLevel = [
      "minecraft_gather_resources",
      "minecraft_craft_chain",
      "minecraft_survival_routine",
    ];
    for (const tool of highLevel) {
      const priority = TOOL_METADATA[tool]?.priority ?? 0;
      expect(priority, `${tool} should have priority >= 8`).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("searchTools", () => {
  it("returns top priority tools for empty query", () => {
    const results = searchTools("", ALL_TOOL_NAMES);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("finds tools by category", () => {
    const combatTools = searchTools("combat", ALL_TOOL_NAMES);
    expect(combatTools).toContain("minecraft_attack");
    expect(combatTools).toContain("minecraft_equip_armor");
  });

  it("finds tools by tag keyword", () => {
    const survivalTools = searchTools("survival", ALL_TOOL_NAMES);
    expect(survivalTools).toContain("minecraft_survival_routine");
    expect(survivalTools).toContain("minecraft_eat");
    expect(survivalTools).toContain("minecraft_flee");
  });

  it("finds tools by partial tag match", () => {
    const miningTools = searchTools("mining", ALL_TOOL_NAMES);
    expect(miningTools).toContain("minecraft_dig_block");
    expect(miningTools).toContain("minecraft_gather_resources");
  });

  it("returns empty for nonsensical queries", () => {
    const results = searchTools("zzzznotavalidtag", ALL_TOOL_NAMES);
    expect(results.length).toBe(0);
  });

  it("only returns tools from the available set", () => {
    const limited = new Set(["minecraft_connect", "minecraft_disconnect"]);
    const results = searchTools("connection", limited);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const tool of results) {
      expect(limited.has(tool)).toBe(true);
    }
  });

  it("results are sorted by priority (descending)", () => {
    const results = searchTools("", ALL_TOOL_NAMES);
    for (let i = 1; i < results.length; i++) {
      const prevPriority = TOOL_METADATA[results[i - 1]]?.priority ?? 0;
      const currPriority = TOOL_METADATA[results[i]]?.priority ?? 0;
      expect(prevPriority).toBeGreaterThanOrEqual(currPriority);
    }
  });
});

describe("getToolCategories", () => {
  it("groups tools by category", () => {
    const categories = getToolCategories(ALL_TOOL_NAMES);
    expect(Object.keys(categories).length).toBeGreaterThan(0);

    // Should have common categories
    expect(categories["connection"]).toBeDefined();
    expect(categories["info"]).toBeDefined();
    expect(categories["actions"]).toBeDefined();
  });

  it("each category contains valid tool names", () => {
    const categories = getToolCategories(ALL_TOOL_NAMES);
    for (const [category, tools] of Object.entries(categories)) {
      for (const tool of tools) {
        expect(TOOL_METADATA[tool], `${tool} in category ${category} not in metadata`).toBeDefined();
        expect(TOOL_METADATA[tool].category).toBe(category);
      }
    }
  });
});
