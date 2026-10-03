# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A distributed systems academic project (MERN stack) demonstrating RPC, message-oriented communication, P2P messaging, and stream-oriented communication (Socket.IO + WebRTC). It is *not* a conventional web app — the "backend" is intentionally multiple independent Node.js processes that coordinate with each other, because that coordination is the subject being demonstrated. See `docs/distributed-concepts.md` for the full mapping of course concepts to implementation files (useful context if asked to explain *why* something is structured a certain way).

## Commands

```bash
npm run postinstall   # installs client/ and server/ deps (run after cloning)
npm run dev            # runs gateway + node:a + node:b + node:c + client concurrently (the normal dev command)
npm run gateway        # gateway only, port from GATEWAY_PORT (default 5000)
npm run node:a         # node A only, NODE_ID=node-A NODE_PORT=5001
npm run node:b         # node B only, NODE_ID=node-B NODE_PORT=5002
npm run node:c         # node C only, NODE_ID=node-C NODE_PORT=5003
npm run client         # Vite dev server only
```

Inside `client/`: `npm run build`, `npm run lint` (oxlint), `npm run preview`.

There is no test suite anywhere in this repo (no Jest/Vitest/etc. configured) and no root-level lint. Don't assume test commands exist — verify before invoking any.

To run a single node manually (e.g. for debugging one node in isolation), set env vars directly:
```bash
cd server && NODE_ID=node-A NODE_PORT=5001 node nodes/nodeA/server.js
```

Required `.env` (root): `GATEWAY_PORT`, `VITE_GATEWAY_URL`, `MONGODB_URI` (optional — see below).

## Architecture

**Topology:** one Gateway process + three independent Node processes (A/B/C, each a full Express+Socket.IO server) + one React SPA. The browser connects *directly* to whichever Node it was assigned (`http://localhost:<nodePort>`) for everything — chat, file upload/download, Socket.IO — not through the Gateway. The Gateway is only used for node discovery (`GET /health`) and as a central monitoring/dashboard hub; it holds no room/chat/resource state itself.

**Each Node (`server/nodes/BaseNode.js`, subclassed trivially by `nodes/nodeA|B|C/server.js` which just set `NODE_ID`/`NODE_PORT`)** owns its own Express app, Socket.IO instance, and in-memory state (`chatHistory`, `resourceHistory` Maps keyed by `roomId`), optionally mirrored to MongoDB if `MONGODB_URI` is set (every Mongo write is guarded by `mongoose.connection.readyState === 1` and wrapped in try/catch — the app is designed to run with Mongo absent, falling back to memory only). Each node composes four distributed-communication components from `server/distributed/`:

- **RPC (`distributed/rpc/`)** — `RpcClient`/`RpcServer`/`RpcProtocol`. Synchronous node-to-node calls (e.g. `findResource`, `getResource`) used when a client asks its connected node for a file that isn't stored locally. `RpcClient` has a per-target-node circuit breaker (1.5s timeout, opens after 2 consecutive failures, 10s cooldown, fast-fails while open) — be aware of this when reasoning about why an RPC call might throw immediately without hitting the network.
- **Messaging (`distributed/messaging/messageBus.js`)** — async pub/sub. `publish(type, payload)` fires to all known peers' `/api/messaging/receive` plus the Gateway's monitor endpoint; `subscribe(type, cb)` registers local handlers invoked from `handleIncoming`. Used for `CHAT_MESSAGE`, `USER_JOINED`, `USER_LEFT`, `RESOURCE_SHARED`, `WEBRTC_SIGNAL` so all nodes' Socket.IO rooms stay in sync regardless of which node a given participant is attached to.
- **P2P (`distributed/p2p/peerManager.js`)** — direct node-to-node calls bypassing the Gateway, used specifically for resource replication: when a file is uploaded, the owning node pushes a `RESOURCE_SHARED` P2P message to every peer, and each peer fetches and copies the file into its own `uploads/<nodeId>/` directory (so the file becomes available locally on every node, not just where it was uploaded).
- **Streaming (`distributed/streaming/socketManager.js`)** — the Socket.IO layer: room join/leave, chat, and WebRTC signaling (`webrtc_offer`/`answer`/`ice`, relayed only — actual media is P2P browser-to-browser). Also subscribes to MessageBus events so that activity on other nodes gets re-emitted to this node's locally connected sockets.

**Peer discovery is dual-path:** the Gateway maintains an in-memory node registry (`server/gateway/server.js`) that nodes register/heartbeat with every 5s (marked OFFLINE after 10s silence), and pushes the resulting peer list to every node via `POST /api/peers` whenever registry changes. Independently, nodes also run a **gossip protocol** (`BaseNode.startGossip`, every 10s) that exchanges peer lists node-to-node directly — this is a fallback so nodes can still discover each other if the Gateway goes down (it falls back further to hardcoded ports 5001-5003 if a node has zero known peers).

**Client failover:** `client/src/pages/StudyRoom.jsx` listens for its Socket.IO `disconnect` event, queries the Gateway's `/health` for another ONLINE node, and reconnects to it (changing `nodeId`/`nodePort` state re-triggers the connection `useEffect`) — this is how the app demonstrates fault tolerance when a node process is killed.

**Monitoring dashboard:** `client/src/pages/Dashboard.jsx` (route `/admin/distributed`) subscribes to the Gateway's own Socket.IO stream (`node_status`, `network_event`) to render a live SVG topology graph and a filterable (RPC/MESSAGE/P2P/STREAM) event log. Every RPC call, P2P send, and node registration posts an event to the Gateway's `/api/monitor/message`, which is what feeds this view — if adding a new cross-node interaction, follow the existing pattern of also POSTing a monitor event so it shows up on the dashboard.

**Known dead/unused code:** `server/controllers/roomController.js` exists but is not wired into any route (no `server/gateway/routes` file requires it — that directory, along with `server/config`, `server/middleware`, `server/services`, `server/utils`, `server/gateway/services`, `shared/constants`, and `shared/protocols` are empty scaffold directories left over from initial setup). Room creation is actually handled client-side in `LandingPage.jsx` (it picks a random online node and a random `DS-###` room ID, with no server-side room registration at all).

**Mongoose models (`server/models/index.js`):** `User`, `Room`, `Resource`, `Message`, `NodeState` — defined but only `Resource` and `Message` are actually used (in `BaseNode.js` upload handler and `socketManager.js` chat handler respectively); `Room` is imported by the unused `roomController.js`, and `NodeState`/`User` aren't referenced anywhere.

## Working in this repo

- When changing anything under `server/distributed/`, remember each Node process loads its own copy — there's no shared memory between Node A/B/C, only what flows through RPC/MessageBus/P2P/Socket.IO. Don't assume state set on one node is visible on another without going through one of those channels.
- `uploads/<nodeId>/` directories are created lazily by Multer's `destination` callback and by replication in `peerManager.js` — they're gitignored, not pre-created.
- Ports are hardcoded as a convention across the codebase (Gateway 5000, Node A/B/C 5001-5003) in multiple places (root `package.json`, client fallback URLs, gossip fallback list). If changing a port, grep for the old value rather than assuming one config source controls it.
