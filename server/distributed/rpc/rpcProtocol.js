const { v4: uuidv4 } = require('uuid');

class RpcProtocol {
  static createRequest(method, params, senderNode, targetNode) {
    return {
      rpcId: uuidv4(),
      method,
      params,
      senderNode,
      targetNode,
      timestamp: Date.now()
    };
  }

  static createResponse(rpcId, success, result, error = null) {
    return {
      rpcId,
      success,
      result,
      error,
      timestamp: Date.now()
    };
  }
}

module.exports = RpcProtocol;
