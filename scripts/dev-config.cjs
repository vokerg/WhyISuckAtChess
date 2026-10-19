const path = require('node:path');
const { createRequire } = require('node:module');

// Match the API workspace's dotenv lookup, regardless of the launch directory.
const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
apiRequire('dotenv').config({ path: path.resolve(__dirname, '../apps/api/.env') });

const apiPort = Number(process.env.PORT || 3000);
const webUrl = new URL(process.env.WEB_APP_URL || 'http://localhost:4200');
const webPort = Number(webUrl.port || (webUrl.protocol === 'https:' ? 443 : 80));
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

module.exports = { apiPort, webPort };
