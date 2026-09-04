const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  nodeId: { type: String, required: true },
  socketId: { type: String, required: true },
  roomId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  ownerNodeId: { type: String, required: true },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const resourceSchema = new mongoose.Schema({
  resourceId: { type: String, required: true, unique: true },
  fileName: { type: String, required: true },
  fileType: { type: String },
  size: { type: Number },
  ownerNodeId: { type: String, required: true },
  roomId: { type: String, required: true },
  path: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  roomId: { type: String, required: true },
  senderUserId: { type: String },
  senderName: { type: String },
  senderNodeId: { type: String, required: true },
  type: { type: String, required: true }, // e.g. CHAT_MESSAGE, USER_JOINED
  content: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const nodeStateSchema = new mongoose.Schema({
  nodeId: { type: String, required: true, unique: true },
  host: { type: String, required: true },
  port: { type: Number, required: true },
  status: { type: String, default: 'ONLINE' },
  lastSeen: { type: Date, default: Date.now },
  users: { type: Number, default: 0 },
  resources: { type: Number, default: 0 }
});

module.exports = {
  User: mongoose.model('User', userSchema),
  Room: mongoose.model('Room', roomSchema),
  Resource: mongoose.model('Resource', resourceSchema),
  Message: mongoose.model('Message', messageSchema),
  NodeState: mongoose.model('NodeState', nodeStateSchema)
};
