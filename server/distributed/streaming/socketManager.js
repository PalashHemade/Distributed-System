const socketIo = require('socket.io');
const mongoose = require('mongoose');

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
        
        const userObj = { ...user, socketId: socket.id, nodeId: this.node.nodeId };

        // Local Broadcast
        socket.to(roomId).emit('user_joined', userObj);

        // Propagate to other nodes via Message Bus
        this.node.messageBus.publish('USER_JOINED', {
          roomId,
          user: userObj
        });
      });

      socket.on('leave_room', (data) => {
        const { roomId, user } = data;
        socket.leave(roomId);
        console.log(`[SOCKET] User ${user.name} left room ${roomId}`);
        
        const userObj = { ...user, socketId: socket.id, nodeId: this.node.nodeId };

        // Local Broadcast
        socket.to(roomId).emit('user_left', userObj);

        // Propagate to other nodes via Message Bus
        this.node.messageBus.publish('USER_LEFT', {
          roomId,
          user: userObj
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
        
        // Save to memory
        if (!this.node.chatHistory.has(roomId)) this.node.chatHistory.set(roomId, []);
        this.node.chatHistory.get(roomId).push(envelope);
        
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
        if (!this.node.chatHistory.has(msg.payload.roomId)) this.node.chatHistory.set(msg.payload.roomId, []);
        this.node.chatHistory.get(msg.payload.roomId).push(msg.payload);
        
        this.io.to(msg.payload.roomId).emit('chat_message', msg.payload);
      }
    });

    this.node.messageBus.subscribe('WEBRTC_SIGNAL', (msg) => {
      if (msg.senderNode !== this.node.nodeId) {
        this.io.to(msg.payload.roomId).emit(msg.payload.type, msg.payload);
      }
    });

    this.node.messageBus.subscribe('RESOURCE_SHARED', (msg) => {
      if (!this.node.resourceHistory.has(msg.payload.roomId)) this.node.resourceHistory.set(msg.payload.roomId, []);
      this.node.resourceHistory.get(msg.payload.roomId).push(msg.payload);
      
      // Local emit if it came from another node (or even if same node, to update UI)
      this.io.to(msg.payload.roomId).emit('resource_shared', msg.payload);
    });
  }
}

module.exports = SocketManager;
