const { v4: uuidv4 } = require('uuid');
const { Conversation, PrivateMessage } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const membershipCache = require('./membershipCache');

module.exports = function privateChatService(node) {
  async function assertBothAdmitted(classroomId, userIdA, userIdB) {
    const classroom = await membershipCache.getClassroom(classroomId);
    if (!classroom) throw new Error('Classroom not found');
    if (classroom.settings.personalMessagingEnabled === false) {
      throw new Error('Personal messaging is disabled by the teacher');
    }
    const aOk = classroom.teacherId === userIdA || (await membershipCache.isAdmitted(classroomId, userIdA));
    const bOk = classroom.teacherId === userIdB || (await membershipCache.isAdmitted(classroomId, userIdB));
    if (!aOk || !bOk) throw new Error('Both participants must be admitted members of this classroom');
    return classroom;
  }

  // Used by the socket handler: validates, persists (via the outbox, durable
  // but non-blocking), and publishes the cross-node broadcast. Throws a plain
  // Error on a gating failure — the socket handler turns that into an
  // `error_message` ack rather than an HTTP status, since this isn't a REST path.
  async function sendMessage(classroomId, fromUser, toUserId, text) {
    await assertBothAdmitted(classroomId, fromUser.userId, toUserId);

    const participantsKey = [fromUser.userId, toUserId].sort().join('|');
    const messageId = uuidv4();
    const envelope = { classroomId, participantsKey, messageId, fromUserId: fromUser.userId, fromName: fromUser.name, toUserId, text, createdAt: Date.now() };

    node.outbox.enqueue(async () => {
      const conversation = await Conversation.findOneAndUpdate(
        { classroomId, participantsKey },
        { $setOnInsert: { classroomId, participantsKey, participants: [fromUser.userId, toUserId] } },
        { upsert: true, new: true }
      );
      await new PrivateMessage({
        conversationId: conversation._id.toString(),
        classroomId, messageId, fromUserId: fromUser.userId, fromName: fromUser.name, toUserId, text
      }).save();
    }, `private message ${messageId}`);

    node.messageBus.publish('PRIVATE_MESSAGE', envelope);
    return envelope;
  }

  async function getConversationMessages(classroomId, peerId, user) {
    const classroom = await membershipCache.getClassroom(classroomId);
    if (!classroom) throw new HttpError(404, 'Classroom not found');
    const selfOk = classroom.teacherId === user.userId || (await membershipCache.isAdmitted(classroomId, user.userId));
    const peerOk = classroom.teacherId === peerId || (await membershipCache.isAdmitted(classroomId, peerId));
    if (!selfOk || !peerOk) throw new HttpError(403, 'Both participants must be admitted members');

    const participantsKey = [user.userId, peerId].sort().join('|');
    const messages = await PrivateMessage.find({ classroomId }).lean();
    return messages.filter(m => [m.fromUserId, m.toUserId].sort().join('|') === participantsKey);
  }

  return { sendMessage, getConversationMessages };
};
