const BaseNode = require('../BaseNode');

const nodeId = process.env.NODE_ID || 'node-A';
const port = process.env.NODE_PORT || 5001;

const node = new BaseNode(nodeId, port);
node.start();
