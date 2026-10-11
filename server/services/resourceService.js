const { v4: uuidv4 } = require('uuid');
const { Resource } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const s3 = require('../config/s3');
const membershipCache = require('./membershipCache');

// Inserts or updates a resource in a node's local per-room cache by
// resourceId — shared between the initial upload path and anywhere a
// resource's status changes later (approval/rejection), so a re-broadcast
// updates the existing entry instead of appending a stale duplicate.
function upsertResourceHistory(node, roomId, resourceData) {
  const list = node.resourceHistory.get(roomId) || [];
  const idx = list.findIndex(r => r.resourceId === resourceData.resourceId);
  if (idx >= 0) list[idx] = resourceData; else list.push(resourceData);
  node.resourceHistory.set(roomId, list);
}

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

    // Teachers always publish immediately. A student's upload is held as a
    // share request — the bytes are already safely in S3, but nothing makes
    // it visible to the rest of the classroom until the teacher approves it.
    const status = user.role === 'teacher' ? 'APPROVED' : 'PENDING';

    const resourceData = {
      resourceId,
      fileName,
      originalName: file.originalname,
      fileType: file.mimetype,
      size: file.size,
      roomId,
      uploaderId: user.userId,
      uploaderName: user.name,
      ownerNodeId: node.nodeId,
      s3Bucket: s3.BUCKET,
      s3Key,
      status,
      createdAt: Date.now()
    };

    node.outbox.enqueue(async () => {
      await new Resource(resourceData).save();
    }, `resource ${resourceId}`);

    upsertResourceHistory(node, roomId, resourceData);

    if (status === 'APPROVED') {
      // P2P notification (metadata only — see peerManager.js) + bus broadcast for the UI.
      for (const peer of node.peers) {
        node.peerManager.sendToPeer(peer.nodeId, { type: 'RESOURCE_SHARED', payload: resourceData }).catch(() => {});
      }
      node.messageBus.publish('RESOURCE_SHARED', resourceData);
      node.socketManager.io.to(`classroom:${roomId}`).emit('resource_shared', resourceData);
    } else {
      // Broadcast is metadata-only and never touches resourceHistory on other
      // nodes — the teacher's "pending requests" view reads Mongo directly
      // (see getPendingShareRequests), so this is purely a real-time nudge,
      // not the source of truth. Mirrors how JOIN_REQUESTED works for admission.
      node.messageBus.publish('SHARE_REQUESTED', { roomId, resourceId, originalName: resourceData.originalName, uploaderId: user.userId, uploaderName: user.name });
      node.socketManager.io.to(`classroom:${roomId}`).emit('share_requested', { roomId, resourceId, originalName: resourceData.originalName, uploaderId: user.userId, uploaderName: user.name });
    }

    return resourceData;
  }

  async function listRoomResources(roomId, user) {
    await assertReadAllowed(roomId, user);
    const visible = (r) => !r.status || r.status === 'APPROVED' || r.uploaderId === user.userId;

    const local = (node.resourceHistory.get(roomId) || []).filter(visible);
    const dbRecords = await Resource.find({ roomId }).lean();

    const merged = new Map();
    for (const r of dbRecords.filter(visible)) merged.set(r.resourceId, r);
    for (const r of local) merged.set(r.resourceId, r); // local (freshest in-memory) wins on conflict

    return Array.from(merged.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function getPendingShareRequests(roomId, teacherId) {
    const isOwner = await membershipCache.isTeacherOwner(roomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');
    return Resource.find({ roomId, status: 'PENDING' }).sort({ createdAt: 1 }).lean();
  }

  async function decideShareRequest(roomId, resourceId, teacherId, decision) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HttpError(400, 'Invalid decision');
    const isOwner = await membershipCache.isTeacherOwner(roomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');

    const resource = await Resource.findOneAndUpdate(
      { resourceId, roomId, status: 'PENDING' },
      { status: decision, decidedAt: new Date(), decidedBy: teacherId },
      { new: true }
    ).lean();
    if (!resource) throw new HttpError(404, 'No pending request with that id');

    // This handler may be running on a different node than the one the
    // student originally uploaded through — update this node's own cache
    // directly (it won't receive its own broadcast) before publishing.
    upsertResourceHistory(node, roomId, resource);

    if (decision === 'APPROVED') {
      for (const peer of node.peers) {
        node.peerManager.sendToPeer(peer.nodeId, { type: 'RESOURCE_SHARED', payload: resource }).catch(() => {});
      }
      node.messageBus.publish('RESOURCE_SHARED', resource);
      node.socketManager.io.to(`classroom:${roomId}`).emit('resource_shared', resource);
      node.messageBus.publish('SHARE_APPROVED', { roomId, resourceId, originalName: resource.originalName, uploaderId: resource.uploaderId });
      node.socketManager.io.to(`classroom:${roomId}`).emit('share_approved', { roomId, resourceId, originalName: resource.originalName, uploaderId: resource.uploaderId });
    } else {
      s3.deleteObject(resource.s3Key).catch(() => {}); // best-effort cleanup, never blocks the decision
      node.messageBus.publish('SHARE_REJECTED', { roomId, resourceId, originalName: resource.originalName, uploaderId: resource.uploaderId });
      node.socketManager.io.to(`classroom:${roomId}`).emit('share_rejected', { roomId, resourceId, originalName: resource.originalName, uploaderId: resource.uploaderId });
    }

    return resource;
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
      const allowed = !local.status || local.status === 'APPROVED' || local.uploaderId === user.userId || user.role === 'teacher';
      if (!allowed) throw new HttpError(403, 'This file is awaiting teacher approval');
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
  // Unapproved files are deliberately invisible here too — RPC shouldn't be
  // a backdoor around teacher approval.
  async function rpcFindResource({ fileName }) {
    const resource = await findResourceByFileName(fileName);
    const found = !!resource && (!resource.status || resource.status === 'APPROVED');
    return { found, nodeId: node.nodeId };
  }

  async function rpcGetResource({ fileName }) {
    const resource = await findResourceByFileName(fileName);
    if (!resource || (resource.status && resource.status !== 'APPROVED')) return { url: null };
    const url = await s3.getPresignedDownloadUrl(resource.s3Key);
    return { url, version: 1, primaryNode: resource.ownerNodeId };
  }

  return {
    uploadResource, listRoomResources, getPendingShareRequests, decideShareRequest,
    findResourceByFileName, resolveDownload, rpcFindResource, rpcGetResource
  };
};

module.exports.upsertResourceHistory = upsertResourceHistory;
