/**
 * Phase validator tests
 * Verifies that the generic harness blocks out-of-scope actions per phase.
 */
import { describe, it, expect } from "vitest";
import { validate, getStep } from "../src/harness/validator.js";
import { minecraftPlan } from "../src/harness/minecraft-phases.js";

describe("getStep", () => {
  it("returns the correct step by id", () => {
    const step = getStep(minecraftPlan, 1);
    expect(step).not.toBeNull();
    expect(step!.name).toBe("Base establishment");
  });

  it("returns null for unknown step id", () => {
    expect(getStep(minecraftPlan, 99)).toBeNull();
  });
});

describe("validate — Phase 1 (Base establishment)", () => {
  const step = getStep(minecraftPlan, 1)!;

  it("allows gathering wood", () => {
    const code = `const block = bot.findBlock({ matching: bot.registry.blocksByName['oak_log'].id });
await bot.dig(block);`;
    expect(validate(code, step).allowed).toBe(true);
  });

  it("allows crafting basic items", () => {
    const code = `const recipes = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, null);
await bot.craft(recipes[0], 1, null);`;
    expect(validate(code, step).allowed).toBe(true);
  });

  it("blocks searching for end_portal", () => {
    const code = `bot.findBlock({ matching: bot.registry.blocksByName['end_portal'].id, maxDistance: 128 });`;
    const r = validate(code, step);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("end_portal");
  });

  it("blocks stronghold search", () => {
    const code = `// find the stronghold and go there`;
    expect(validate(code, step).allowed).toBe(false);
  });

  it("blocks nether portal construction", () => {
    const code = `// build nether_portal from obsidian`;
    expect(validate(code, step).allowed).toBe(false);
  });

  it("blocks blaze activities", () => {
    const code = `const blazeSpawner = bot.findBlock({ matching: bot.registry.blocksByName['blaze'].id });`;
    expect(validate(code, step).allowed).toBe(false);
  });

  it("blocks enchanting_table placement", () => {
    const code = `await bot.place(enchanting_table_item, refBlock, faceVector);`;
    expect(validate(code, step).allowed).toBe(false);
  });

  it("is case-insensitive", () => {
    const code = `// Go find STRONGHOLD entrance`;
    expect(validate(code, step).allowed).toBe(false);
  });
});

describe("validate — Phase 6 (Nether expedition)", () => {
  const step = getStep(minecraftPlan, 6)!;

  it("allows nether portal use", () => {
    const code = `// enter nether_portal to reach the nether`;
    expect(validate(code, step).allowed).toBe(true);
  });

  it("allows blaze hunting", () => {
    const code = `const blaze = bot.nearestEntity(e => e.name === 'blaze'); await bot.attack(blaze);`;
    expect(validate(code, step).allowed).toBe(true);
  });

  it("still blocks end_portal search", () => {
    const code = `bot.findBlock({ matching: 'end_portal_frame' })`;
    expect(validate(code, step).allowed).toBe(false);
  });

  it("still blocks stronghold search", () => {
    const code = `// navigate toward stronghold`;
    expect(validate(code, step).allowed).toBe(false);
  });
});

describe("validate — Phase 8 (Ender Dragon)", () => {
  const step = getStep(minecraftPlan, 8)!;

  it("allows everything (no forbidden patterns)", () => {
    const code = `// fly to end_portal, kill ender_dragon, find stronghold`;
    expect(validate(code, step).allowed).toBe(true);
  });
});
