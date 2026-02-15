const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function callTool(client, name, args = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return result.content[0].text;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function connectWithRetry(client, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Connection attempt ${i+1}/${maxAttempts}...`);
    const result = await callTool(client, 'minecraft_connect', { host: 'localhost', port: 25565 });
    if (result.includes('Successfully connected') || result.includes('Already connected')) {
      console.log('Connected!');
      return true;
    }
    console.log(result);
    await sleep(result.includes('server_full') ? 15000 : 5000);
  }
  return false;
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, BOT_USERNAME: 'Claude6' }
  });
  const client = new Client({ name: 'claude6-player', version: '1.0.0' });
  await client.connect(transport);

  if (!await connectWithRetry(client)) {
    console.log('Failed to connect');
    await client.close();
    return;
  }
  await sleep(4000);

  // === Get current state ===
  console.log('=== STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log('=== POSITION ===');
  const pos = await callTool(client, 'minecraft_get_position');
  console.log(pos);
  console.log('=== SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // === Move to birch log ===
  console.log('\n=== Moving to birch tree (11, 109, 19) ===');
  console.log(await callTool(client, 'minecraft_move_to', { x: 11, y: 109, z: 19 }));
  await sleep(1000);

  // === Dig birch log at known coordinates - dig from bottom up ===
  console.log('\n=== Digging birch logs ===');
  // The tree is at (11, 109, 19), logs should extend upward
  for (let y = 109; y <= 114; y++) {
    const result = await callTool(client, 'minecraft_dig_block', { x: 11, y: y, z: 19 });
    console.log(`Dig (11, ${y}, 19): ${result}`);
    await sleep(500);
  }

  // Collect items
  await sleep(1000);
  console.log('=== Collecting items ===');
  console.log(await callTool(client, 'minecraft_collect_items'));
  await sleep(1000);

  // Check inventory
  console.log('=== INVENTORY ===');
  const inv = await callTool(client, 'minecraft_get_inventory');
  console.log(inv);

  // Look for more trees nearby
  console.log('=== SURROUNDINGS (after digging) ===');
  const surr = await callTool(client, 'minecraft_get_surroundings');
  console.log(surr);

  // Try to find more birch logs from surroundings data
  // Parse the nearest birch log position from surroundings and dig those too
  if (surr.includes('birch_log')) {
    console.log('\n=== More trees nearby - digging ===');
    // Look for more birch logs
    const logMatch = surr.match(/birch_log:.*?最寄り.*?\((-?\d+), (\d+), (-?\d+)\)/);
    if (logMatch) {
      const lx = parseInt(logMatch[1]);
      const ly = parseInt(logMatch[2]);
      const lz = parseInt(logMatch[3]);
      console.log(`Found more logs at (${lx}, ${ly}, ${lz})`);

      // Move to tree
      console.log(await callTool(client, 'minecraft_move_to', { x: lx, y: ly, z: lz }));
      await sleep(1000);

      // Dig upward
      for (let y = ly; y <= ly + 5; y++) {
        const result = await callTool(client, 'minecraft_dig_block', { x: lx, y: y, z: lz });
        if (result.includes('Dug') || result.includes('dug') || result.includes('Mined')) {
          console.log(`Dig (${lx}, ${y}, ${lz}): ${result}`);
        }
        await sleep(300);
      }
      await sleep(500);
      console.log(await callTool(client, 'minecraft_collect_items'));
    }
  }

  // === Crafting phase ===
  console.log('\n=== INVENTORY before crafting ===');
  const inv2 = await callTool(client, 'minecraft_get_inventory');
  console.log(inv2);

  if (inv2.includes('birch_log') || inv2.includes('oak_log') || inv2.includes('log')) {
    console.log('\n=== CRAFTING PHASE ===');

    // Try craft chain for a wooden pickaxe
    console.log('--- Craft chain: wooden_pickaxe ---');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_pickaxe', count: 1 }));
    await sleep(500);

    console.log('--- Craft chain: wooden_sword ---');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_sword', count: 1 }));
    await sleep(500);

    console.log('--- Craft chain: wooden_axe ---');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_axe', count: 1 }));
    await sleep(500);

    console.log('--- Craft chain: crafting_table ---');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'crafting_table', count: 1 }));
    await sleep(500);

    console.log('=== INVENTORY after crafting ===');
    console.log(await callTool(client, 'minecraft_get_inventory'));

    // Equip weapon
    console.log('=== Equipping weapon ===');
    console.log(await callTool(client, 'minecraft_equip_weapon'));
  }

  // === Mining stone ===
  console.log('\n=== STONE MINING ===');
  // Dig down to find stone
  const curPos = JSON.parse(await callTool(client, 'minecraft_get_position'));
  const px = Math.floor(curPos.x);
  const py = Math.floor(curPos.y);
  const pz = Math.floor(curPos.z);

  // Dig down a few blocks to find stone
  for (let y = py - 1; y >= py - 5; y--) {
    const result = await callTool(client, 'minecraft_dig_block', { x: px, y: y, z: pz });
    console.log(`Dig (${px}, ${y}, ${pz}): ${result}`);
    await sleep(500);
  }
  console.log(await callTool(client, 'minecraft_collect_items'));
  await sleep(500);

  // Check for cobblestone and upgrade tools
  const inv3 = await callTool(client, 'minecraft_get_inventory');
  console.log('=== INVENTORY ===');
  console.log(inv3);

  if (inv3.includes('cobblestone')) {
    console.log('=== Upgrading to stone tools ===');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'stone_pickaxe', count: 1 }));
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'stone_sword', count: 1 }));
    console.log(await callTool(client, 'minecraft_equip_weapon'));
  }

  // === Chat and share ===
  console.log('\n=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  const finalPos = await callTool(client, 'minecraft_get_position');
  const finalInv = await callTool(client, 'minecraft_get_inventory');
  console.log(await callTool(client, 'minecraft_chat', {
    message: `Claude6: 木材採取・ツール作成完了。位置: ${finalPos}`
  }));

  // === Final Status ===
  console.log('\n=== FINAL ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL:', e.message));
