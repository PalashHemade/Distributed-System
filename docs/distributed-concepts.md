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
**2. Where it appears:** The signaling (`webrtc_offer`, `webrtc_answer`, `webrtc_ice`) and actual media transmission in the Study Room.
**3. Why it is appropriate:** It allows direct browser-to-browser media streaming, minimizing backend server load and latency.
**4. Which files implement it:** `client/src/pages/StudyRoom.jsx`, `server/distributed/streaming/socketManager.js`.
**5. How to demonstrate:** Click "Start Video Call". The browser establishes a direct P2P stream to the other participant. 
**Status:** **IMPLEMENTED**
