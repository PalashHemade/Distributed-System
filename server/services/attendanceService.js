const { AttendanceEvent } = require('../models');

const GRACE_MS = 35000;

// Factory: owns the grace-period timer map for whichever node constructs it.
// "Present" is always derived from the AttendanceEvent log (see
// classroomService.getAttendanceReport) — this service's only job is
// deciding when a disconnect is "just a hiccup" (no LEAVE recorded) versus
// a real departure, across a possible failover to a different node. See
// docs/distributed-concepts or the plan doc for the full reconciliation
// walkthrough; the short version: ATTENDANCE_RECONNECTED is broadcast to
// every node so whichever one is holding the timer (which might not be this
// one, if the student failed over elsewhere) cancels it.
module.exports = function attendanceService(node) {
  const timers = new Map(); // `${classroomId}:${userId}` -> timeout handle

  function writeEvent(classroomId, userId, name, type) {
    console.log(`[ATTENDANCE] ${node.nodeId}: ${type} — ${name} (${userId}) in classroom ${classroomId}`);
    node.outbox.enqueue(async () => {
      await new AttendanceEvent({ classroomId, userId, name, type, nodeId: node.nodeId }).save();
    }, `attendance ${type} ${classroomId}:${userId}`);
  }

  function cancelGrace(classroomId, userId) {
    const key = `${classroomId}:${userId}`;
    const handle = timers.get(key);
    if (handle) {
      clearTimeout(handle);
      timers.delete(key);
    }
  }

  // Called when a socket actually enters the classroom room (fresh join,
  // confirmed admission, or a reconnect). Always cancels any grace timer —
  // locally and on every other node, since a failover can land the student
  // on a different node than the one that saw the original disconnect.
  function recordJoin(classroomId, userId, name) {
    cancelGrace(classroomId, userId);
    node.messageBus.publish('ATTENDANCE_RECONNECTED', { classroomId, userId });
    writeEvent(classroomId, userId, name, 'JOIN');
  }

  function recordExplicitLeave(classroomId, userId, name) {
    cancelGrace(classroomId, userId);
    writeEvent(classroomId, userId, name, 'LEAVE');
  }

  // Called on socket disconnect. Starts this node's own grace timer and
  // tells peers a disconnect happened (informational only, not acted on
  // anywhere yet, but keeps the dashboard/monitor-style event trail honest).
  function startGrace(classroomId, userId, name) {
    const key = `${classroomId}:${userId}`;
    node.messageBus.publish('ATTENDANCE_DISCONNECTED', { classroomId, userId });
    const handle = setTimeout(() => {
      timers.delete(key);
      writeEvent(classroomId, userId, name, 'LEAVE');
    }, GRACE_MS);
    timers.set(key, handle);
  }

  return { recordJoin, recordExplicitLeave, startGrace, cancelGrace };
};
