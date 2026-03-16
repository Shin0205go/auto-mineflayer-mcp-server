/**
 * Simple movement test to diagnose pathfinder issues
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  const startPos = bot.entity.position.clone();
  console.log('Start pos:', startPos, 'HP:', bot.health, 'Food:', bot.food);

  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = true;
  movements.maxDropDown = 3;
  bot.pathfinder.setMovements(movements);

  // Try moving just 20 blocks north (in -z direction)
  const targetX = startPos.x - 20;
  const targetZ = startPos.z - 20;
  console.log('Trying to move to (' + targetX.toFixed(1) + ', ?, ' + targetZ.toFixed(1) + ')...');

  bot.pathfinder.setGoal(new GoalXZ(targetX, targetZ));

  // Listen for events
  bot.on('path_update', (results) => {
    if (results.status === 'noPath') {
      console.log('PATH: No path found!');
    } else if (results.status === 'pathFound') {
      console.log('PATH: Path found, length:', results.path.length);
    } else {
      console.log('PATH event:', results.status);
    }
  });

  bot.once('goal_reached', () => {
    console.log('Goal reached!');
  });

  await sleep(15000);
  bot.pathfinder.setGoal(null);

  const endPos = bot.entity.position;
  console.log('End pos:', endPos, 'HP:', bot.health);
  const moved = endPos.distanceTo(startPos);
  console.log('Distance moved:', moved.toFixed(1));

  if (moved < 1) {
    console.log('ERROR: Bot did not move at all! Pathfinder issue or bot stuck.');

    // Check what blocks are around
    const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const blockNorth = bot.blockAt(bot.entity.position.offset(0, 0, -1));
    console.log('Block below:', blockBelow ? blockBelow.name : 'null');
    console.log('Block north:', blockNorth ? blockNorth.name : 'null');
    console.log('Is bot in a solid block?', bot.entity.isInWater, bot.entity.isInLava);
  }

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
