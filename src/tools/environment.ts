import { botManager } from "../bot-manager.js";

export const environmentTools = {
  minecraft_look_around: {
    description:
      "Scan the surrounding blocks within a specified radius",
    inputSchema: {
      type: "object" as const,
      properties: {
        radius: {
          type: "number",
          description: "Scan radius in blocks (default: 5, max: 10)",
          default: 5,
        },
      },
      required: [],
    },
  },
};

export async function handleEnvironmentTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_look_around": {
      let radius = (args.radius as number) || 5;
      radius = Math.min(radius, 10); // Limit to 10 blocks

      const blocks = await botManager.lookAround(username, radius);

      // Group blocks by type for easier reading
      const blockCounts: Record<string, number> = {};
      for (const block of blocks) {
        blockCounts[block.name] = (blockCounts[block.name] || 0) + 1;
      }

      const summary = Object.entries(blockCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join("\n");

      return `Found ${blocks.length} blocks within ${radius} block radius:\n\n${summary}\n\nDetailed positions available for ${Math.min(blocks.length, 20)} blocks:\n${blocks
        .slice(0, 20)
        .map((b) => `- ${b.name} at (${b.position.x}, ${b.position.y}, ${b.position.z})`)
        .join("\n")}`;
    }

    default:
      throw new Error(`Unknown environment tool: ${name}`);
  }
}
