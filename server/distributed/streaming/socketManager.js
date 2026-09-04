const socketIo = require('socket.io');

class SocketManager {
  constructor(node) {
    this.node = node;
    this.io = null;
  }

  initialize() {
    this.io = socketIo(this.node.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`[SOCKET] Client connected to ${this.node.nodeId}: ${socket.id}`);
      this.node.users++;

      socket.on('join_room', (data) => {
        const { roomId, user } = data;
        socket.join(roomId);
        console.log(`[SOCKET] User ${user.name} joined room ${roomId}`);
        
        // Propagate to other nodes via Message Bus
        this.node.messageBus.publish('USER_JOINED', {
          roomId,
          user: { ...user, socketId: socket.id, nodeId: this.node.nodeId }
        });
      });

      socket.on('leave_room', (data) => {
        const { roomId, user } = data;
        socket.leave(roomId);
        console.log(`[SOCKET] User ${user.name} left room ${roomId}`);
        
        // Propagate to other nodes via Message Bus
        this.node.messageBus.publish('USER_LEFT', {
          roomId,
          user: { ...user, socketId: socket.id, nodeId: this.node.nodeId }
        });
      });

      socket.on('chat_message', async (data) => {
        const { roomId, message, senderUser } = data;
        const { v4: uuidv4 } = require('uuid');
        
        const envelope = {
          messageId: uuidv4(),
          type: "CHAT_MESSAGE",
          senderNode: this.node.nodeId,
          senderUser: senderUser,
          roomId: roomId,
          timestamp: Date.now(),
          payload: message
        };

        // Save to DB
        if (mongoose.connection.readyState === 1) {
          const { Message } = require('../../models');
          try {
            await new Message({
              messageId: envelope.messageId,
              roomId: envelope.roomId,
              senderUserId: envelope.senderUser,
              senderName: envelope.senderUser,
              senderNodeId: envelope.senderNode,
              type: envelope.type,
              content: envelope.payload.text
            }).save();
          } catch(err) { console.error('Failed to save message', err); }
        }
        
        // Broadcast locally to this room
        socket.to(roomId).emit('chat_message', envelope);
        
        // Propagate to other nodes via Message Bus
        this.node.messageBus.publish('CHAT_MESSAGE', envelope);
      });

      socket.on('disconnect', () => {
        console.log(`[SOCKET] Client disconnected from ${this.node.nodeId}: ${socket.id}`);
        this.node.users = Math.max(0, this.node.users - 1);
      });

      // WebRTC Signaling
      socket.on('webrtc_offer', (data) => {
        socket.to(data.roomId).emit('webrtc_offer', data);
        this.node.messageBus.publish('WEBRTC_SIGNAL', { type: 'webrtc_offer', ...data });
      });

      socket.on('webrtc_answer', (data) => {
        socket.to(data.roomId).emit('webrtc_answer', data);
        this.node.messageBus.publish('WEBRTC_SIGNAL', { type: 'webrtc_answer', ...data });
      });

      socket.on('webrtc_ice', (data) => {
        socket.to(data.roomId).emit('webrtc_ice', data);
        this.node.messageBus.publish('WEBRTC_SIGNAL', { type: 'webrtc_ice', ...data });
      });
    });

    // Listen to Message Bus to forward events from other nodes to local sockets
    this.node.messageBus.subscribe('USER_JOINED', (msg) => {
      if (msg.senderNode !== this.node.nodeId) {
        this.io.to(msg.payload.roomId).emit('user_joined', msg.payload.user);
      }
    });

    this.node.messageBus.subscribe('CHAT_MESSAGE', (msg) => {
      if (msg.senderNode !== this.node.nodeId) {
        this.io.to(msg.payload.roomId).emit('chat_message', msg.payload.message);
      }
    });

    this.node.messageBus.subscribe('WEBRTC_SIGNAL', (msg) => {
      if (msg.senderNode !== this.node.nodeId) {
        this.io.to(msg.payload.roomId).emit(msg.payload.type, msg.payload);
      }
    });

    this.node.messageBus.subscribe('RESOURCE_SHARED', (msg) => {
      // Local emit if it came from another node (or even if same node, to update UI)
      this.io.to(msg.payload.roomId).emit('resource_shared', msg.payload);
    });
  }
}

module.exports = SocketManager;
