const express = require('express');
const makeRegistryController = require('../controllers/registryController');

module.exports = function registryRoutes(registryService) {
  const router = express.Router();
  const ctrl = makeRegistryController(registryService);

  router.get('/health', ctrl.health);
  router.post('/api/registry/register', ctrl.register);
  router.post('/api/registry/heartbeat', ctrl.heartbeat);

  return router;
};
