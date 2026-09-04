const BaseNode = require('../BaseNode');

const nodeId = process.env.NODE_ID || 'node-B';
const port = process.env.NODE_PORT || 5002;

const node = new BaseNode(nodeId, port);
node.start();
