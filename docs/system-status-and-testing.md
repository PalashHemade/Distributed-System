# System Status & Testing Guide

One doc, three jobs: **what's actually working right now**, **where every course concept lives in the code**, and **exactly how to test each piece**. Written against the current working tree (everything below `## Current state` is implemented but not yet committed — see that section).

---

## Current state

- Last commit: `9a96334 Study room improved`. Everything described in this doc for Unit 3/4 (clocks, leader election, mutex, global state, clock sync, WebRTC mesh) is implemented in the **working tree, uncommitted**. Run `git status` before assuming any of this is in a specific commit.
- **MongoDB is required** — the app will not boot without `MONGODB_URI` set in root `.env`.
- **No cloud storage of any kind for resources.** AWS S3 was removed — file bytes live only in the receiving node's process memory (`node.fileStore`) for the lifetime of that process, and a different node fetches them over **RPC** on demand (not a shared store, not replication). See §11.
- No automated test suite exists anywhere in the repo. Everything below is manual/scripted verification.

---

## 1. Concept → implementation map

| Concept | Where it lives | Status |
|---|---|---|
| RPC (sync node-to-node) | `server/distributed/rpc/{rpcClient,rpcServer,rpcProtocol}.js` | Working. Used by **resource file transfer** (`findResource`/`getResource` — the only way a node gets another node's file bytes, see §11), leader election (`ping`/`electionPing`), and the distributed mutex (`acquireLock`/`releaseLock`) |
| Message-oriented async pub/sub | `server/distributed/messaging/messageBus.js` | Working. Carries `CHAT_MESSAGE`, `USER_JOINED/LEFT`, `RESOURCE_SHARED` (metadata only, never file bytes), `WEBRTC_SIGNAL`, `JOIN_REQUESTED`, `MEMBER_ADMITTED/REJECTED`, `ATTENDANCE_RECONNECTED/DISCONNECTED`, `COORDINATOR`, `CALL_PARTICIPANT_JOINED/LEFT` |
| P2P (bypasses Gateway) | `server/distributed/p2p/peerManager.js` | Working. Sends a metadata-only `RESOURCE_SHARED` notification between nodes (no file bytes — see §11) and carries gossip-based peer discovery |
| Stream-oriented (Socket.IO + WebRTC) | `server/distributed/streaming/socketManager.js`, `client/src/pages/StudyRoom.jsx` | Working. Room join/leave, chat, WebRTC signaling (now full mesh, see below) |
| Gateway-mediated discovery | `server/gateway/server.js`, `server/services/peerDiscoveryService.js` | Working. 5s heartbeat, OFFLINE after 10s silence, Gateway pushes peer list via `POST /api/peers` |
| Gossip protocol (discovery fallback) | `BaseNode.startGossip` / `peerDiscoveryService.js` | Working. Every 10s, falls back to hardcoded ports 5001-5003 if zero known peers |
| Client-side failover | `client/src/pages/StudyRoom.jsx` (socket `disconnect` handler) | Working. Queries Gateway `/health`, reconnects to another ONLINE node |
| **Lamport logical clock** | `server/services/logicalClocks.js` (`LamportClock`), hooked into `messageBus.publish/handleIncoming`, `rpcClient.call`, `rpcServer.handleRequest` | Working. Surfaced on `/health`, heartbeat, Dashboard, and attendance rows |
| **Vector clock** | `server/services/logicalClocks.js` (`vcIncrement`/`vcMerge`/`vcCompare`), same hook points as Lamport | Working. Used to detect genuinely concurrent attendance JOIN events (see §5) |
| **Leader election (Bully)** | `server/services/leaderElectionService.js` | Working. Rank = trailing letter of `nodeId` (`node-C` > `node-B` > `node-A`); failure detection reuses `RpcClient`'s existing circuit breaker |
| **Distributed mutual exclusion** | `leaderElectionService.js` (`acquireLock`/`releaseLock`), wired into `resourceService.decideShareRequest` via `withResourceLock` | Working. Coordinated by the elected leader; guards the teacher's approve/reject decision on a pending file |
| **Global state** | `server/gateway/services/registryService.js` (`getGlobalState`), `GET /api/global-state`, `client/src/pages/Dashboard.jsx` | Working. Majority-vote leader + per-node Lamport clocks + active locks, pushed live via the Gateway's existing Socket.IO stream |
| **Clock synchronization (Cristian's)** | `server/services/clockSyncService.js` | Working. Estimates offset against the Gateway's clock every 10s; display-only, never touches `Date.now()`/system clock |
| **Beacon/heartbeat protocol** | *Not a separate mechanism* — satisfied by leader election's RPC ping (`startLeaderPing`, 5s interval, circuit-breaker-based down detection) | Deliberately not built a 4th time; see `docs/distributed-concepts.md` |
| Teacher-gated file-sharing approval | `server/services/resourceService.js`, `StudyRoom.jsx` (Files tab, teacher-only approve/reject buttons) | Working. Files live only in the receiving node's memory (no disk, no cloud) — see §11 |
| Role-based auth (httpOnly cookie JWT) | `server/services/authService.js`, `server/middleware/auth.js`, `server/gateway/routes/authRoutes.js` | Working |
| WebRTC — **full mesh** (was 1:1) | `socketManager.js` (`_relaySignal`, `call_join`/`call_leave`), `StudyRoom.jsx` (`peerConnections` Map, `remoteStreams`) | Working. Capped at small classroom sizes by design (O(n²) connections) |
| Distributed web-based system (transparency) | Architectural property, not new code | Documented in `docs/distributed-web-based-system.md` |
| AWS deployment mapping | Not deployed | Case-study doc only, `docs/aws-case-study.md` |

---

## 2. Running everything

```bash
npm run postinstall     # once, after cloning
npm run dev              # gateway (5000) + node-A (5001) + node-B (5002) + node-C (5003) + client (Vite)
```

Required root `.env`: `GATEWAY_PORT`, `MONGODB_URI`, `JWT_SECRET`, `VITE_GATEWAY_URL`.

To run one node manually for debugging:
```bash
cd server && NODE_ID=node-A NODE_PORT=5001 node nodes/nodeA/server.js
```

---

## 3. Core app flow — auth, classroom, admission

1. Open `http://localhost:5173` (Vite default). Register a **teacher** account, then (in a different browser/incognito profile, or just log out) register 1–3 **student** accounts.
2. As the teacher: create a classroom (gets a random online node + a `DS-###` code — picked client-side in `LandingPage.jsx`, no server-side room registration).
3. As a student: enter the same `DS-###` code → lands in a **waiting room** (`phase: 'waiting'`) until the teacher admits them.
4. As the teacher: open the **People** rail icon → see the waiting list with badge count → click admit. Student's screen should flip from the waiting spinner straight into the classroom, no refresh needed (Socket.IO push + poll fallback).
5. Confirm multiple students admitted across the same classroom all see each other in the **People** tab roster.

**What to check if something's off:** `GET /api/classrooms/:code` (by code) and `GET /api/classrooms/:id/membership/status` are the two endpoints behind this; `membershipCache` is read-through from Mongo so a stale cache isn't normally a concern — if the UI seems stuck, check the browser console for the socket's `error_message` event, and the server stdout for `[SOCKET] ... connected`.

---

## 4. Group chat, private messaging, settings

1. In the classroom, **Chat** tab → send a message. Confirm it appears for every admitted participant, including ones connected to a *different* node (open one student session against node-A, another against node-B manually if you want to force this — normally the Gateway's `/health` pick is random, so running several sessions usually spreads across nodes on its own).
2. Click a participant's name/avatar in **People** to open a 1:1 **private message** thread (requires `personalMessagingEnabled`). Confirm the message is NOT visible to a third participant.
3. As teacher, open **Settings** (gear icon, teacher-only) and toggle `Group chat` / `Private messaging` / `File sharing` off. Confirm the corresponding UI section becomes unavailable for students in near-real time (settings broadcast via `CLASSROOM_SETTINGS_CHANGED`).

Underlying endpoints: `GET /api/classrooms/:id/conversations/:peerId/messages` (private history), `PATCH /api/classrooms/:id/settings` (teacher only), `GET /api/chat/room/:roomId` (group history).

---

## 5. Attendance — Lamport clock & vector clock (the required part)

**UI:** teacher-only **Attendance** icon → drawer shows Student / Joined / **Lamport** / Left / Status, plus a "Concurrent" badge with a tooltip listing who it's concurrent with.

**What Lamport shows:** logical join order — higher number = happened after, in causal terms, not wall-clock time. Climbs every time that node sends or receives an RPC/MessageBus message.

**What the vector clock does:** each attendance JOIN event stores a snapshot `{nodeId: count, ...}`. `getAttendanceReport` (`server/services/classroomService.js`) does an O(n²) pairwise `vcCompare` over every user's latest-JOIN vector and flags pairs with no causal relationship as `concurrentWith`.

### Test A — basic sanity (should NOT show Concurrent)
Two students join sequentially through the same node. Attendance should show increasing Lamport values and `concurrentWith: []` for both — ordinary causally-ordered joins never falsely flag.

### Test B — genuine concurrency (should show Concurrent)
This requires a real network partition — simultaneous clicking is *not* enough (MessageBus propagates in single-digit ms on localhost, so two "simultaneous" human clicks still resolve causally almost every time). The repeatable way:

1. Stop node-B's process entirely (not yet started, or killed).
2. Classroom setup + student1's full join flow (join-request, admit, socket connect, `join_classroom_channel`) happens entirely through **node-A**, with node-B not running at all — so node-A's vector has zero `node-B` component.
3. Start node-B fresh. **Within a few hundred ms** (before node-B's 4s leader-election bootstrap timer or node-A's 5s leader-ping timer can exchange anything), have student2 run the full join flow through **node-B**.
4. Pull `GET /api/classrooms/:id/attendance` — student1's vector should have no `node-B` key (or a much smaller one), student2's should have no `node-A` key (or much smaller) — i.e. neither dominates → `CONCURRENT`.

**Why the timing matters:** once node-B contacts the Gateway, it's rank-highest among running nodes (`node-B` > `node-A` alphabetically) so it declares itself leader at its 4s bootstrap mark; once node-A hears that `COORDINATOR` broadcast, node-A starts RPC-pinging node-B every 5s as the leader-health-check — and *that* RPC round-trip is what merges the two nodes' vectors together. Outside that ~4-5s window after node-B boots, the two nodes' attendance vectors are genuinely uncontaminated by each other. This was verified working end-to-end in a scripted run during this project — see the demo script approach above if you want to re-script it rather than racing it by hand in two browser windows.

**Practical manual version (less airtight, but doable by hand in two browser tabs):** kill node-B's process, admit+join student1 fully through node-A, restart node-B, and admit+join student2 through node-B as fast as you can — the faster you are, the more likely you get a clean `CONCURRENT`. If you get `A_AFTER_B`/`B_AFTER_A` instead, that's not a bug — it means enough cross-node traffic (the election handshake) happened before your second join, which is the expected, documented accepted limitation (vector clocks aren't persisted across a node restart and gossip/election traffic is a real causal channel).

---

## 6. Leader election (Bully algorithm)

**Where to watch it:** `GET http://localhost:500{1,2,3}/health` → `leader` field, or the Dashboard's leader crown (`★`) badge on a node card, or server stdout `[ELECTION] ...` logs.

1. Boot gateway + node-A + node-B + node-C. Within ~4-9 seconds, all three `/health` responses should agree on the same `leader` (should resolve to `node-C`, the highest rank, once all three are up).
2. **Kill the leader's process** (e.g. `Ctrl+C` on node-C, or find/kill its PID). Within ~5-10s (one failed ping + one election round), `/health` on the remaining two nodes should show a new leader (`node-B`).
3. **Restart the killed node.** Confirm it does **not** silently reclaim leadership just by rejoining — it only becomes leader again if a fresh election actually elects it (a lower-or-equal-ranked node is not an immediate leader just because it's back online; check `/health` right after restart vs. a few seconds later).
4. Dashboard (`/admin/distributed`) should show the crown move to the new leader live, no refresh.

---

## 7. Distributed mutual exclusion (file-decision lock)

This wraps the teacher's approve/reject decision on a pending student upload, coordinated through the elected leader — not a standalone demo button.

1. Student uploads a file while `fileSharingEnabled` (goes to `PENDING`, visible to teacher only, in the Files tab's pending section).
2. Open the **same teacher account in two browser tabs/windows**. In both, open the Files tab's pending list for the same file.
3. Click **Approve** in one tab and **Reject** in the other as close to simultaneously as you can.
4. Expected: exactly one of the two requests succeeds; the other gets back `409` — "Another decision is already in progress for this file — try again" (surfaced by `resourceService.withResourceLock`, via an RPC `acquireLock` call to whichever node is currently leader).
5. You can watch the lock show up in the Dashboard's Global State panel (`Active locks`) for the brief window it's held — it's released in a `finally` immediately after the decision completes, so this is a narrow window; firing two requests back-to-back is more reliable than trying to catch it mid-flight in the UI.

---

## 8. Global state panel

**UI:** Dashboard (`/admin/distributed`) → "Global State" section at the top → Leader / per-node Lamport clocks (e.g. `node-A=12  node-B=9  node-C=15`) / Active locks.

1. Confirm it updates live (no refresh) as nodes' Lamport clocks climb — generated by normal chat/attendance/election activity.
2. Confirm the leader shown here matches the per-node `leader` field from `/health` and the crown badge on the node card.
3. Trigger the mutex test in §7 while watching this panel for the `Active locks` entry to briefly populate.

Backing endpoint: `GET http://localhost:5000/api/global-state` — `{ leader, clocks: {nodeId: lamportValue}, activeLocks: [...] }`, computed by majority vote across each node's self-reported `leader` field in `registryService.getGlobalState()`.

---

## 9. Clock synchronization (Cristian's Algorithm)

Distinct from the Lamport/vector *logical* clocks above — this estimates each node's **physical wall-clock offset** against the Gateway, display-only.

1. `GET /health` on any node → `clockOffsetMs`. On localhost this should be a small number (near 0, often single-digit ms, occasionally slightly higher under load).
2. It recomputes every 10s (`clockSyncService.js`, `syncOnce()`), using round-trip timing against the Gateway's `/health`: `offset = (gatewayTime + roundTrip/2) - localSendTime`.
3. Confirm it never resets to a wild value if the Gateway briefly goes down — it should hold the last known offset rather than snapping to 0 (kill the Gateway, wait >10s, check `/health` on a node still shows a plausible last offset, not `0` or `null`).

---

## 10. Beacon / heartbeat protocol

Not a separately-built mechanism — intentionally satisfied by leader election's own failure detector (§6: `startLeaderPing`, 5s RPC ping to the current leader, circuit-breaker-based down detection). To "test" this specifically, it's the same steps as §6 step 2 — the leader-kill-and-reelect flow *is* the heartbeat/beacon demonstration. See `docs/distributed-concepts.md`'s Unit 3 section for the full reasoning on why a 4th redundant mechanism wasn't built.

---

## 11. Resource sharing and teacher approval (RPC, in-memory, no cloud storage)

File bytes are never written to disk or any cloud store. The node that receives the upload keeps the raw bytes in its own process memory (`node.fileStore`, a `Map<resourceId, buffer>` in `BaseNode.js`); every other node only ever has the file's *metadata* (synced via Mongo + MessageBus, like everything else). When a client on a different node needs the actual bytes, that node asks the owning node for them over **RPC** (`findResource`/`getResource`, `server/services/resourceService.js`), and the response carries the bytes back as a base64 data URL. This is deliberate: nothing in this project needs a shared file to outlive the classroom session it was shared in, so there's no replication and no durable storage to reason about.

1. As a student (with `fileSharingEnabled` on), upload a file. It should show as `PENDING` and **not** be visible/downloadable to other students yet.
2. As the teacher, approve it from the Files tab pending list. The uploader should get a `share_approved` system message; the file becomes visible/downloadable to the whole class.
3. Reject a different upload instead — uploader gets `share_rejected`, and it never becomes visible to anyone else. Check server stdout for `[FILE]`/mutex logs — a rejected file's bytes are dropped from `node.fileStore` immediately (`node.fileStore.delete(resourceId)`), not just hidden.
4. **Cross-node RPC fetch check (the actual thing to verify):** upload a file while connected to node-A, then open/download the same classroom from a client connected to node-B. The download should still succeed — watch node-B's stdout for `[RPC] Node node-B fetching "..." bytes from owning node node-A`, confirming the bytes came over RPC, not from any shared location node-B could read on its own.
5. **Owner-restart edge case:** upload a file via node-A, then kill node-A's process (or just wait and reconnect through node-B). A download attempt from node-B should now fail with "no longer available (its owning node may have restarted)" — this is intentional: there is no replication, so a file's bytes do not survive the owning node's process dying. This is an accepted, documented tradeoff, not a bug — see `docs/aws-case-study.md` §3.

---

## 12. WebRTC — full mesh video call

1. Get **3 participants** admitted into the same classroom (the demo is explicitly capped small — mesh cost is O(n²) connections).
2. Participant 1 clicks **Start Video Call**. Participant 2 joins the call next, then participant 3.
3. Expected: every participant's video tile grid shows **every other** participant (not just one), regardless of join order — this is the point of the mesh rewrite (previously hardcoded for exactly 2).
4. Confirm mute (mic icon) and camera toggle affect only your own tile/stream for everyone else.
5. Have one participant **leave the call** (not the classroom) — confirm the remaining two's connection to each other is unaffected (no renegotiation needed between parties who didn't leave).
6. Cross-node check: if your 3 participants happen to land on different nodes (`/health`-assigned), confirm signaling (`webrtc_offer`/`answer`/`ice`) still reaches the right target — this is the `toUserId`-targeted delivery through `_emitToUserLocally` + MessageBus fallback, not a room-wide broadcast.

---

## 13. Client failover

1. Note which node a student's browser is connected to (surfaced somewhere in the UI, or just check the Network tab's Socket.IO connection URL).
2. Kill that node's process.
3. Confirm the client shows a brief reconnecting state, then silently resumes on a different ONLINE node (queried from Gateway `/health`) — chat history, admission status, and attendance are unaffected because none of that state lived on the node that died.

---

## 14. Monitoring dashboard

`http://localhost:5173/admin/distributed`

1. **Topology graph:** should show all currently-ONLINE nodes with live arrows pulsing on activity (fades after 3s — `events.filter(... < 3000)`).
2. **Event log:** filterable by `RPC` / `MESSAGE` / `P2P` / `STREAM`. Trigger each kind and confirm it shows up:
   - `RPC`: trigger a resource lookup that misses locally (cross-node `findResource`), or just watch leader-election pings.
   - `MESSAGE`: send a chat message.
   - `P2P`: upload a file (replication push) or wait for a gossip tick.
   - `STREAM`: join/leave a classroom, or a WebRTC signal.
3. Every node card shows: ONLINE/OFFLINE status, user/resource counts, leader crown if applicable, `Lamport: N · Offset: Mms`.

---

## 15. Known open items (not bugs, just not finished)

- **A single scripted end-to-end combined demo** (classroom creation → cross-node admission → Lamport climbing → the concurrency partition script → leader kill/re-election → a mutex race → global-state panel → 3-way video call, all in one run) has been verified piece-by-piece but not yet chained into one automated script.
- No automated test suite — everything in this doc is manual/scripted verification, not `npm test`.
