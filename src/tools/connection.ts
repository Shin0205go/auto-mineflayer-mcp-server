import { botManager } from "../bot-manager.js";

export const connectionTools = {
  minecraft_connect: {
    description: "Connect to a Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {
        host: {
          type: "string",
          description: "Server host address (default: localhost)",
          default: "localhost",
        },
        port: {
          type: "number",
          description: "Server port (default: 25565)",
          default: 25565,
        },
        username: {
          type: "string",
          description: "Bot username",
        },
        version: {
          type: "string",
          description: "Minecraft version (optional, auto-detect if not specified)",
        },
      },
      required: ["username"],
    },
  },

  minecraft_disconnect: {
    description: "Disconnect from the Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleConnectionTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_connect": {
      const host = (args.host as string) || "localhost";
      const port = (args.port as number) || 25565;
      const username = args.username as string;
      const version = args.version as string | undefined;

      if (!username) {
        throw new Error("Username is required");
      }

      await botManager.connect({ host, port, username, version });
      return `Successfully connected to ${host}:${port} as ${username}`;
    }

    case "minecraft_disconnect": {
      await botManager.disconnect();
      return "Successfully disconnected from server";
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
