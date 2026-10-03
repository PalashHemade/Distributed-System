const { v4: uuidv4 } = require('uuid');
const { Classroom, ClassroomMember, AttendanceEvent } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const membershipCache = require('./membershipCache');

const SETTINGS_KEYS = ['groupChatEnabled', 'personalMessagingEnabled', 'fileSharingEnabled'];

// Factory, not a plain export: every method here needs `node.messageBus` to
// announce the change to the other two nodes (the Mongo write is always what
// actually makes the change durable — see the module docstring in
// messageBus.js — the publish is a best-effort "go refresh" nudge on top).
module.exports = function classroomService(node) {
  async function createClassroom(teacherId, name) {
    if (!name) throw new HttpError(400, 'name is required');
    const classroomId = uuidv4();
    const code = `DS-${Math.floor(100 + Math.random() * 900)}`;
    return new Classroom({ classroomId, code, name, teacherId }).save();
  }

  async function getByCode(code) {
    const classroom = await membershipCache.getClassroomByCode(code);
    if (!classroom) throw new HttpError(404, 'Classroom not found');
    return classroom;
  }

  async function submitJoinRequest(code, user) {
    const classroom = await getByCode(code);
    if (classroom.status !== 'ACTIVE') throw new HttpError(400, 'This classroom has ended');

    const existing = await ClassroomMember.findOne({ classroomId: classroom.classroomId, userId: user.userId });
    if (existing && existing.status === 'ADMITTED') return { classroomId: classroom.classroomId, status: 'ADMITTED' };
    if (existing && existing.status === 'REMOVED') throw new HttpError(403, 'You were removed from this classroom');

    await ClassroomMember.findOneAndUpdate(
      { classroomId: classroom.classroomId, userId: user.userId },
      { classroomId: classroom.classroomId, userId: user.userId, name: user.name, status: 'PENDING', requestedAt: new Date() },
      { upsert: true }
    );
    membershipCache.invalidateMembership(classroom.classroomId, user.userId);

    node.messageBus.publish('JOIN_REQUESTED', { classroomId: classroom.classroomId, userId: user.userId, name: user.name });
    return { classroomId: classroom.classroomId, status: 'PENDING' };
  }

  async function getMembershipStatus(classroomId, user) {
    const classroom = await membershipCache.getClassroom(classroomId);
    if (!classroom) throw new HttpError(404, 'Classroom not found');
    if (classroom.teacherId === user.userId) return 'TEACHER';
    const member = await membershipCache.getMembership(classroomId, user.userId);
    return member ? member.status : 'NONE';
  }

  async function decideMembership(classroomId, teacherId, targetUserId, status) {
    if (!['ADMITTED', 'REJECTED', 'REMOVED'].includes(status)) throw new HttpError(400, 'Invalid status');
    const isOwner = await membershipCache.isTeacherOwner(classroomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');

    const member = await ClassroomMember.findOneAndUpdate(
      { classroomId, userId: targetUserId },
      { status, decidedAt: new Date(), decidedBy: teacherId },
      { new: true }
    );
    if (!member) throw new HttpError(404, 'No such membership');
    membershipCache.invalidateMembership(classroomId, targetUserId);

    const eventType = status === 'ADMITTED' ? 'STUDENT_ADMITTED' : status === 'REJECTED' ? 'STUDENT_REJECTED' : 'STUDENT_REMOVED';
    node.messageBus.publish(eventType, { classroomId, userId: targetUserId });
    return member;
  }

  async function getWaitingList(classroomId, teacherId) {
    const isOwner = await membershipCache.isTeacherOwner(classroomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');
    return ClassroomMember.find({ classroomId, status: 'PENDING' }).lean();
  }

  async function getAdmittedMembers(classroomId) {
    return ClassroomMember.find({ classroomId, status: 'ADMITTED' }).lean();
  }

  async function updateSettings(classroomId, teacherId, patch) {
    const isOwner = await membershipCache.isTeacherOwner(classroomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');

    const classroom = await Classroom.findOne({ classroomId });
    if (!classroom) throw new HttpError(404, 'Classroom not found');

    for (const key of SETTINGS_KEYS) {
      if (typeof patch[key] === 'boolean') classroom.settings[key] = patch[key];
    }
    classroom.settings.settingsVersion += 1;
    await classroom.save();
    membershipCache.invalidateClassroom(classroomId);

    node.messageBus.publish('CLASSROOM_SETTINGS_CHANGED', { classroomId, settings: classroom.settings });
    return classroom;
  }

  async function endClassroom(classroomId, teacherId) {
    const isOwner = await membershipCache.isTeacherOwner(classroomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');
    const classroom = await Classroom.findOneAndUpdate({ classroomId }, { status: 'ENDED' }, { new: true });
    membershipCache.invalidateClassroom(classroomId);
    return classroom;
  }

  async function getAttendanceReport(classroomId, teacherId) {
    const isOwner = await membershipCache.isTeacherOwner(classroomId, teacherId);
    if (!isOwner) throw new HttpError(403, 'Not your classroom');

    const events = await AttendanceEvent.find({ classroomId }).sort({ ts: 1 }).lean();
    const byUser = new Map();
    for (const ev of events) {
      if (!byUser.has(ev.userId)) byUser.set(ev.userId, { userId: ev.userId, name: ev.name, joinedAt: null, leftAt: null, status: 'Left' });
      const entry = byUser.get(ev.userId);
      if (ev.type === 'JOIN') { entry.joinedAt = ev.ts; entry.leftAt = null; entry.status = 'Present'; }
      if (ev.type === 'LEAVE') { entry.leftAt = ev.ts; entry.status = 'Left'; }
    }
    return Array.from(byUser.values());
  }

  return {
    createClassroom, getByCode, submitJoinRequest, getMembershipStatus,
    decideMembership, getWaitingList, getAdmittedMembers, updateSettings,
    endClassroom, getAttendanceReport
  };
};
