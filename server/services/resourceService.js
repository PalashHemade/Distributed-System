const { v4: uuidv4 } = require('uuid');
const { Resource } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const s3 = require('../config/s3');
const membershipCache = require('./membershipCache');

// Factory: resource state (the in-memory resourceHistory cache, the outbox,
// peers, and the other distributed-comm components) all belong to one
// specific node process, so this service is built per-node just like
// classroomService.
module.exports = function resourceService(node) {
  async function assertUploadAllowed(roomId, user) {
    if (user.role !== 'student') return;
    const [classroom, admitted] = await Promise.all([
      membershipCache.getClassroom(roomId),
      membershipCache.isAdmitted(roomId, user.userId)
    ]);
    if (!admitted) throw new HttpError(403, 'Not an admitted member of this classroom');
    if (classroom && classroom.settings.fileSharingEnabled === false) {
      throw new HttpError(403, 'File sharing is disabled by the teacher');
    }
  }

  async function assertReadAllowed(roomId, user) {
    if (user.role !== 'student') return;
    const admitted = await membershipCache.isAdmitted(roomId, user.userId);
    if (!admitted) throw new HttpError(403, 'Not an admitted member of this classroom');
  }

  async function uploadResource(file, roomId, user) {
    if (!file || !roomId) throw new HttpError(400, 'file and roomId are required');
    await assertUploadAllowed(roomId, user);

    const resourceId = uuidv4();
    const fileName = `${Date.now()}-${file.originalname}`;
    const s3Key = `classrooms/${roomId}/${resourceId}-${file.originalname}`;

    await s3.uploadBuffer(s3Key, file.buffer, file.mimetype);
    console.log(`[FILE] Resource uploaded to S3 by ${node.nodeId}: ${s3Key}`);
    node.resources++;

    const resourceData = {
      resourceId,
      fileName,
      originalName: file.originalname,
      fileType: file.mimetype,
      size: file.size,
      roomId,
      uploaderId: user.userId,
      ownerNodeId: node.nodeId,
      s3Bucket: s3.BUCKET,
      s3Key,
      createdAt: Date.now()
    };

    node.outbox.enqueue(async () => {
      await new Resource(resourceData).save();
    }, `resource ${resourceId}`);

    if (!node.resourceHistory.has(roomId)) node.resourceHistory.set(roomId, []);
    node.resourceHistory.get(roomId).push(resourceData);

    // P2P notification (metadata only — see peerManager.js) + bus broadcast for the UI.
    for (const peer of node.peers) {
      node.peerManager.sendToPeer(peer.nodeId, { type: 'RESOURCE_SHARED', payload: resourceData }).catch(() => {});
    }
    node.messageBus.publish('RESOURCE_SHARED', resourceData);
    node.socketManager.io.to(`classroom:${roomId}`).emit('resource_shared', resourceData);

    return resourceData;
  }

  async function listRoomResources(roomId, user) {
    await assertReadAllowed(roomId, user);
    if (node.resourceHistory.has(roomId)) return node.resourceHistory.get(roomId);
    return Resource.find({ roomId }).lean();
  }

  async function findResourceByFileName(fileName) {
    for (const list of node.resourceHistory.values()) {
      const match = list.find(r => r.fileName === fileName);
      if (match) return match;
    }
    return Resource.findOne({ fileName }).lean();
  }

  // Resolves via local cache / Mongo first, then RPC to peers — this is
  // exactly the "ask a remote node to look something up for you" demo the
  // RPC layer exists to show; it's just resolving through Mongo+S3 now
  // instead of a local disk check.
  async function resolveDownload(fileName, roomId, user) {
    if (roomId) await assertReadAllowed(roomId, user);

    const local = await findResourceByFileName(fileName);
    if (local) {
      const url = await s3.getPresignedDownloadUrl(local.s3Key);
      return { found: true, url, primaryNode: local.ownerNodeId };
    }

    console.log(`[RPC] Node ${node.nodeId} searching for ${fileName} on peers`);
    for (const peer of node.peers) {
      try {
        const result = await node.rpcClient.call(peer.nodeId, 'findResource', { fileName });
        if (result && result.found) {
          console.log(`[RPC] Resource found on ${peer.nodeId}`);
          const getResult = await node.rpcClient.call(peer.nodeId, 'getResource', { fileName });
          return { found: true, url: getResult.url, primaryNode: getResult.primaryNode };
        }
      } catch (err) {
        console.warn(`[RPC WARN] Peer ${peer.nodeId} search failed: ${err.message}`);
      }
    }

    throw new HttpError(404, 'Resource not found on any node');
  }

  // RPC method implementations (registered against RpcServer in BaseNode.js).
  async function rpcFindResource({ fileName }) {
    const resource = await findResourceByFileName(fileName);
    return { found: !!resource, nodeId: node.nodeId };
  }

  async function rpcGetResource({ fileName }) {
    const resource = await findResourceByFileName(fileName);
    if (!resource) return { url: null };
    const url = await s3.getPresignedDownloadUrl(resource.s3Key);
    return { url, version: 1, primaryNode: resource.ownerNodeId };
  }

  return { uploadResource, listRoomResources, findResourceByFileName, resolveDownload, rpcFindResource, rpcGetResource };
};
