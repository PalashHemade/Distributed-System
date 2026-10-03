const MAX_EVENTS = 100;

// Backs the live "Communication Monitor" dashboard feed — every RPC call,
// P2P send, and registry change posts an event here (see nodeOpsController
// and registryService), and this just keeps the last N for the dashboard's
// initial-load fetch (the live stream itself is the Socket.IO broadcast in
// gateway/server.js, this is only the replay buffer).
module.exports = function monitorService(onEvent) {
  const events = [];

  function record(event) {
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    onEvent(event);
  }

  function getAll() {
    return events;
  }

  return { record, getAll };
};
