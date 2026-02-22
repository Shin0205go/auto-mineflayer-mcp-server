import { describe, it, expect, vi } from "vitest";
import { getChatMessages, getGameEvents, getInventory } from "../src/bot-manager/bot-info.js";
import type { ManagedBot, ChatMessage, GameEvent } from "../src/bot-manager/types.js";

function createMockManagedBot(overrides: Partial<ManagedBot> = {}): ManagedBot {
  return {
    bot: {
      inventory: {
        items: () => [],
      },
      entity: {
        position: { x: 0, y: 64, z: 0, distanceTo: () => 0 },
      },
    } as any,
    username: "TestBot",
    config: { host: "localhost", port: 25565, username: "TestBot" },
    chatMessages: [],
    gameEvents: [],
    thinkingState: "idle",
    particleInterval: null,
    ...overrides,
  };
}

describe("getChatMessages", () => {
  it("returns all messages and clears by default", () => {
    const messages: ChatMessage[] = [
      { username: "Player1", message: "Hello", timestamp: 1000 },
      { username: "Player2", message: "World", timestamp: 2000 },
    ];
    const managed = createMockManagedBot({ chatMessages: [...messages] });

    const result = getChatMessages(managed);

    expect(result).toEqual(messages);
    expect(managed.chatMessages).toEqual([]);
  });

  it("does not clear when clear=false", () => {
    const messages: ChatMessage[] = [
      { username: "Player1", message: "Test", timestamp: 1000 },
    ];
    const managed = createMockManagedBot({ chatMessages: [...messages] });

    const result = getChatMessages(managed, false);

    expect(result).toEqual(messages);
    expect(managed.chatMessages).toEqual(messages);
  });

  it("returns empty array when no messages", () => {
    const managed = createMockManagedBot();

    const result = getChatMessages(managed);

    expect(result).toEqual([]);
  });
});

describe("getGameEvents", () => {
  it("returns all events and clears by default", () => {
    const events: GameEvent[] = [
      { type: "death", message: "Bot died", timestamp: 1000 },
      { type: "spawn", message: "Bot spawned", timestamp: 2000 },
    ];
    const managed = createMockManagedBot({ gameEvents: [...events] });

    const result = getGameEvents(managed);

    expect(result).toEqual(events);
    expect(managed.gameEvents).toEqual([]);
  });

  it("returns last N events when specified", () => {
    const events: GameEvent[] = [
      { type: "a", message: "first", timestamp: 1000 },
      { type: "b", message: "second", timestamp: 2000 },
      { type: "c", message: "third", timestamp: 3000 },
    ];
    const managed = createMockManagedBot({ gameEvents: [...events] });

    const result = getGameEvents(managed, true, 2);

    expect(result).toEqual([
      { type: "b", message: "second", timestamp: 2000 },
      { type: "c", message: "third", timestamp: 3000 },
    ]);
  });

  it("does not clear when clear=false", () => {
    const events: GameEvent[] = [
      { type: "test", message: "event", timestamp: 1000 },
    ];
    const managed = createMockManagedBot({ gameEvents: [...events] });

    const result = getGameEvents(managed, false);

    expect(result).toEqual(events);
    expect(managed.gameEvents).toEqual(events);
  });
});

describe("getInventory", () => {
  it("returns empty array for empty inventory", () => {
    const managed = createMockManagedBot();

    const result = getInventory(managed.bot as any);

    expect(result).toEqual([]);
  });

  it("returns all items in inventory", () => {
    const mockItems = [
      { name: "oak_log", count: 10, type: 1, slot: 0 },
      { name: "cobblestone", count: 64, type: 2, slot: 1 },
      { name: "iron_pickaxe", count: 1, type: 3, slot: 2 },
    ];
    const bot = {
      inventory: {
        items: () => mockItems,
      },
    } as any;

    const result = getInventory(bot);

    expect(result).toEqual([
      { name: "oak_log", count: 10 },
      { name: "cobblestone", count: 64 },
      { name: "iron_pickaxe", count: 1 },
    ]);
  });
});
