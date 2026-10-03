const { v4: uuidv4 } = require('uuid');
const { Message } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const membershipCache = require('./membershipCache');

module.exports = function chatService(node) {
  async function assertReadAllowed(roomId, user) {
    if (user.role !== 'student') return;
    const admitted = await membershipCache.isAdmitted(roomId, user.userId);
    if (!admitted) throw new HttpError(403, 'Not an admitted member of this classroom');
  }

  async function getRoomHistory(roomId, user) {
    await assertReadAllowed(roomId, user);
    return node.chatHistory.get(roomId) || [];
  }

  // Called from the Socket.IO handler (socketManager.js) rather than an HTTP
  // controller — chat is a streaming/real-time feature, not request/response
  // — but the persistence + gating rules live here either way, same as every
  // other service.
  async function assertSendAllowed(roomId, userId, role) {
    if (role !== 'student') return;
    const [classroom, admitted] = await Promise.all([
      membershipCache.getClassroom(roomId),
      membershipCache.isAdmitted(roomId, userId)
    ]);
    if (!admitted) throw new Error('You are not an admitted member of this classroom');
    if (classroom && classroom.settings.groupChatEnabled === false) {
      throw new Error('Group chat is disabled by the teacher');
    }
  }

  function buildEnvelope(roomId, senderName, senderUserId, message) {
    return {
      messageId: uuidv4(),
      type: 'CHAT_MESSAGE',
      senderNode: node.nodeId,
      senderUser: senderName,
      senderUserId,
      roomId,
      timestamp: Date.now(),
      payload: message
    };
  }

  function recordAndBroadcast(envelope) {
    node.outbox.enqueue(async () => {
      await new Message({
        messageId: envelope.messageId,
        roomId: envelope.roomId,
        senderUserId: envelope.senderUserId,
        senderName: envelope.senderUser,
        senderNodeId: envelope.senderNode,
        type: envelope.type,
        content: envelope.payload.text
      }).save();
    }, `chat message ${envelope.messageId}`);

    if (!node.chatHistory.has(envelope.roomId)) node.chatHistory.set(envelope.roomId, []);
    node.chatHistory.get(envelope.roomId).push(envelope);

    node.messageBus.publish('CHAT_MESSAGE', envelope);
  }

  return { getRoomHistory, assertSendAllowed, buildEnvelope, recordAndBroadcast };
};
