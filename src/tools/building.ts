import { botManager } from "../bot-manager.js";

export const buildingTools = {
  minecraft_place_block: {
    description: "Place a single block at specified coordinates (requires operator permissions)",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description: "Minecraft block ID (e.g., 'stone', 'oak_planks', 'glass')",
        },
        x: {
          type: "number",
          description: "X coordinate",
        },
        y: {
          type: "number",
          description: "Y coordinate",
        },
        z: {
          type: "number",
          description: "Z coordinate",
        },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },

  minecraft_build_structure: {
    description:
      "Build a preset structure at specified or nearby location (requires operator permissions)",
    inputSchema: {
      type: "object" as const,
      properties: {
        structure: {
          type: "string",
          enum: ["house", "tower", "marker"],
          description:
            "Structure type: house (5x5x4 wooden house), tower (10-block cobblestone tower), marker (glowstone pillar)",
        },
        x: {
          type: "number",
          description: "X coordinate (optional, defaults to near bot)",
        },
        y: {
          type: "number",
          description: "Y coordinate (optional, defaults to bot's Y level)",
        },
        z: {
          type: "number",
          description: "Z coordinate (optional, defaults to near bot)",
        },
      },
      required: ["structure"],
    },
  },
};

export async function handleBuildingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_place_block": {
      const blockType = args.block_type as string;
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      if (!blockType) {
        throw new Error("Block type is required");
      }

      await botManager.placeBlock(blockType, x, y, z);
      return `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})`;
    }

    case "minecraft_build_structure": {
      const structure = args.structure as "house" | "tower" | "marker";
      const x = args.x as number | undefined;
      const y = args.y as number | undefined;
      const z = args.z as number | undefined;

      const validStructures = ["house", "tower", "marker"];
      if (!validStructures.includes(structure)) {
        throw new Error(
          `Invalid structure: ${structure}. Must be one of: ${validStructures.join(", ")}`
        );
      }

      await botManager.buildStructure(structure, x, y, z);

      const structureDescriptions = {
        house: "5x5x4 wooden house with door and window",
        tower: "10-block tall cobblestone tower with platform",
        marker: "Glowstone pillar with redstone torch",
      };

      const pos = botManager.getPosition();
      const buildX = x ?? (pos ? Math.floor(pos.x) + 3 : 0);
      const buildY = y ?? (pos ? Math.floor(pos.y) : 0);
      const buildZ = z ?? (pos ? Math.floor(pos.z) : 0);

      return `Built ${structure} (${structureDescriptions[structure]}) at approximately (${buildX}, ${buildY}, ${buildZ})`;
    }

    default:
      throw new Error(`Unknown building tool: ${name}`);
  }
}
