const RpcProtocol = require('./rpcProtocol');
const { vcIncrement, vcMerge } = require('../../services/logicalClocks');

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
    // NOTE: the client actually sends {messageId, method, params, senderNodeId,
    // lamportTs, vectorClock} — not {rpcId, senderNode} as destructured below
    // for rpcId/senderNode (that mismatch pre-dates this change and is
    // harmless since neither is used for anything functional, only logging).
    // Read the clock fields directly off req.body instead of trusting that
    // destructuring.
    const { rpcId, method, params, senderNode } = req.body;
    console.log(`[RPC SERVER] ${this.node.nodeId} received ${method} from ${req.body.senderNodeId || senderNode} | RPC_ID: ${rpcId}`);

    this.node.lamportClock.receive(req.body.lamportTs || 0);
    if (req.body.vectorClock) {
      this.node.vectorClock = vcIncrement(vcMerge(this.node.vectorClock, req.body.vectorClock), this.node.nodeId);
    }

    if (!this.methods.has(method)) {
      const errorMsg = `Method ${method} not found`;
      console.warn(`[RPC SERVER ERROR] ${errorMsg}`);
      return res.status(404).json(this._stamp(RpcProtocol.createResponse(rpcId, false, null, errorMsg)));
    }

    try {
      const handler = this.methods.get(method);
      const result = await handler(params, req.body.senderNodeId || senderNode);
      res.status(200).json(this._stamp(RpcProtocol.createResponse(rpcId, true, result)));
    } catch (error) {
      console.error(`[RPC SERVER ERROR] Exception in method ${method}:`, error);
      res.status(500).json(this._stamp(RpcProtocol.createResponse(rpcId, false, null, error.message)));
    }
  }

  // The response leg of an RPC call is a message too — stamp it so the
  // caller's clocks advance on receipt, same as everywhere else.
  _stamp(response) {
    this.node.vectorClock = vcIncrement(this.node.vectorClock, this.node.nodeId);
    response.lamportTs = this.node.lamportClock.send();
    response.vectorClock = { ...this.node.vectorClock };
    return response;
  }
}

module.exports = RpcServer;
