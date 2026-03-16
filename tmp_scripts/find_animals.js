const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map(c => c.text).join('');
  return text;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const transport = new StdioClientTransport({
    command: '/opt/homebrew/opt/node@20/bin/node',
    args: ['dist/index.js'],
    env: { MC_HOST: 'localhost', MC_PORT: '25565' }
  });

  const client = new Client({ name: 'bot1', version: '1.0.0' });
  await client.connect(transport);

  const conn = await callTool(client, 'mc_connect', {
    host: 'localhost', port: 25565, username: 'Claude1', agentType: 'game'
  });
  await sleep(2000);

  // Check current status
  let status = JSON.parse(await callTool(client, 'mc_status', {}));
  console.log('HP:', status.health, 'Hunger:', status.hunger);
  console.log('Pos:', JSON.stringify(status.position));
  console.log('Time:', status.time.ticks, '(', status.time.phase, ')');
  console.log('Threats:', status.threats);

  // Move to different area to find animals
  console.log('Moving toward base area while searching for animals...');
  const nav1 = await callTool(client, 'mc_navigate', {
    x: 20, y: 95, z: -80
  });
  console.log('Nav1:', nav1.substring(0, 200));

  await sleep(1000);

  // Check for animals
  const animals = ['sheep', 'cow', 'pig', 'chicken'];
  for (const animal of animals) {
    const r = await callTool(client, 'mc_navigate', { target_entity: animal, max_distance: 32 });
    if (r.indexOf('No ' + animal) === -1) {
      console.log('Found ' + animal + '!', r.substring(0, 100));
      break;
    }
    console.log(animal + ': not found within 32');
  }

  status = JSON.parse(await callTool(client, 'mc_status', {}));
  console.log('After move HP:', status.health, 'Hunger:', status.hunger, 'Pos:', JSON.stringify(status.position));

  await client.close();
}

main().catch(e => console.error('Error:', e.message));
