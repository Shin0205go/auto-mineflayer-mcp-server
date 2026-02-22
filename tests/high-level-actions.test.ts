import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock the botManager module before importing high-level-actions
// The high-level-actions module imports botManager at module level

const mockBotManager = {
  findBlock: vi.fn(),
  getPosition: vi.fn(),
  moveTo: vi.fn(),
  getInventory: vi.fn(),
  digBlock: vi.fn(),
  collectNearbyItems: vi.fn(),
  getStatus: vi.fn(),
  findEntities: vi.fn(),
  fight: vi.fn(),
  eat: vi.fn(),
  craftItem: vi.fn(),
  placeBlock: vi.fn(),
  levelGround: vi.fn(),
  fish: vi.fn(),
  getBiome: vi.fn(),
  getBot: vi.fn(),
  isConnected: vi.fn(),
  flee: vi.fn(),
  attack: vi.fn(),
};

vi.mock("../src/bot-manager/index.js", () => ({
  botManager: mockBotManager,
}));

// Import AFTER mocking
const {
  minecraft_gather_resources,
  minecraft_survival_routine,
  minecraft_build_structure,
  minecraft_craft_chain,
} = await import("../src/tools/high-level-actions.js");

describe("minecraft_gather_resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error from the functions under test
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns result when no blocks found", async () => {
    mockBotManager.findBlock.mockReturnValue("No iron_ore found within 32 blocks");
    mockBotManager.getInventory.mockReturnValue([]);

    const result = await minecraft_gather_resources("TestBot", [
      { name: "iron_ore", count: 3 },
    ]);

    expect(result).toContain("Gathering complete");
    expect(result).toContain("iron_ore: 0/3");
    expect(mockBotManager.findBlock).toHaveBeenCalledWith("TestBot", "iron_ore", 32);
  });

  it("parses coordinates from findBlock result", async () => {
    // First call finds block, subsequent calls say no more
    mockBotManager.findBlock
      .mockReturnValueOnce('Found 1 matching "oak_log". Nearest:\noak_log at (10, 65, -20) - 5.0 blocks')
      .mockReturnValueOnce("No oak_log found within 32 blocks");
    mockBotManager.getPosition.mockReturnValue({ x: 5, y: 65, z: -15 });
    mockBotManager.moveTo.mockResolvedValue("Reached (10, 65, -20)");
    mockBotManager.getInventory
      .mockReturnValueOnce([]) // before dig
      .mockReturnValueOnce([{ name: "oak_log", count: 1 }]) // after dig
      .mockReturnValueOnce([{ name: "oak_log", count: 1 }]); // final
    mockBotManager.digBlock.mockResolvedValue("Dug oak_log");
    mockBotManager.collectNearbyItems.mockResolvedValue("Collected 1 items");

    const result = await minecraft_gather_resources("TestBot", [
      { name: "oak_log", count: 1 },
    ]);

    expect(result).toContain("oak_log: 1/1");
    expect(mockBotManager.moveTo).toHaveBeenCalledWith("TestBot", 10, 65, -20);
    expect(mockBotManager.digBlock).toHaveBeenCalledWith("TestBot", 10, 65, -20);
  });

  it("handles dig failure and continues", async () => {
    mockBotManager.findBlock
      .mockReturnValueOnce('Found 1 matching "stone". Nearest:\nstone at (5, 60, 5) - 3.0 blocks')
      .mockReturnValueOnce("No stone found within 32 blocks");
    mockBotManager.getPosition.mockReturnValue({ x: 3, y: 60, z: 3 });
    mockBotManager.moveTo.mockResolvedValue("Reached (5, 60, 5)");
    mockBotManager.getInventory.mockReturnValue([]);
    mockBotManager.digBlock.mockResolvedValue("Failed to dig stone - need correct tool");
    mockBotManager.collectNearbyItems.mockResolvedValue("No items");

    const result = await minecraft_gather_resources("TestBot", [
      { name: "stone", count: 5 },
    ]);

    // Should still complete without errors, just with 0 collected
    expect(result).toContain("stone: 0/5");
  });

  it("handles multiple item types", async () => {
    mockBotManager.findBlock.mockReturnValue("No blocks found within 32 blocks");
    mockBotManager.getInventory.mockReturnValue([]);

    const result = await minecraft_gather_resources("TestBot", [
      { name: "oak_log", count: 4 },
      { name: "cobblestone", count: 8 },
    ]);

    expect(result).toContain("oak_log: 0/4");
    expect(result).toContain("cobblestone: 0/8");
  });
});

describe("minecraft_survival_routine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-selects food priority when hunger is low", async () => {
    mockBotManager.getStatus.mockReturnValue(JSON.stringify({
      health: "20.0/20",
      hunger: "5/20",
    }));
    mockBotManager.getInventory.mockReturnValue([]);
    mockBotManager.findEntities.mockReturnValue("cow x2 (nearest: 10.0 blocks at 5, 64, 5)");
    mockBotManager.fight.mockResolvedValue("Killed cow");
    mockBotManager.collectNearbyItems.mockResolvedValue("Collected 2 items");

    const result = await minecraft_survival_routine("TestBot", "auto");

    expect(result).toContain("food");
    expect(mockBotManager.fight).toHaveBeenCalledWith("TestBot", "cow", 0);
  });

  it("auto-selects tools priority when no pickaxe and hunger ok", async () => {
    mockBotManager.getStatus.mockReturnValue(JSON.stringify({
      health: "20.0/20",
      hunger: "18/20",
    }));
    mockBotManager.getInventory.mockReturnValue([
      { name: "oak_log", count: 10 },
      { name: "stick", count: 5 },
    ]);
    // Mock craftItem for the recursive craft chain
    mockBotManager.craftItem.mockResolvedValue("Crafted wooden_pickaxe");

    const result = await minecraft_survival_routine("TestBot", "auto");

    expect(result).toContain("tools");
  });

  it("auto-selects shelter when has tools and not hungry", async () => {
    mockBotManager.getStatus.mockReturnValue(JSON.stringify({
      health: "20.0/20",
      hunger: "18/20",
    }));
    mockBotManager.getInventory.mockReturnValue([
      { name: "stone_pickaxe", count: 1 },
      { name: "cobblestone", count: 64 },
    ]);
    mockBotManager.getPosition.mockReturnValue({ x: 0, y: 64, z: 0 });
    mockBotManager.levelGround.mockResolvedValue("Ground leveled");
    mockBotManager.placeBlock.mockResolvedValue({ success: true, message: "Placed" });

    const result = await minecraft_survival_routine("TestBot", "auto");

    expect(result).toContain("shelter");
  });

  it("food priority hunts zombies as fallback when no animals", async () => {
    mockBotManager.getStatus.mockReturnValue(JSON.stringify({
      health: "10.0/20",
      hunger: "3/20",
    }));
    mockBotManager.getInventory.mockReturnValue([]);
    // No food animals found, but zombies exist
    mockBotManager.findEntities.mockReturnValue("zombie x1 (nearest: 8.0 blocks at 5, 64, 5)");
    mockBotManager.fight.mockResolvedValue("Killed zombie");
    mockBotManager.collectNearbyItems.mockResolvedValue("Collected 1 items");
    mockBotManager.eat.mockResolvedValue("Ate rotten_flesh");

    const result = await minecraft_survival_routine("TestBot", "food");

    // Should attempt zombie hunt as emergency fallback
    expect(mockBotManager.fight).toHaveBeenCalledWith("TestBot", "zombie", 6);
  });
});

describe("minecraft_craft_chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crafts directly when possible", async () => {
    mockBotManager.craftItem.mockResolvedValue("Crafted 1 oak_planks");
    mockBotManager.getInventory.mockReturnValue([{ name: "oak_planks", count: 4 }]);

    const result = await minecraft_craft_chain("TestBot", "oak_planks");

    expect(result).toContain("Crafting chain complete for oak_planks");
    expect(mockBotManager.craftItem).toHaveBeenCalledWith("TestBot", "oak_planks", 1);
  });

  it("reports failure when craft is impossible", async () => {
    mockBotManager.craftItem.mockRejectedValue(new Error("No recipe found for diamond_sword"));
    mockBotManager.getInventory.mockReturnValue([]);

    const result = await minecraft_craft_chain("TestBot", "diamond_sword");

    expect(result).toContain("Crafting chain failed");
    expect(result).toContain("diamond_sword");
  });

  it("reports crafting table requirement clearly", async () => {
    mockBotManager.craftItem.mockRejectedValue(
      new Error("Requires crafting_table nearby. Place one nearby and retry.")
    );
    mockBotManager.getInventory.mockReturnValue([{ name: "oak_planks", count: 4 }]);

    const result = await minecraft_craft_chain("TestBot", "wooden_pickaxe");

    expect(result).toContain("crafting_table");
  });
});

describe("minecraft_build_structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails when no building materials available", async () => {
    mockBotManager.getPosition.mockReturnValue({ x: 0, y: 64, z: 0 });
    mockBotManager.getInventory.mockReturnValue([
      { name: "dirt", count: 5 },
    ]);
    mockBotManager.levelGround.mockResolvedValue("Ground leveled");

    const result = await minecraft_build_structure("TestBot", "shelter", "small");

    expect(result).toContain("Need at least 20 building blocks");
  });

  it("builds shelter with sufficient materials", async () => {
    mockBotManager.getPosition.mockReturnValue({ x: 0, y: 64, z: 0 });
    mockBotManager.getInventory
      .mockReturnValueOnce([{ name: "cobblestone", count: 100 }]) // check materials
      .mockReturnValueOnce([{ name: "cobblestone", count: 50 }]); // final inventory
    mockBotManager.levelGround.mockResolvedValue("Ground leveled");
    mockBotManager.placeBlock.mockResolvedValue({ success: true, message: "Placed" });

    const result = await minecraft_build_structure("TestBot", "shelter", "small");

    expect(result).toContain("shelter");
    expect(result).toContain("Blocks placed:");
    expect(mockBotManager.placeBlock).toHaveBeenCalled();
  });

  it("returns position error when bot has no position", async () => {
    mockBotManager.getPosition.mockReturnValue(null);

    const result = await minecraft_build_structure("TestBot", "platform", "small");

    expect(result).toContain("Failed to get bot position");
  });
});
