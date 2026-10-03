const express = require('express');
const makeNodeOpsController = require('../controllers/nodeOpsController');

module.exports = function nodeOpsRoutes(node, peerDiscovery) {
  const router = express.Router();
  const ctrl = makeNodeOpsController(node, peerDiscovery);

  router.get('/health', ctrl.health);
  router.post('/api/peers', ctrl.updatePeers);
  router.post('/api/rpc', ctrl.rpc);
  router.post('/api/messaging/receive', ctrl.messagingReceive);
  router.post('/api/p2p/receive', ctrl.p2pReceive);
  router.post('/api/p2p/gossip', ctrl.gossip);

  return router;
};
