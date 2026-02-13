import { botManager } from "../bot-manager/index.js";
import { setAgentType } from "../agent-state.js";

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
        agentType: {
          type: "string",
          enum: ["game", "dev"],
          default: "dev",
          description: "Agent type: 'game' for Game Agent (basic tools only), 'dev' for Dev Agent (all tools). Default: 'dev' for Claude Code CLI.",
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

  minecraft_get_chat_messages: {
    description: "Get chat messages from players",
    inputSchema: {
      type: "object" as const,
      properties: {
        clear: {
          type: "boolean",
          description: "Whether to clear messages after reading (default: true)",
          default: true,
        },
      },
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
      const host = (args.host as string) || process.env.MC_HOST || "localhost";
      const port = (args.port as number) || parseInt(process.env.MC_PORT || "25565");
      const username = args.username as string;
      const version = args.version as string | undefined;
      const agentType = (args.agentType as "game" | "dev") || "dev";

      if (!username) {
        throw new Error("Username is required");
      }

      // Set agent type for tool filtering
      setAgentType(agentType);

      try {
        // Disable viewer for stdio MCP connections to avoid port conflicts
        // Viewer is only useful for WebSocket connections where agents run persistently
        await botManager.connect({ host, port, username, version, disableViewer: true });

        // Auto-validate survival environment for Game Agents
        if (agentType === "game") {
          // Import validation function dynamically to avoid circular dependency
          const { minecraft_validate_survival_environment } = await import("./high-level-actions.js");

          // Wait 2 seconds for the world to load
          await new Promise(resolve => setTimeout(resolve, 2000));

          try {
            const validationResult = await minecraft_validate_survival_environment(username, 100);
            if (validationResult.includes("❌ CRITICAL")) {
              // Return warning but don't block connection
              return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})\n\n${validationResult}`;
            }
          } catch (validationError) {
            // Validation failed, but don't block connection
            console.error(`[Connection] Survival validation failed: ${validationError}`);
          }
        }

        return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect to ${host}:${port}: ${errorMessage}`);
      }
    }

    case "minecraft_disconnect": {
      const username = botManager.requireSingleBot();
      await botManager.disconnect(username);
      return "Successfully disconnected from server";
    }

    case "minecraft_get_chat_messages": {
      const username = botManager.requireSingleBot();
      const clear = args.clear !== false;
      const messages = botManager.getChatMessages(username, clear);

      if (messages.length === 0) {
        return "No new chat messages";
      }

      return JSON.stringify(messages, null, 2);
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
