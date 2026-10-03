const { asyncHandler } = require('../middleware/errorHandler');
const makeClassroomService = require('../services/classroomService');

module.exports = function classroomController(node) {
  const classroomService = makeClassroomService(node);

  const create = asyncHandler(async (req, res) => {
    const classroom = await classroomService.createClassroom(req.user.userId, req.body.name);
    res.status(201).json(classroom);
  });

  const getByCode = asyncHandler(async (req, res) => {
    const classroom = await classroomService.getByCode(req.params.code);
    res.status(200).json(classroom);
  });

  const joinRequest = asyncHandler(async (req, res) => {
    const result = await classroomService.submitJoinRequest(req.params.code, req.user);
    res.status(202).json(result);
  });

  const membershipStatus = asyncHandler(async (req, res) => {
    const status = await classroomService.getMembershipStatus(req.params.id, req.user);
    res.status(200).json({ status });
  });

  const decideMember = asyncHandler(async (req, res) => {
    const member = await classroomService.decideMembership(req.params.id, req.user.userId, req.params.userId, req.body.status);
    res.status(200).json(member);
  });

  const waitingList = asyncHandler(async (req, res) => {
    const waiting = await classroomService.getWaitingList(req.params.id, req.user.userId);
    res.status(200).json(waiting);
  });

  const members = asyncHandler(async (req, res) => {
    const list = await classroomService.getAdmittedMembers(req.params.id);
    res.status(200).json(list);
  });

  const updateSettings = asyncHandler(async (req, res) => {
    const classroom = await classroomService.updateSettings(req.params.id, req.user.userId, req.body);
    res.status(200).json(classroom);
  });

  const endClassroom = asyncHandler(async (req, res) => {
    const classroom = await classroomService.endClassroom(req.params.id, req.user.userId);
    res.status(200).json(classroom);
  });

  const attendance = asyncHandler(async (req, res) => {
    const report = await classroomService.getAttendanceReport(req.params.id, req.user.userId);
    res.status(200).json(report);
  });

  return { create, getByCode, joinRequest, membershipStatus, decideMember, waitingList, members, updateSettings, endClassroom, attendance };
};
