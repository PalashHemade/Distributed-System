const axios = require('axios');

const SYNC_INTERVAL_MS = 10000;

// Cristian's Algorithm: estimate this node's wall-clock offset from the
// Gateway's clock, by timing a round-trip and assuming the delay was split
// evenly each way. This is a PHYSICAL clock estimate, display-only — it
// never touches the real system clock, and it is unrelated to the Lamport/
// vector LOGICAL clocks living alongside it on BaseNode (see
// logicalClocks.js) — those establish event order, this estimates
// milliseconds of drift. Keep the two conceptually separate everywhere they
// get displayed.
module.exports = function clockSyncService(node) {
  async function syncOnce() {
    const sentAt = Date.now();
    try {
      const res = await axios.get(`${node.gatewayUrl}/health`, { timeout: 1500 });
      const receivedAt = Date.now();
      const roundTrip = receivedAt - sentAt;
      const gatewayTime = new Date(res.data.timestamp).getTime();
      node.clockOffsetMs = Math.round((gatewayTime + roundTrip / 2) - receivedAt);
    } catch (err) {
      // Gateway unreachable — leave the last known offset in place rather
      // than resetting to 0, which would misrepresent "no data" as "in sync".
    }
  }

  function start() {
    syncOnce();
    setInterval(syncOnce, SYNC_INTERVAL_MS);
  }

  return { start };
};
