const { apiPort } = require('../../scripts/dev-config.cjs');

module.exports = {
  '/api': {
    target: `http://127.0.0.1:${apiPort}`,
    secure: false,
    changeOrigin: true,
  },
};
