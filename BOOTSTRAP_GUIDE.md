# Bootstrap Guide for Mineflayer MCP Bots

## Quick Start

The bootstrap tools generate `/give` commands that an admin can paste into the Minecraft server console to initialize bot inventories with food and tools.

### Step 1: Generate Bootstrap Script

**Tool**: `minecraft_generate_bootstrap_script`

Call this tool with no arguments (uses all connected bots):

```json
{
  "tool": "minecraft_generate_bootstrap_script",
  "arguments": {}
}
```

**Output**: A script with `/give` commands like:
```bash
# Bootstrap for Claude1
/give Claude1 bread 30
/give Claude1 cooked_beef 20
/give Claude1 crafting_table 1
/give Claude1 furnace 1
/give Claude1 cobblestone 64
/give Claude1 wooden_pickaxe 1

# Bootstrap for Claude2
/give Claude2 bread 30
/give Claude2 cooked_beef 20
...
```

### Step 2: Admin Pastes Commands

**WHERE**: Minecraft server console (NOT in-game chat!)
- For vanilla servers: Use RCON, tmux session, or server terminal
- Each line is ONE command

**IMPORTANT**:
- ✅ DO: Each `/give` on separate line
- ❌ DON'T: Combine items into one `/give` (causes "Unknown command" error)

### Step 3: Verify Bootstrap

**Tool**: `minecraft_check_bootstrap`

After admin executes commands:

```json
{
  "tool": "minecraft_check_bootstrap",
  "arguments": {
    "username": "Claude1"
  }
}
```

**Expected Output**:
```
✅ BOOTSTRAP COMPLETE
Claude1 Inventory:
  Food: 50 items
  Tools: crafting_table 1, furnace 1
  Blocks: cobblestone 64
```

### Step 4: List All Bots Status

**Tool**: `minecraft_list_bootstrap_needs`

Check status of all connected bots:

```json
{
  "tool": "minecraft_list_bootstrap_needs",
  "arguments": {}
}
```

Shows which bots are ready and which still need items.

---

## What Gets Bootstrapped

Each bot receives:
- **Food**: 30x bread + 20x cooked_beef (50 total food items)
- **Tools**: 1x crafting_table, 1x furnace, 1x wooden_pickaxe
- **Blocks**: 64x cobblestone (for building)

## Common Issues

### ❌ "Unknown or incomplete command"
- Make sure you're pasting into **server console**, not in-game chat
- Each `/give` must be on its own line
- Use the script from `minecraft_generate_bootstrap_script` (already formatted correctly)

### ❌ Players still don't have items after `/give`
- Check server has `keepInventory` setting correct
- Or manually place items in accessible chests
- Verify admin has OP permissions

### ❌ Can't find server console
- **Vanilla server**: Check your server startup terminal or RCON interface
- **Docker/Hosted**: Access through container CLI or admin panel
- **Paper/Spigot**: Usually in the same terminal where server started

---

## Once Bootstrap Is Complete

✅ All bots have starting equipment
✅ Ready to begin Phase 1 (Base establishment)
✅ Run `/team-coordination` skill for multi-bot coordination

See CLAUDE.md for Phase progression details.
