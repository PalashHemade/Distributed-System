const { asyncHandler } = require('../../middleware/errorHandler');

module.exports = function registryController(registryService) {
  function health(req, res) {
    res.status(200).json({
      nodeId: 'gateway',
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
      nodes: registryService.getAll()
    });
  }

  const register = asyncHandler(async (req, res) => {
    const { nodeId, host, port } = req.body;
    registryService.register(nodeId, host, port);
    res.status(200).json({ success: true });
  });

  function heartbeat(req, res) {
    const { nodeId, users, resources } = req.body;
    registryService.heartbeat(nodeId, users, resources);
    res.status(200).json({ success: true });
  }

  return { health, register, heartbeat };
};
