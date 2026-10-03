const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const makeResourceController = require('../controllers/resourceController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = function resourceRoutes(node) {
  const router = express.Router();
  const ctrl = makeResourceController(node);

  router.post('/upload', requireAuth, upload.single('file'), ctrl.upload);
  router.get('/room/:roomId', requireAuth, ctrl.roomResources);
  router.get('/find/:fileName', requireAuth, ctrl.findByName);

  return router;
};
