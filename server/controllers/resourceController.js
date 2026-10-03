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

  return { upload, roomResources, findByName };
};
