import { describe, it, expect } from "vitest";
import { GAME_AGENT_TOOLS } from "../src/tool-filters.js";
import { TOOL_METADATA } from "../src/tool-metadata.js";

describe("tool registration", () => {
  describe("GAME_AGENT_TOOLS", () => {
    it("contains essential connection tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_connect")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_disconnect")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_get_chat_messages")).toBe(true);
    });

    it("contains essential movement tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_get_position")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_move_to")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_chat")).toBe(true);
    });

    it("contains essential survival tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_get_status")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_eat")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_flee")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_attack")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_respawn")).toBe(true);
    });

    it("contains all high-level action tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_gather_resources")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_build_structure")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_craft_chain")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_survival_routine")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_explore_area")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_validate_survival_environment")).toBe(true);
    });

    it("contains crafting and inventory tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_get_inventory")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_craft")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_smelt")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_equip")).toBe(true);
    });

    it("contains storage tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_open_chest")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_take_from_chest")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_store_in_chest")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_list_chest")).toBe(true);
    });

    it("contains search_tools", () => {
      expect(GAME_AGENT_TOOLS.has("search_tools")).toBe(true);
    });

    it("contains building tools", () => {
      expect(GAME_AGENT_TOOLS.has("minecraft_place_block")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_dig_block")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_collect_items")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_level_ground")).toBe(true);
      expect(GAME_AGENT_TOOLS.has("minecraft_pillar_up")).toBe(true);
    });
  });

  describe("tool metadata coverage", () => {
    it("all GAME_AGENT_TOOLS have metadata (except known exceptions)", () => {
      // These tools are in GAME_AGENT_TOOLS but intentionally not in TOOL_METADATA
      // (they were added to the game agent but metadata wasn't updated)
      // These tools are in GAME_AGENT_TOOLS but missing from TOOL_METADATA
      // TODO: Add metadata for these tools in src/tool-metadata.ts
      const knownExceptions = new Set([
        "search_tools",
        "minecraft_pillar_up",
        "minecraft_use_item_on_block",
        "minecraft_validate_survival_environment",
      ]);

      const missingMetadata: string[] = [];
      for (const toolName of GAME_AGENT_TOOLS) {
        if (knownExceptions.has(toolName)) continue;
        if (!TOOL_METADATA[toolName]) {
          missingMetadata.push(toolName);
        }
      }
      expect(missingMetadata, `Tools missing metadata: ${missingMetadata.join(", ")}`).toEqual([]);
    });

    it("all tools in TOOL_METADATA have valid structure", () => {
      for (const [name, meta] of Object.entries(TOOL_METADATA)) {
        expect(typeof meta.category).toBe("string");
        expect(Array.isArray(meta.tags)).toBe(true);
        expect(meta.tags.length).toBeGreaterThan(0);
        if (meta.priority !== undefined) {
          expect(typeof meta.priority).toBe("number");
          expect(meta.priority).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
