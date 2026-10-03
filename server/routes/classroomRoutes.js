const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const makeClassroomController = require('../controllers/classroomController');
const makeChatController = require('../controllers/chatController');

module.exports = function classroomRoutes(node) {
  const router = express.Router();
  const ctrl = makeClassroomController(node);
  const chatCtrl = makeChatController(node);

  router.post('/', requireAuth, requireRole('teacher'), ctrl.create);
  router.get('/:code', requireAuth, ctrl.getByCode);
  router.post('/:code/join-request', requireAuth, requireRole('student'), ctrl.joinRequest);
  router.get('/:id/membership/status', requireAuth, ctrl.membershipStatus);
  router.patch('/:id/members/:userId', requireAuth, requireRole('teacher'), ctrl.decideMember);
  router.get('/:id/waiting', requireAuth, requireRole('teacher'), ctrl.waitingList);
  router.get('/:id/members', requireAuth, ctrl.members);
  router.patch('/:id/settings', requireAuth, requireRole('teacher'), ctrl.updateSettings);
  router.patch('/:id/end', requireAuth, requireRole('teacher'), ctrl.endClassroom);
  router.get('/:id/attendance', requireAuth, requireRole('teacher'), ctrl.attendance);
  router.get('/:id/conversations/:peerId/messages', requireAuth, chatCtrl.conversationMessages);

  return router;
};
