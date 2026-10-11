# Distributed Systems Academic Documentation

This document maps the theoretical concepts from Unit 1 and Unit 2 to the actual implementation of the FA-Project. It is designed to assist in viva preparation.

---

## Unit 1

### Definition of Distributed Systems
**1. What it means theoretically:** A distributed system is a collection of independent computers that appears to its users as a single coherent system. 
**2. Where it appears:** The entire architecture, consisting of multiple backend nodes (`Node A`, `Node B`, `Node C`) and a central `Gateway`.
**3. Why it is appropriate:** A decentralized architecture prevents a single server from being a bottleneck for all study rooms and resource sharing.
**4. Which files implement it:** `server/nodes/BaseNode.js`, `server/gateway/server.js`.
**5. How to demonstrate:** Start multiple nodes and view the dashboard topology where independent backend instances coordinate to provide the "Study Room" abstraction to the frontend.
**Status:** **IMPLEMENTED**

### Goals
**1. What it means theoretically:** Key goals include resource sharing, transparency (hiding distribution), openness, concurrency, scalability, and fault tolerance.
**2. Where it appears:** 
*   **Resource Sharing:** Users can upload and download files across nodes.
*   **Concurrency:** Multiple users can chat and stream video simultaneously.
*   **Transparency:** Users request a file by name, unaware of which node actually hosts it.
**3. Why it is appropriate:** Study rooms require real-time concurrent interactions and seamless sharing of study materials regardless of which node a user connects to.
**4. Which files implement it:** `server/distributed/p2p/peerManager.js`, `server/controllers/roomController.js`.
**5. How to demonstrate:** Upload a file on Node A and immediately download it via Node B.
**Status:** **IMPLEMENTED**

### Types
**1. What it means theoretically:** Distributed Computing Systems (Cluster/Grid), Distributed Information Systems (Transaction processing/Enterprise application integration), and Distributed Pervasive Systems.
**2. Where it appears:** This project primarily aligns with Distributed Information Systems, integrating independent nodes to share information (resources, chat) and WebRTC streams.
**3. Why it is appropriate:** We are integrating independent node databases (MongoDB instances or collections) and states.
**4. Which files implement it:** Entire architecture.
**5. How to demonstrate:** Show the dashboard network topology.
**Status:** **IMPLEMENTED**

### Architecture
**1. What it means theoretically:** The organization of components. Examples include Client-Server, Peer-to-Peer, and Hybrid.
**2. Where it appears:** In this project, it's a Hybrid Architecture combining Client-Server (browser to node) and Peer-to-Peer (node to node).
**3. Why it is appropriate:** Allows simple client connections (browsers) while distributing backend load securely among trusted peers.
**4. Which files implement it:** `server/gateway/server.js`, `client/src/pages/StudyRoom.jsx`.
**5. How to demonstrate:** Show the dashboard network topology visualizing the mesh connections between backend nodes, alongside a browser connecting to a specific node.
**Status:** **IMPLEMENTED**

### Design Issues
**1. What it means theoretically:** Challenges such as naming, communication, fault tolerance, security, and consistency.
**2. Where it appears:** 
*   **Fault Tolerance (Basic):** RPC requests catch failures and the dashboard tracks offline status.
*   **Consistency:** Eventual consistency is maintained via the MessageBus.
**3. Why it is appropriate:** Distributed systems naturally face partial failures and state delays.
**4. Which files implement it:** `client/src/pages/StudyRoom.jsx` (RPC catches).
**5. How to demonstrate:** Kill a node process and observe the Dashboard marking it as "OFFLINE", and the frontend gracefully warning the user on upload/download failure.
**Status:** **PARTIALLY IMPLEMENTED (Basic Awareness)**. *Note: Advanced mechanisms like leader election, automatic failover, and strong consistency models are RESERVED FOR FA-2.*

### Middleware
**1. What it means theoretically:** Software that sits between the OS and applications, providing a common abstraction for distributed communication.
**2. Where it appears:** The `MessageBus` acts as our custom middleware, abstracting away the complex Axios POST requests for inter-node communication.
**3. Why it is appropriate:** It simplifies the code for broadcasting events (like `USER_JOINED`) by hiding the network transport details from the business logic.
**4. Which files implement it:** `server/distributed/messaging/messageBus.js`.
**5. How to demonstrate:** Point to the `publish` method in code, and show how easily a chat message is distributed across nodes.
**Status:** **IMPLEMENTED**

### Distributed Multimedia
**1. What it means theoretically:** Systems that handle continuous media types (audio, video) requiring synchronization and Quality of Service (QoS).
**2. Where it appears:** The one-to-one audio/video call and screen sharing functionalities.
**3. Why it is appropriate:** Study rooms are highly collaborative and require continuous media streaming.
**4. Which files implement it:** `client/src/pages/StudyRoom.jsx` (WebRTC).
**5. How to demonstrate:** Start a video call and share the screen in the Study Room.
**Status:** **IMPLEMENTED**

---

## Unit 2

### Communication Fundamentals
**1. What it means theoretically:** How nodes exchange information (protocols, synchronous vs asynchronous, transient vs persistent).
**2. Where it appears:** We utilize HTTP (Synchronous/Transient) for RPC, and WebSockets (Asynchronous/Transient) for signaling and real-time events.
**3. Why it is appropriate:** Combining HTTP for guaranteed request/response (finding a file) and WebSockets for low-latency events (chat) optimizes network usage.
**4. Which files implement it:** `server/distributed/streaming/socketManager.js`, `server/distributed/rpc/rpcProtocol.js`.
**5. How to demonstrate:** The dashboard visualizes `RPC` vs `MESSAGE` vs `P2P` events as they happen.
**Status:** **IMPLEMENTED**

### RPC
**1. What it means theoretically:** Remote Procedure Call allows a program to execute a subroutine in another address space without coding network details.
**2. Where it appears:** Used for resource discovery (`getResource`) across the node network.
**3. Why it is appropriate:** When a user requests a file not located on their connected node, the node must synchronously ask other nodes for the file metadata and URL.
**4. Which files implement it:** `server/distributed/rpc/rpcProtocol.js`, `server/distributed/rpc/rpcServer.js`.
**5. How to demonstrate:** Upload a file to Node A. Connect to Node B and request a download. The dashboard will visualize an "RPC" event between Node B and Node A.
**Status:** **IMPLEMENTED**

### Message-Oriented Communication
**1. What it means theoretically:** Communication via asynchronous messages, often using publish-subscribe patterns.
**2. Where it appears:** The `MessageBus` handles propagation of `CHAT_MESSAGE` and `USER_JOINED` across all active nodes.
**3. Why it is appropriate:** Chat messages don't require synchronous blocking responses. They just need to be delivered to all interested parties (publish/subscribe to the room).
**4. Which files implement it:** `server/distributed/messaging/messageBus.js`.
**5. How to demonstrate:** Send a chat message. The dashboard will show a `MESSAGE` event propagating across the nodes.
**Status:** **IMPLEMENTED**

### Stream-Oriented Communication
**1. What it means theoretically:** Continuous transmission of data, where timing is crucial (e.g., audio/video streaming).
**2. Where it appears:** The audio, video, and screen sharing streams between peers.
**3. Why it is appropriate:** Real-time video/audio requires low latency and UDP-based continuous transmission.
**4. Which files implement it:** `client/src/pages/StudyRoom.jsx` (`getUserMedia`, `getDisplayMedia`).
**5. How to demonstrate:** Toggle the camera and microphone in the Study Room.
**Status:** **IMPLEMENTED**

### P2P Messaging
**1. What it means theoretically:** A decentralized communication model where nodes are equally privileged, equipotent participants.
**2. Where it appears:** Background state synchronization and resource metadata distribution among backend nodes.
**3. Why it is appropriate:** Prevents a single node from becoming a bottleneck for system-wide state changes.
**4. Which files implement it:** `server/distributed/p2p/peerManager.js`.
**5. How to demonstrate:** Visualized as `P2P` events on the Dashboard when nodes sync their resource tables.
**Status:** **IMPLEMENTED**

### WebRTC
**1. What it means theoretically:** An open framework for the web that enables Real-Time Communications in the browser using P2P connections.
**2. Where it appears:** The signaling (`webrtc_offer`, `webrtc_answer`, `webrtc_ice`) and actual media transmission in the classroom's video call.
**3. Why it is appropriate:** It allows direct browser-to-browser media streaming, minimizing backend server load and latency.
**4. Which files implement it:** `client/src/pages/StudyRoom.jsx`, `server/distributed/streaming/socketManager.js`.
**5. How to demonstrate:** Click "Start Video Call" with 2–3 participants connected across different nodes. Every participant establishes a direct P2P connection to every other participant (full mesh — each pair negotiates independently; signaling is routed node-to-node for cross-node pairs).
**Status:** **IMPLEMENTED** (full mesh, not an SFU — deliberately scoped to small classroom sizes; see Unit 4 Distributed File System note below for the same "simplified, not industrial-scale" framing applied elsewhere in this project)

---

## Unit 3

### Logical Clocks / Lamport's Algorithm
**1. What it means theoretically:** A way to establish a partial ordering of events in a distributed system without relying on synchronized physical clocks — each process keeps an integer counter, incremented on a local event, stamped on send, and set to `max(local, received) + 1` on receive.
**2. Where it appears:** Every message that crosses the `MessageBus` or the RPC layer carries a `lamportTs` field; attendance JOIN/LEAVE events are stamped with the value at the moment they're recorded.
**3. Why it is appropriate:** The clock rides the *existing* message envelope rather than a separate side-channel, so it reflects genuine causal ordering across chat, admission, resource sharing, election, and locking traffic — not just a demo-only counter.
**4. Which files implement it:** `server/services/logicalClocks.js` (the `LamportClock` class), `server/distributed/messaging/messageBus.js`, `server/distributed/rpc/rpcClient.js` / `rpcServer.js`, `server/services/attendanceService.js`.
**5. How to demonstrate:** Open `/health` on two different nodes while students join a classroom from each — the Lamport values climb and interleave consistently with causal order; the teacher's Attendance view shows each join's Lamport number.
**Status:** **IMPLEMENTED**

### Vector Clocks
**1. What it means theoretically:** An extension of logical clocks using one counter per node (`{nodeId: count}`), which — unlike a single Lamport scalar — can distinguish "causally ordered" from "genuinely concurrent": two events where neither vector dominates the other happened independently, with no message between them.
**2. Where it appears:** Applied specifically to attendance — each JOIN event is stamped with a snapshot of the recording node's vector clock, and `classroomService.getAttendanceReport` pairwise-compares users' latest-JOIN vectors to flag concurrent joins.
**3. Why it is appropriate:** Rather than a disconnected toy ("compare two arbitrary vectors"), this detects a real distributed-systems phenomenon in a feature that already exists: two students joining via different nodes during a brief partition, before any message has synced the two nodes' knowledge of each other's join.
**4. Which files implement it:** `server/services/logicalClocks.js` (`vcIncrement`/`vcMerge`/`vcCompare`), same MessageBus/RPC hook points as the Lamport clock, `server/services/classroomService.js`.
**5. How to demonstrate:** Stop node-B, admit/join a student via node-A (the broadcast to node-B is lost — MessageBus has no retry), restart node-B, join a second student via node-B before anything re-syncs. The Attendance view flags both as **Concurrent** — a genuine result, not staged click-timing.
**Status:** **IMPLEMENTED**

### Global State
**1. What it means theoretically:** Since no single node has the full picture of a distributed system by default, "global state" means aggregating each node's local view into one combined snapshot — who's online, what the clocks say, who's leader, what's locked.
**2. Where it appears:** The Gateway's existing heartbeat pipe (already used for node status) now also carries each node's leader belief, Lamport clock, physical clock offset, and active lock keys; `GET /api/global-state` and a new Dashboard panel aggregate them.
**3. Why it is appropriate:** Cheap specifically because it reuses the heartbeat write path that already existed for `users`/`resources` — no second polling mechanism.
**4. Which files implement it:** `server/gateway/services/registryService.js` (`getGlobalState`, majority-vote leader resolution), `server/gateway/controllers/registryController.js`, `client/src/pages/Dashboard.jsx`.
**5. How to demonstrate:** Open the Dashboard — the Global State panel shows the current leader, every node's Lamport clock, and any active locks, updating live via the Gateway's existing Socket.IO stream.
**Status:** **IMPLEMENTED**

### Leader Election (Bully Algorithm)
**1. What it means theoretically:** When multiple equal peers need exactly one coordinator, the Bully algorithm elects the highest-ranked *alive* node — any node that notices the current leader is unreachable starts an election by querying higher-ranked peers; if none respond, it declares itself leader.
**2. Where it appears:** Nodes are ranked by their trailing letter (`node-A` < `node-B` < `node-C`). `ELECTION`/`ELECTION_OK` ride the existing `RpcClient` (a real request/response primitive with its own timeout and circuit breaker) rather than `MessageBus` (which has no reply mechanism at all); `COORDINATOR` is a genuine fire-and-forget broadcast over `MessageBus`.
**3. Why it is appropriate:** Reuses existing, already-tested transport instead of inventing parallel machinery — the RPC circuit breaker (opens after 2 consecutive failures) *is* the failure detector, which also satisfies the Beacon/Heartbeat requirement below rather than needing a fourth redundant mechanism.
**4. Which files implement it:** `server/services/leaderElectionService.js`, `ping`/`electionPing` RPC methods registered in `server/nodes/BaseNode.js`.
**5. How to demonstrate:** Kill the current leader's process — the remaining nodes detect the failure via a failed `ping` RPC, run an election, and converge on a new leader within a few seconds (visible on the Dashboard's Global State panel and the leader crown on the winning node's card). Restart the killed node: if it was the highest-ranked node, it correctly reclaims leadership via a fresh election broadcast — that's the Bully algorithm's defining, intentional property, not a bug.
**Status:** **IMPLEMENTED**

### Distributed Mutual Exclusion
**1. What it means theoretically:** Guaranteeing that only one process at a time can hold a lock on a shared resource across separate machines, coordinated through a single arbiter (here, the elected leader) rather than a purely local mutex.
**2. Where it appears:** Wrapped around the file-share approval decision (`resourceService.decideShareRequest`) — a teacher's approve/reject action acquires a lock on the `resourceId` from the leader before writing, and releases it immediately after.
**3. Why it is appropriate:** Rather than a disconnected `/lock` demo button, this closes a real race: without it, the same pending share request could be approved and rejected at once from two sessions. `acquireLock`/`releaseLock` are RPC methods on the leader (`Map<resourceKey, holder>`), so a second concurrent decision is cleanly told "already in progress," not allowed to race.
**4. Which files implement it:** `server/services/leaderElectionService.js` (`acquireLock`/`releaseLock`), `server/services/resourceService.js` (`withResourceLock`).
**5. How to demonstrate:** Fire two decisions for the same pending file at once (e.g. two tabs as the teacher) — exactly one succeeds, the other receives a 409 "another decision is already in progress" response.
**Status:** **IMPLEMENTED**

### Beacon / Heartbeat Protocol
**1. What it means theoretically:** Periodic "I'm alive" messages between nodes, with a timeout-based conclusion that a silent node is down.
**2. Where it appears:** This project already has two heartbeat mechanisms from Unit 1/2 (Gateway-mediated registry heartbeat, and gossip). Rather than add a *third, redundant* standalone peer-to-peer beacon, this requirement is satisfied by the leader-election failure detector above — a direct node-to-node `ping` RPC every 5 seconds against the current leader specifically, with the RPC circuit breaker providing the `last_seen`/timeout/`OFFLINE` semantics this concept describes.
**3. Why it is appropriate:** A fourth failure-detection mechanism would be redundant machinery, not more capability — this is a deliberate decision, not an omission.
**4. Which files implement it:** `server/services/leaderElectionService.js` (`startLeaderPing`), reusing `server/distributed/rpc/rpcClient.js`'s existing circuit breaker.
**5. How to demonstrate:** Same as the Leader Election demonstration above — the failure detection *is* this beacon protocol in action.
**Status:** **IMPLEMENTED** (via the leader-election failure detector, by design — see note above)

### Clock Synchronization (Cristian's Algorithm)
**1. What it means theoretically:** Estimating the offset between a node's physical/wall-clock and a reference clock by timing a round-trip request and assuming the network delay was split evenly each way — distinct from logical clocks, which establish order, not milliseconds.
**2. Where it appears:** Each node periodically pings the Gateway's `/health` endpoint (which already returns a timestamp), measures round-trip time, and estimates its offset.
**3. Why it is appropriate:** Deliberately the most isolated item in this unit — touches nothing else, never adjusts the real system clock, display-only.
**4. Which files implement it:** `server/services/clockSyncService.js`.
**5. How to demonstrate:** `/health` and the Dashboard's Global State / node cards show each node's estimated offset in milliseconds, clearly labeled and visually separate from the Lamport clock values next to it.
**Status:** **IMPLEMENTED**
