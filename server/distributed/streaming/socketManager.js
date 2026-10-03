const socketIo = require('socket.io');
const { socketAuth } = require('../../middleware/auth');
const membershipCache = require('../../services/membershipCache');
const makeChatService = require('../../services/chatService');
const makePrivateChatService = require('../../services/privateChatService');
const makeAttendanceService = require('../../services/attendanceService');

// This is the "controller" layer for the real-time surface: it wires socket
// events to services exactly the way routes/*.js wire HTTP requests to
// controllers to services. The one thing that's genuinely this class's own
// job (not delegated) is bridging MessageBus events to locally-connected
// sockets — see _subscribeToBus — since that's specifically about Socket.IO
// rooms on this process, not a domain concern any service should own.
class SocketManager {
  constructor(node) {
    this.node = node;
    this.io = null;
    this.chatService = makeChatService(node);
    this.privateChatService = makePrivateChatService(node);
    this.attendanceService = makeAttendanceService(node);
    // userId -> Set<socketId> connected to THIS node (routes private messages / targeted pushes)
    this.userSockets = new Map();
  }

  initialize() {
    this.io = socketIo(this.node.server, {
      cors: { origin: true, credentials: true, methods: ["GET", "POST"] }
    });

    this.io.use(socketAuth);
    this.io.on('connection', (socket) => this._handleConnection(socket));

    this._subscribeToBus();
  }

  _handleConnection(socket) {
    const { userId, name, role } = socket.user;
    console.log(`[SOCKET] ${role} ${name} (${userId}) connected to ${this.node.nodeId}: ${socket.id}`);
    this.node.users++;
    this._trackUserSocket(userId, socket.id);

    socket.on('join_classroom_channel', (data) => this._onJoinClassroomChannel(socket, data));
    socket.on('confirm_admission', (data) => this._onConfirmAdmission(socket, data));
    socket.on('confirm_removed', (data) => this._onConfirmRemoved(socket, data));
    socket.on('chat_message', (data) => this._onChatMessage(socket, data));
    socket.on('private_message', (data) => this._onPrivateMessage(socket, data));
    socket.on('raise_hand', (data) => this._onHandSignal(socket, data, true));
    socket.on('lower_hand', (data) => this._onHandSignal(socket, data, false));
    socket.on('join_room', (data) => this._onLegacyJoinRoom(socket, data));
    socket.on('leave_room', (data) => this._onLegacyLeaveRoom(socket, data));
    socket.on('disconnect', () => this._onDisconnect(socket));

    socket.on('webrtc_offer', (data) => this._relaySignal(socket, 'webrtc_offer', data));
    socket.on('webrtc_answer', (data) => this._relaySignal(socket, 'webrtc_answer', data));
    socket.on('webrtc_ice', (data) => this._relaySignal(socket, 'webrtc_ice', data));
  }

  // --- Classroom channel join: teacher always lands in the classroom room;
  // a student lands in the waiting room unless already ADMITTED. ---
  async _onJoinClassroomChannel(socket, { classroomId }) {
    const { userId, name, role } = socket.user;
    try {
      const classroom = await membershipCache.getClassroom(classroomId);
      if (!classroom) return socket.emit('error_message', { error: 'Classroom not found' });

      if (role === 'teacher') {
        if (classroom.teacherId !== userId) return socket.emit('error_message', { error: 'Not your classroom' });
        socket.join(`classroom:${classroomId}`);
        socket.data.classroomId = classroomId;
        return socket.emit('channel_joined', { classroomId, as: 'classroom' });
      }

      const admitted = await membershipCache.isAdmitted(classroomId, userId);
      if (admitted) {
        socket.join(`classroom:${classroomId}`);
        socket.data.classroomId = classroomId;
        this.attendanceService.recordJoin(classroomId, userId, name);
        return socket.emit('channel_joined', { classroomId, as: 'classroom' });
      }

      socket.join(`waiting:${classroomId}`);
      socket.data.classroomId = classroomId;
      socket.data.waiting = true;
      socket.emit('channel_joined', { classroomId, as: 'waiting' });
    } catch (err) {
      socket.emit('error_message', { error: err.message });
    }
  }

  // Fired by a waiting student's client after it receives (or polls into) an
  // ADMITTED status — moves this specific socket from waiting -> classroom room.
  async _onConfirmAdmission(socket, { classroomId }) {
    const { userId, name } = socket.user;
    const admitted = await membershipCache.isAdmitted(classroomId, userId);
    if (!admitted) return;
    socket.leave(`waiting:${classroomId}`);
    socket.join(`classroom:${classroomId}`);
    socket.data.waiting = false;
    this.attendanceService.recordJoin(classroomId, userId, name);
    socket.emit('channel_joined', { classroomId, as: 'classroom' });
  }

  _onConfirmRemoved(socket, { classroomId }) {
    const { userId, name } = socket.user;
    socket.leave(`classroom:${classroomId}`);
    socket.leave(`waiting:${classroomId}`);
    this.attendanceService.recordExplicitLeave(classroomId, userId, name);
  }

  async _onChatMessage(socket, { roomId, message }) {
    const { userId, name, role } = socket.user;
    try {
      await this.chatService.assertSendAllowed(roomId, userId, role);
    } catch (err) {
      return socket.emit('error_message', { error: err.message });
    }

    const envelope = this.chatService.buildEnvelope(roomId, name, userId, message);
    this.chatService.recordAndBroadcast(envelope);
    socket.to(`classroom:${roomId}`).emit('chat_message', envelope);
  }

  async _onPrivateMessage(socket, { classroomId, toUserId, text }) {
    try {
      const envelope = await this.privateChatService.sendMessage(classroomId, socket.user, toUserId, text);
      socket.emit('private_message', envelope); // echo to sender
      this._emitToUserLocally(toUserId, 'private_message', envelope);
    } catch (err) {
      socket.emit('error_message', { error: err.message });
    }
  }

  _onHandSignal(socket, { classroomId }, raised) {
    const { userId, name } = socket.user;
    const payload = { classroomId, userId, name, raised };
    const event = raised ? 'hand_raised' : 'hand_lowered';
    socket.to(`classroom:${classroomId}`).emit(event, payload);
    this.node.messageBus.publish(raised ? 'RAISE_HAND' : 'LOWER_HAND', payload);
  }

  // Kept only for backward compatibility with the original ephemeral
  // participant-presence event; the classroom flow uses
  // join_classroom_channel instead (see above).
  _onLegacyJoinRoom(socket, { roomId, user }) {
    socket.join(roomId);
    const userObj = { ...user, socketId: socket.id, nodeId: this.node.nodeId };
    socket.to(roomId).emit('user_joined', userObj);
    this.node.messageBus.publish('USER_JOINED', { roomId, user: userObj });
  }

  _onLegacyLeaveRoom(socket, { roomId, user }) {
    socket.leave(roomId);
    const userObj = { ...user, socketId: socket.id, nodeId: this.node.nodeId };
    socket.to(roomId).emit('user_left', userObj);
    this.node.messageBus.publish('USER_LEFT', { roomId, user: userObj });
  }

  _onDisconnect(socket) {
    const { userId, name, role } = socket.user;
    console.log(`[SOCKET] Client disconnected from ${this.node.nodeId}: ${socket.id}`);
    this.node.users = Math.max(0, this.node.users - 1);
    this._untrackUserSocket(userId, socket.id);

    const classroomId = socket.data && socket.data.classroomId;
    if (classroomId && role === 'student' && !socket.data.waiting) {
      this.attendanceService.startGrace(classroomId, userId, name);
    }
  }

  _relaySignal(socket, event, data) {
    socket.to(`classroom:${data.roomId}`).emit(event, data);
    this.node.messageBus.publish('WEBRTC_SIGNAL', { type: event, ...data });
  }

  _trackUserSocket(userId, socketId) {
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId).add(socketId);
  }

  _untrackUserSocket(userId, socketId) {
    const set = this.userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.userSockets.delete(userId);
  }

  _emitToUserLocally(userId, event, payload) {
    const set = this.userSockets.get(userId);
    if (!set) return false;
    for (const socketId of set) this.io.to(socketId).emit(event, payload);
    return set.size > 0;
  }

  _subscribeToBus() {
    const bus = this.node.messageBus;

    bus.subscribe('USER_JOINED', (msg) => {
      if (msg.senderNode !== this.node.nodeId) this.io.to(msg.payload.roomId).emit('user_joined', msg.payload.user);
    });

    bus.subscribe('CHAT_MESSAGE', (msg) => {
      if (msg.senderNode !== this.node.nodeId) {
        if (!this.node.chatHistory.has(msg.payload.roomId)) this.node.chatHistory.set(msg.payload.roomId, []);
        this.node.chatHistory.get(msg.payload.roomId).push(msg.payload);
        this.io.to(`classroom:${msg.payload.roomId}`).emit('chat_message', msg.payload);
      }
    });

    bus.subscribe('WEBRTC_SIGNAL', (msg) => {
      if (msg.senderNode !== this.node.nodeId) this.io.to(`classroom:${msg.payload.roomId}`).emit(msg.payload.type, msg.payload);
    });

    bus.subscribe('RESOURCE_SHARED', (msg) => {
      if (!this.node.resourceHistory.has(msg.payload.roomId)) this.node.resourceHistory.set(msg.payload.roomId, []);
      this.node.resourceHistory.get(msg.payload.roomId).push(msg.payload);
      this.io.to(`classroom:${msg.payload.roomId}`).emit('resource_shared', msg.payload);
    });

    bus.subscribe('JOIN_REQUESTED', (msg) => {
      this.io.to(`classroom:${msg.payload.classroomId}`).emit('join_requested', msg.payload);
    });

    bus.subscribe('STUDENT_ADMITTED', (msg) => {
      this.io.to(`waiting:${msg.payload.classroomId}`).emit('admitted', msg.payload);
    });

    bus.subscribe('STUDENT_REJECTED', (msg) => {
      this.io.to(`waiting:${msg.payload.classroomId}`).emit('rejected', msg.payload);
    });

    bus.subscribe('STUDENT_REMOVED', (msg) => {
      this.io.to(`classroom:${msg.payload.classroomId}`).emit('removed', msg.payload);
    });

    bus.subscribe('CLASSROOM_SETTINGS_CHANGED', (msg) => {
      this.io.to(`classroom:${msg.payload.classroomId}`).emit('settings_changed', msg.payload);
    });

    bus.subscribe('PRIVATE_MESSAGE', (msg) => {
      this._emitToUserLocally(msg.payload.toUserId, 'private_message', msg.payload);
    });

    bus.subscribe('RAISE_HAND', (msg) => {
      if (msg.senderNode !== this.node.nodeId) this.io.to(`classroom:${msg.payload.classroomId}`).emit('hand_raised', msg.payload);
    });

    bus.subscribe('LOWER_HAND', (msg) => {
      if (msg.senderNode !== this.node.nodeId) this.io.to(`classroom:${msg.payload.classroomId}`).emit('hand_lowered', msg.payload);
    });

    bus.subscribe('ATTENDANCE_RECONNECTED', (msg) => {
      this.attendanceService.cancelGrace(msg.payload.classroomId, msg.payload.userId);
    });
  }
}

module.exports = SocketManager;
