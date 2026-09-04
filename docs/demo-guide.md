# FA-Project Academic Demonstration Guide

This guide provides a structured 5-10 minute demonstration flow designed to effectively showcase the distributed systems concepts implemented in this project (FA-1).

## Prerequisites & Startup

Open 5 separate terminal windows to simulate the distributed environment.

**1. Start the Gateway Node**
```bash
cd server
node gateway/server.js
```

**2. Start Backend Node A**
```bash
cd server
node nodes/nodeA/server.js
```

**3. Start Backend Node B**
```bash
cd server
node nodes/nodeB/server.js
```

**4. Start Backend Node C**
```bash
cd server
node nodes/nodeC/server.js
```

**5. Start the React Frontend**
```bash
cd client
npm run dev
```

> **Note:** The frontend typically starts on `http://localhost:5173`. Open this URL in your web browser.

---

## Demonstration Flow (5-10 Minutes)

### Phase 1: Distributed Architecture & Simultaneous Operation (1 Min)
1. Navigate to the **Dashboard** in the browser.
2. **Observe:** The "Network Topology" visualization immediately shows the Gateway and nodes (A, B, and C) connecting.
3. **Discuss:** Explain how this demonstrates a hybrid architecture—nodes form a P2P mesh among themselves while the Gateway acts as an entry point for dashboard monitoring.

### Phase 2: WebRTC, Streaming & Messaging (3 Mins)
1. Open **three separate browser windows** (or use incognito modes).
2. Connect Window 1 to a Study Room via **Node A**. Connect Window 2 to the same Study Room via **Node B**.
3. **Messaging:** Send a chat message from User 1. 
   - *Observe:* The message instantly appears for User 2.
   - *Dashboard check:* Show the animated `MESSAGE` event propagating from Node A to Node B via the Message Bus (Publish/Subscribe).
4. **WebRTC:** Click "Start Video Call" in Window 1.
   - *Observe:* WebRTC Signaling (`offer`, `answer`, `ice` candidates) routes through the WebSocket backend.
   - *Observe:* The local and remote video streams connect. Toggle the audio/video buttons to demonstrate continuous stream-oriented communication.
   - *Optional:* Click "Share Screen" to seamlessly replace the camera stream.

### Phase 3: P2P, RPC & Distributed Resources (2 Mins)
1. In Window 1 (Node A), upload a test file (e.g., `notes.pdf`) to the study room.
2. **P2P Sync:**
   - *Dashboard check:* Observe a `P2P` event where Node A synchronizes its resource metadata with Nodes B and C.
3. **RPC Retrieval:** In Window 2 (Node B), click the "RPC Download" button for the file uploaded by User 1.
   - *Observe:* Node B does not physically have the file. It executes a synchronous Remote Procedure Call (`RPC`) to Node A to fetch the file URL.
   - *Dashboard check:* Observe the red `RPC` event line flash between Node B and Node A. 
   - *Observe:* The file downloads successfully in Window 2.

### Phase 4: Node Failure & Recovery (2 Mins)
1. Go to the terminal running **Node B** and terminate the process (`Ctrl+C`).
2. **Observe Dashboard:** The Gateway's heartbeat monitor detects the missing node and marks Node B as **OFFLINE** (red circle).
3. **Verify Continued Operation:** In Window 1 (connected to Node A), attempt to upload another file.
   - *Observe:* The upload succeeds, proving the rest of the distributed system remains fully operational.
4. **Graceful Failure:** In Window 3 (connected to Node C), try to download a file that was physically hosted only on Node B.
   - *Observe:* The RPC request gracefully times out, and the user receives a polite alert: *"Download failed: Could not locate across the distributed network or RPC timed out"*.
5. **Recovery:** Restart **Node B** in the terminal (`node nodes/nodeB/server.js`).
   - *Observe:* Node B rejoins the mesh, updates its status to **ONLINE** on the dashboard, and begins accepting connections and RPC requests again.

---
*End of Demonstration.*
