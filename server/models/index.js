const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['teacher', 'student'], required: true },
  createdAt: { type: Date, default: Date.now }
});

const classroomSchema = new mongoose.Schema({
  classroomId: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  teacherId: { type: String, required: true },
  settings: {
    groupChatEnabled: { type: Boolean, default: true },
    personalMessagingEnabled: { type: Boolean, default: true },
    fileSharingEnabled: { type: Boolean, default: true },
    settingsVersion: { type: Number, default: 0 }
  },
  status: { type: String, enum: ['ACTIVE', 'ENDED'], default: 'ACTIVE' },
  createdAt: { type: Date, default: Date.now }
});

const classroomMemberSchema = new mongoose.Schema({
  classroomId: { type: String, required: true },
  userId: { type: String, required: true },
  name: { type: String },
  status: { type: String, enum: ['PENDING', 'ADMITTED', 'REJECTED', 'REMOVED'], default: 'PENDING' },
  requestedAt: { type: Date, default: Date.now },
  decidedAt: { type: Date },
  decidedBy: { type: String }
});
classroomMemberSchema.index({ classroomId: 1, userId: 1 }, { unique: true });

const conversationSchema = new mongoose.Schema({
  classroomId: { type: String, required: true },
  participantsKey: { type: String, required: true },
  participants: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});
conversationSchema.index({ classroomId: 1, participantsKey: 1 }, { unique: true });

const privateMessageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true },
  classroomId: { type: String, required: true },
  messageId: { type: String, required: true, unique: true },
  fromUserId: { type: String, required: true },
  fromName: { type: String },
  toUserId: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const attendanceEventSchema = new mongoose.Schema({
  classroomId: { type: String, required: true },
  userId: { type: String, required: true },
  name: { type: String },
  type: { type: String, enum: ['JOIN', 'LEAVE'], required: true },
  ts: { type: Date, default: Date.now },
  nodeId: { type: String }
});

const resourceSchema = new mongoose.Schema({
  resourceId: { type: String, required: true, unique: true },
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  fileType: { type: String },
  size: { type: Number },
  ownerNodeId: { type: String, required: true },
  roomId: { type: String, required: true },
  uploaderId: { type: String },
  s3Bucket: { type: String, required: true },
  s3Key: { type: String, required: true },
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

module.exports = {
  User: mongoose.model('User', userSchema),
  Classroom: mongoose.model('Classroom', classroomSchema),
  ClassroomMember: mongoose.model('ClassroomMember', classroomMemberSchema),
  Conversation: mongoose.model('Conversation', conversationSchema),
  PrivateMessage: mongoose.model('PrivateMessage', privateMessageSchema),
  AttendanceEvent: mongoose.model('AttendanceEvent', attendanceEventSchema),
  Resource: mongoose.model('Resource', resourceSchema),
  Message: mongoose.model('Message', messageSchema)
};
