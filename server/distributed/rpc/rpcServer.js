const RpcProtocol = require('./rpcProtocol');

class RpcServer {
  constructor(node) {
    this.node = node; // Reference to BaseNode
    this.methods = new Map();
  }

  registerMethod(methodName, handler) {
    this.methods.set(methodName, handler);
    console.log(`[RPC SERVER] Registered method: ${methodName}`);
  }

  async handleRequest(req, res) {
    const { rpcId, method, params, senderNode } = req.body;
    console.log(`[RPC SERVER] ${this.node.nodeId} received ${method} from ${senderNode} | RPC_ID: ${rpcId}`);

    if (!this.methods.has(method)) {
      const errorMsg = `Method ${method} not found`;
      console.warn(`[RPC SERVER ERROR] ${errorMsg}`);
      return res.status(404).json(RpcProtocol.createResponse(rpcId, false, null, errorMsg));
    }

    try {
      const handler = this.methods.get(method);
      const result = await handler(params, senderNode);
      res.status(200).json(RpcProtocol.createResponse(rpcId, true, result));
    } catch (error) {
      console.error(`[RPC SERVER ERROR] Exception in method ${method}:`, error);
      res.status(500).json(RpcProtocol.createResponse(rpcId, false, null, error.message));
    }
  }
}

module.exports = RpcServer;
