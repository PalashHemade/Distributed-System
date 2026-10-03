const mongoose = require('mongoose');

/**
 * Per-node write-behind queue: callers apply a change to local in-memory state
 * immediately (so the node stays available during a Mongo hiccup), then enqueue()
 * the corresponding durable write. Failed writes stay queued and retry with
 * backoff instead of being silently dropped — this is what makes the system
 * eventually consistent rather than best-effort/lossy.
 */
class Outbox {
  constructor(label) {
    this.label = label;
    this.queue = [];
    this.draining = false;
    this.retryDelayMs = 1000;
    this.maxRetryDelayMs = 15000;
  }

  // job: async () => { ... } — should be idempotent-safe to retry (upserts, unique keys, etc).
  enqueue(job, description) {
    this.queue.push({ job, description, attempts: 0 });
    this._drain();
  }

  async _drain() {
    if (this.draining) return;
    this.draining = true;

    while (this.queue.length > 0) {
      if (mongoose.connection.readyState !== 1) {
        // Not connected — wait and re-check rather than burning through retries pointlessly.
        await this._sleep(this.retryDelayMs);
        continue;
      }

      const entry = this.queue[0];
      try {
        await entry.job();
        this.queue.shift();
        this.retryDelayMs = 1000;
      } catch (err) {
        entry.attempts += 1;
        console.warn(`[${this.label}][outbox] write failed (attempt ${entry.attempts}) for "${entry.description}": ${err.message}`);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
        await this._sleep(this.retryDelayMs);
      }
    }

    this.draining = false;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  get pendingCount() {
    return this.queue.length;
  }
}

module.exports = Outbox;
