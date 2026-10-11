// Lamport logical clock: establishes event ORDER across the distributed
// system (not wall-clock time). Standard three rules — local event ticks,
// send stamps-and-ticks, receive takes the max of local/remote then ticks.
class LamportClock {
  constructor() {
    this.clock = 0;
  }

  tick() {
    this.clock += 1;
    return this.clock;
  }

  send() {
    return this.tick();
  }

  receive(remoteTs = 0) {
    this.clock = Math.max(this.clock, remoteTs) + 1;
    return this.clock;
  }

  get value() {
    return this.clock;
  }
}

// Vector clock: a plain object `{nodeId: count}` tracking one component per
// known node. Unlike Lamport, this can distinguish "causally ordered" from
// "genuinely concurrent" — two events where neither vector dominates the
// other really did happen independently, with no message between them.
function vcIncrement(vector, nodeId) {
  return { ...vector, [nodeId]: (vector[nodeId] || 0) + 1 };
}

// Component-wise max — applied on receiving a remote vector, before
// incrementing the local component (standard vector-clock receive rule).
function vcMerge(a, b) {
  const merged = { ...a };
  for (const key of Object.keys(b)) {
    merged[key] = Math.max(merged[key] || 0, b[key] || 0);
  }
  return merged;
}

function vcCompare(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let aGreater = false;
  let bGreater = false;
  for (const key of keys) {
    const av = (a && a[key]) || 0;
    const bv = (b && b[key]) || 0;
    if (av > bv) aGreater = true;
    if (bv > av) bGreater = true;
  }
  if (aGreater && bGreater) return 'CONCURRENT';
  if (aGreater) return 'A_AFTER_B';
  if (bGreater) return 'B_AFTER_A';
  return 'EQUAL';
}

module.exports = { LamportClock, vcIncrement, vcMerge, vcCompare };
