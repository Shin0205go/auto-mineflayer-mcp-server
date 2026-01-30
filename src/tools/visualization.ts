import { botManager, ThinkingState } from "../bot-manager.js";

export const visualizationTools = {
  minecraft_visualize_thinking: {
    description:
      "Visualize the AI's thinking state using particles above the bot",
    inputSchema: {
      type: "object" as const,
      properties: {
        state: {
          type: "string",
          enum: ["idle", "processing", "searching", "executing", "error"],
          description:
            "Thinking state: idle (gray dust), processing (flame), searching (enchant), executing (green particles), error (red dust)",
        },
        message: {
          type: "string",
          description: "Optional message to display in chat",
        },
      },
      required: ["state"],
    },
  },
};

export async function handleVisualizationTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_visualize_thinking": {
      const state = args.state as ThinkingState;
      const message = args.message as string | undefined;

      const validStates: ThinkingState[] = [
        "idle",
        "processing",
        "searching",
        "executing",
        "error",
      ];

      if (!validStates.includes(state)) {
        throw new Error(
          `Invalid state: ${state}. Must be one of: ${validStates.join(", ")}`
        );
      }

      await botManager.visualizeThinking(state, message);

      const stateDescriptions: Record<ThinkingState, string> = {
        idle: "Waiting (gray dust particles)",
        processing: "Processing/calculating (flame particles)",
        searching: "Searching/gathering info (enchant particles)",
        executing: "Executing action (green particles)",
        error: "Error occurred (red dust particles)",
      };

      return `Thinking state set to: ${state} - ${stateDescriptions[state]}${message ? `\nMessage: ${message}` : ""}`;
    }

    default:
      throw new Error(`Unknown visualization tool: ${name}`);
  }
}
