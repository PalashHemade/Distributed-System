const express = require('express');
const makeMonitorController = require('../controllers/monitorController');

module.exports = function monitorRoutes(monitorService) {
  const router = express.Router();
  const ctrl = makeMonitorController(monitorService);

  router.post('/api/monitor/message', ctrl.postMessage);
  router.get('/api/monitor/events', ctrl.getEvents);

  return router;
};
