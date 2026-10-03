const { asyncHandler } = require('../middleware/errorHandler');
const makeChatService = require('../services/chatService');
const makePrivateChatService = require('../services/privateChatService');

module.exports = function chatController(node) {
  const chatService = makeChatService(node);
  const privateChatService = makePrivateChatService(node);

  const roomHistory = asyncHandler(async (req, res) => {
    const history = await chatService.getRoomHistory(req.params.roomId, req.user);
    res.status(200).json(history);
  });

  const conversationMessages = asyncHandler(async (req, res) => {
    const messages = await privateChatService.getConversationMessages(req.params.id, req.params.peerId, req.user);
    res.status(200).json(messages);
  });

  return { roomHistory, conversationMessages };
};
