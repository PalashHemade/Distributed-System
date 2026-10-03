const express = require('express');
const authController = require('../../controllers/authController');
const { requireAuth } = require('../../middleware/auth');

// Auth is generic (not Gateway-specific business logic — see
// server/services/authService.js and server/controllers/authController.js),
// but the Gateway is the only process that mounts it: it's the one
// asymmetric process in the topology and the first thing every client talks
// to (via /health) before picking a node, so it's the natural place to
// centralize account creation/login rather than tripling this across
// nodeA/B/C. The httpOnly cookie it sets is readable by every node too,
// since cookies are scoped by hostname, not port.
module.exports = function authRoutes() {
  const router = express.Router();
  router.post('/api/auth/register', authController.register);
  router.post('/api/auth/login', authController.login);
  router.post('/api/auth/logout', authController.logout);
  router.get('/api/auth/me', requireAuth, authController.me);
  return router;
};
