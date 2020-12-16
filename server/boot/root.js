'use strict';

module.exports = function(server) {
  // Install a `/status` route that returns server status
  const router = server.loopback.Router();
  router.get('/status', server.loopback.status());
  server.use(router);
};
