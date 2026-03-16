/**
 * Search for mineshaft/dungeon chests underground
 * Looking for: book, leather, saddle, iron, gold
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ, GoalBlock, GoalY } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 3;
  bot.pathfinder.setMovements(mov);

  // Search for dungeon/mineshaft chests within loaded chunks
  function findChests(radius) {
    const chestId = bot.registry.blocksByName['chest']?.id;
    if (!chestId) return [];
    return bot.findBlocks({ matching: chestId, maxDistance: radius, count: 20 });
  }

  // Search for air gaps underground (indicates cave/tunnel)
  function findAirUnderground(radius) {
    const airId = 0; // air block id
    const pos = bot.entity.position;
    const underground = [];
    for (let x = -radius; x <= radius; x += 8) {
      for (let z = -radius; z <= radius; z += 8) {
        for (let y = 30; y <= 60; y += 4) {
          const block = bot.blockAt({ x: Math.floor(pos.x + x), y: y, z: Math.floor(pos.z + z) });
          if (block && block.name === 'air') {
            underground.push({ x: pos.x + x, y, z: pos.z + z });
          }
        }
      }
    }
    return underground;
  }

  // First check for any chest structure (dungeon, mineshaft)
  const chests = findChests(64);
  console.log('Chests found within 64 blocks:', chests.length);
  chests.slice(0, 3).forEach(c => console.log(' Chest at:', c));

  // Also search for ladder blocks (mineshaft indicator)
  function findStructure(blockName, radius) {
    const id = bot.registry.blocksByName[blockName]?.id;
    if (!id) return [];
    return bot.findBlocks({ matching: id, maxDistance: radius, count: 5 });
  }

  const ladders = findStructure('ladder', 64);
  const rail = findStructure('rail', 64);
  const cobweb = findStructure('cobweb', 64);
  console.log('Ladders:', ladders.length, 'Rails:', rail.length, 'Cobwebs:', cobweb.length);

  if (rail.length > 0) {
    console.log('MINESHAFT FOUND! Rail at:', rail[0]);
  }
  if (cobweb.length > 0) {
    console.log('POTENTIAL MINESHAFT! Cobweb at:', cobweb[0]);
  }

  // Look for surface-accessible cave entrances
  // Try to go underground to y=30-40 range where mineshafts spawn
  console.log('Going underground to search for structures...');

  // Navigate to an area and go down
  const targetY = 40;
  bot.pathfinder.setGoal(new GoalY(targetY));
  await sleep(20000);
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('Underground pos:', pos, 'HP:', bot.health);

  // Search again at deeper level
  const deepChests = findChests(48);
  console.log('Chests at depth:', deepChests.length);
  deepChests.slice(0, 3).forEach(c => console.log(' Deep chest at:', c));

  const deepRails = findStructure('rail', 48);
  const deepCobweb = findStructure('cobweb', 48);
  console.log('Rails at depth:', deepRails.length, 'Cobwebs:', deepCobweb.length);

  if (deepRails.length > 0) {
    console.log('MINESHAFT at depth! Rail at:', deepRails[0]);
    // Navigate to mineshaft
    const r = deepRails[0];
    bot.pathfinder.setGoal(new GoalNear(r.x, r.y, r.z, 3));
    await sleep(15000);
    bot.pathfinder.setGoal(null);
    console.log('Near mineshaft:', bot.entity.position);

    // Look for chests in mineshaft
    const msChests = findChests(16);
    console.log('Mineshaft chests nearby:', msChests.length);
  }

  console.log('Final pos:', bot.entity.position);
  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => console.log('BOT DIED!'));
