module.exports = function monitorController(monitorService) {
  function postMessage(req, res) {
    const event = req.body;
    monitorService.record(event);
    console.log(`[MONITOR] Received event:`, event.type);
    res.status(200).json({ success: true });
  }

  function getEvents(req, res) {
    res.status(200).json(monitorService.getAll());
  }

  return { postMessage, getEvents };
};
