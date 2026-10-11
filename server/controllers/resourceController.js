const { asyncHandler } = require('../middleware/errorHandler');
const makeResourceService = require('../services/resourceService');

module.exports = function resourceController(node) {
  const resourceService = makeResourceService(node);

  const upload = asyncHandler(async (req, res) => {
    const resource = await resourceService.uploadResource(req.file, req.body.roomId, req.user);
    res.status(200).json({ success: true, resource });
  });

  const roomResources = asyncHandler(async (req, res) => {
    const resources = await resourceService.listRoomResources(req.params.roomId, req.user);
    res.status(200).json(resources);
  });

  const findByName = asyncHandler(async (req, res) => {
    const result = await resourceService.resolveDownload(req.params.fileName, req.query.roomId, req.user);
    res.status(200).json(result);
  });

  const pendingRequests = asyncHandler(async (req, res) => {
    const pending = await resourceService.getPendingShareRequests(req.params.id, req.user.userId);
    res.status(200).json(pending);
  });

  const decideShare = asyncHandler(async (req, res) => {
    const resource = await resourceService.decideShareRequest(req.params.id, req.params.resourceId, req.user.userId, req.body.decision);
    res.status(200).json(resource);
  });

  return { upload, roomResources, findByName, pendingRequests, decideShare };
};
