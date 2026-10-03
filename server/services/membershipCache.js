// Process-local, short-TTL read-through cache in front of the Classroom /
// ClassroomMember collections. Every node process gets its own instance of
// this module (Node's require cache is per-process), which is exactly the
// scope it needs: a cheap way to avoid re-querying Mongo on every socket
// event/request without pretending to be a second source of truth — Mongo
// stays authoritative (see classroomService), this just shields it from
// read load for a few seconds at a time.
const { Classroom, ClassroomMember } = require('../models');

const CACHE_TTL_MS = 3000;
const classroomCache = new Map(); // classroomId -> { value, expiresAt }
const memberCache = new Map(); // `${classroomId}:${userId}` -> { value, expiresAt }

function cacheGet(map, key) {
  const entry = map.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  map.delete(key);
  return undefined;
}

function cacheSet(map, key, value) {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function getClassroom(classroomId) {
  const cached = cacheGet(classroomCache, classroomId);
  if (cached !== undefined) return cached;
  const classroom = await Classroom.findOne({ classroomId }).lean();
  cacheSet(classroomCache, classroomId, classroom || null);
  return classroom;
}

async function getClassroomByCode(code) {
  return Classroom.findOne({ code }).lean();
}

async function getMembership(classroomId, userId) {
  const key = `${classroomId}:${userId}`;
  const cached = cacheGet(memberCache, key);
  if (cached !== undefined) return cached;
  const member = await ClassroomMember.findOne({ classroomId, userId }).lean();
  cacheSet(memberCache, key, member || null);
  return member;
}

function invalidateClassroom(classroomId) {
  classroomCache.delete(classroomId);
}

function invalidateMembership(classroomId, userId) {
  memberCache.delete(`${classroomId}:${userId}`);
}

async function isAdmitted(classroomId, userId) {
  const member = await getMembership(classroomId, userId);
  return !!member && member.status === 'ADMITTED';
}

async function isTeacherOwner(classroomId, userId) {
  const classroom = await getClassroom(classroomId);
  return !!classroom && classroom.teacherId === userId;
}

module.exports = {
  getClassroom,
  getClassroomByCode,
  getMembership,
  invalidateClassroom,
  invalidateMembership,
  isAdmitted,
  isTeacherOwner
};
