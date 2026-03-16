/**
 * Check situation and ask admin for help
 * Also try to navigate to iron ore via a different path
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const inv = bot.inventory.items();
  console.log('Gravel:', inv.find(i => i.name === 'gravel')?.count || 0);
  console.log('Flint:', inv.find(i => i.name === 'flint')?.count || 0);
  console.log('Iron ingot:', inv.find(i => i.name === 'iron_ingot')?.count || 0);
  console.log('Raw iron:', inv.find(i => i.name === 'raw_iron')?.count || 0);

  // Send chat messages explaining situation
  bot.chat('[報告] Phase 5 進行中: エンチャント台設置に向け flint_and_steel が必要。');
  await sleep(1000);
  bot.chat('[報告] gravel x30+ 採掘したが flint ドロップ 0。iron ore に到達できない。');
  await sleep(1000);
  bot.chat('[質問] 管理者: iron_ingot x1 または flint x1 をご提供いただけますか？Portal起動のため。');
  await sleep(1000);

  // Count gravel blocks available
  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  const gravelBlocks = bot.findBlocks({
    matching: bot.registry.blocksByName['gravel']?.id,
    maxDistance: 100,
    count: 100
  });
  console.log('\nGravel blocks within 100:', gravelBlocks.length);

  // What types of blocks are nearby (looking for iron ore in exposed cliff faces)
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 100, count: 10 });
    if (found.length > 0) {
      console.log(oreName + ' within 100:', found.length);
      found.forEach(p => console.log(` (${p.x},${p.y},${p.z})`));
    }
  }

  // Check if there's a mineshaft or dungeon chest with iron ingots
  for (const name of ['chest', 'barrel']) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 100, count: 20 });
    if (found.length > 0) {
      console.log(name + ' within 100:', found.length);
      found.slice(0, 5).forEach(p => console.log(` (${p.x},${p.y},${p.z})`));
    }
  }

  // Check what blocks are at y=63 around x=-46 (where we saw iron ore earlier)
  console.log('\nBlocks at (-46, 63, -7) area:');
  for (let x = -48; x <= -44; x++) {
    for (let y = 61; y <= 65; y++) {
      const block = bot.world.getBlock({ x, y, z: -7 });
      if (block && block.name !== 'air') {
        console.log(` (${x},${y},-7): ${block.name}`);
      }
    }
  }

  bot.end();
});

bot.on('message', (msg) => {
  const text = msg.toString();
  if (!text.includes('<Claude1>')) {
    console.log('Chat:', text);
  }
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
