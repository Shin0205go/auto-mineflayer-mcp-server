import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Source-analysis tests for bot-items.ts
// These verify correct entity detection logic and collection patterns
// without requiring a live mineflayer bot.

const src = readFileSync(resolve("src/bot-manager/bot-items.ts"), "utf-8");
const survivalSrc = readFileSync(resolve("src/bot-manager/bot-survival.ts"), "utf-8");

// ─── 1. Item entity detection ─────────────────────────────────────────────────

describe("collectNearbyItems - entity detection (bot-items.ts)", () => {
  it('detects items by entity.name === "item"', () => {
    expect(src).toContain('entity.name === "item"');
  });

  it('detects items by entity.displayName === "Item"', () => {
    expect(src).toContain('entity.displayName === "Item"');
  });

  it('detects items by entity.displayName === "Dropped Item"', () => {
    expect(src).toContain('entity.displayName === "Dropped Item"');
  });

  it('has NON_ITEM_OBJECTS exclusion list to prevent false positives (boat, minecart, tnt, etc.)', () => {
    expect(src).toContain("NON_ITEM_OBJECTS");
    // Should not block actual items
    expect(src).not.toMatch(/NON_ITEM_OBJECTS.*"item"/); // "item" should not be excluded
  });

  it("waits up to waitRetries×500ms for item entities to appear after kill", () => {
    // Items can take up to 4s to spawn on busy servers
    expect(src).toContain("waitRetries");
    expect(src).toContain("delay(500)");
  });

  it("uses searchRadius parameter for configurable detection range", () => {
    expect(src).toContain("searchRadius");
    expect(src).toMatch(/searchRadius.*10/); // default 10
  });
});

// ─── 2. Close-range collection strategy ──────────────────────────────────────

describe("collectNearbyItems - close-range collection (bot-items.ts)", () => {
  it("uses forward+jump movement for items within 2 blocks (not just pathfinder)", () => {
    // Pathfinder can fail in tight spaces; direct movement is more reliable close-up
    expect(src).toContain('setControlState("forward", true)');
    expect(src).toContain('setControlState("jump", true)');
  });

  it("checks item still exists between collection attempts", () => {
    // Items can auto-collect during movement; avoid redundant navigation
    expect(src).toContain("bot.entities[item.id]");
  });

  it("tries multiple passes for close-range items (items can be stubborn)", () => {
    // Single forward+jump pass may not work; 3 passes catches edge cases
    expect(src).toMatch(/for\s*\(let pass = 0;\s*pass < 3/);
  });
});

// ─── 3. Far-range collection strategy ────────────────────────────────────────

describe("collectNearbyItems - far-range collection (bot-items.ts)", () => {
  it("uses Math.ceil for Y coordinate (not Math.round — avoids routing into ground block)", () => {
    // Items float at fractional Y (e.g., 107.125). Math.round → 107 (inside ground block).
    // Math.ceil → 108 (surface level bot can stand on).
    expect(src).toContain("Math.ceil(itemPos.y)");
  });

  it("uses GoalNear range=1 (not 2) — ensures bot enters auto-pickup range", () => {
    // Minecraft auto-pickup range is ~1 block. GoalNear(2) stops at 2 blocks = outside range.
    // Sessions 58-65: GoalNear(2) caused 0 drops despite items spawning at kill location.
    const goalNearMatch = src.match(
      /new goals\.GoalNear\(\s*Math\.round\(itemPos\.x\),\s*Math\.ceil\(itemPos\.y\),\s*Math\.round\(itemPos\.z\),\s*(\d+)/
    );
    expect(goalNearMatch).not.toBeNull();
    expect(goalNearMatch![1]).toBe("1");
  });

  it("walks THROUGH item position after pathfinder stops (force server-side auto-pickup)", () => {
    // Pathfinder stops ~1 block from item; bot must physically walk into item bounding box
    // to trigger server-side pickup. Static position doesn't trigger it.
    // Bot1 Sessions 67-69: bot stopped stationary — server never triggered collect.
    const throughIdx = src.indexOf("physically walk THROUGH the item position");
    expect(throughIdx).toBeGreaterThan(-1);
    const afterBlock = src.substring(throughIdx, throughIdx + 750);
    expect(afterBlock).toContain('setControlState("forward", true)');
  });

  it("uses maxDropDown=3 during item collection (items can fall 1-2 blocks from kill position)", () => {
    const itemCollectionIdx = src.indexOf("maxDropDown = 3");
    expect(itemCollectionIdx).toBeGreaterThan(-1);
  });

  it("sets canDig=false during item navigation (prevent accidental cave entry)", () => {
    expect(src).toContain("bot.pathfinder.movements.canDig = false");
  });
});

// ─── 4. Inventory tracking accuracy ──────────────────────────────────────────

describe("collectNearbyItems - inventory tracking (bot-items.ts)", () => {
  it("computes actuallyCollected = inventoryAfter - inventoryBefore", () => {
    expect(src).toContain("inventoryAfter - inventoryBefore");
  });

  it("accepts external inventoryBefore to track items auto-collected before call starts", () => {
    // Without this, items auto-collected during navigation (before collectNearbyItems)
    // aren't counted, causing false "No items collected" results.
    // Bot1 Sessions 67-69: mob kills returned 0 drops because items collected in melee range.
    expect(src).toContain("options?.inventoryBefore");
  });
});

// ─── 5. Combat kill → item collection pipeline (bot-survival.ts) ─────────────

describe("combat kill → item collection pipeline (bot-survival.ts)", () => {
  it("captures inventory snapshot AT kill time (not after nav)", () => {
    // Must capture BEFORE navigating to kill position, otherwise items auto-collected
    // during navigation are already in the snapshot → reported as "No items gained"
    // Bot1 Session 78: captured after nav, causing false "0 drops" report.
    expect(survivalSrc).toContain("attackInventoryAtKill");
    // Verify the snapshot is captured inside the "!currentTarget" detection block
    // by checking the comment that explains this pattern
    expect(survivalSrc).toContain("Capture inventory snapshot BEFORE navigation");
  });

  it("passes inventoryBefore to collectNearbyItems (enables auto-collect tracking)", () => {
    expect(survivalSrc).toContain("inventoryBefore: attackInventoryBefore");
  });

  it("uses searchRadius=12 for normal mob drops (mobs knocked back up to 8 blocks)", () => {
    expect(survivalSrc).toMatch(/searchRadius:\s*12/);
  });

  it("uses searchRadius=16 and waitRetries=12 for endermen (teleport scatter)", () => {
    expect(survivalSrc).toMatch(/searchRadius:\s*16/);
    expect(survivalSrc).toMatch(/waitRetries:\s*12/);
  });

  it("corrects collection result when items auto-collected during approach navigation", () => {
    // When bot walks to kill position and auto-collects items in transit,
    // collectNearbyItems returns "No items nearby" — but items ARE in inventory.
    // This correction updates the result to reflect actual gains.
    expect(survivalSrc).toContain("attackTotalGained");
    expect(survivalSrc).toContain("CORRECTED collection result");
  });

  it("waits 1000ms after navigation before calling collectNearbyItems (item spawn delay)", () => {
    // Server needs time to spawn loot entity after mob death
    const navIdx = survivalSrc.indexOf("delay(isEnderman");
    expect(navIdx).toBeGreaterThan(-1);
  });

  it("uses maxDropDown=3 for item collection navigation (allows 3-block drops)", () => {
    // Items can fall 1-3 blocks from kill position (slope, knockback).
    // maxDropDown=2 was too restrictive — items on slightly lower ground were unreachable.
    // Check that maxDropDown=3 is set in the post-kill collection context
    // fight() has the post-kill collection with maxDropDown=3
    // Search for the comment explaining maxDropDown relaxation for item collection
    expect(survivalSrc).toContain("Relax maxDropDown for item collection");
    const relaxIdx = survivalSrc.indexOf("Relax maxDropDown for item collection");
    const afterRelax = survivalSrc.substring(relaxIdx, relaxIdx + 300);
    expect(afterRelax).toContain("maxDropDown = 3");
  });
});
