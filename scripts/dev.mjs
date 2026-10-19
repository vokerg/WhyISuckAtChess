import concurrently from 'concurrently';
import config from './dev-config.cjs';

const commands = [
  { name: 'api', command: 'npm run dev:prepared --workspace=apps/api' },
  { name: 'web', command: `npm exec --workspace=apps/web -- ng serve --port ${config.webPort}` },
];
if (process.argv.includes('--worker')) {
  commands.push({ name: 'worker', command: 'npm run dev:worker:prepared --workspace=apps/api' });
}

console.info(`Web: http://localhost:${config.webPort} | API: http://localhost:${config.apiPort}`);
try {
  await concurrently(commands, { killOthers: ['success', 'failure'] }).result;
} catch {
  process.exitCode = 1;
}
