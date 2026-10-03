const express = require('express');
const { requireAuth } = require('../middleware/auth');
const makeChatController = require('../controllers/chatController');

module.exports = function chatRoutes(node) {
  const router = express.Router();
  const ctrl = makeChatController(node);

  router.get('/room/:roomId', requireAuth, ctrl.roomHistory);

  return router;
};
