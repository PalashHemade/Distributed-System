# Project Architecture Documentation

This document contains detailed architectural diagrams representing the FA-Project's distributed system implementation.

## 1. Overall Architecture

```mermaid
graph TD
    Client1[Browser Client 1] --> NodeA[Backend Node A]
    Client2[Browser Client 2] --> NodeB[Backend Node B]
    NodeA <-->|P2P Sync / RPC / MessageBus| NodeB
    NodeA <-->|P2P Sync / RPC / MessageBus| NodeC[Backend Node C]
    NodeB <-->|P2P Sync / RPC / MessageBus| NodeC
    
    NodeA --> Gateway[Gateway Node]
    NodeB --> Gateway
    NodeC --> Gateway
    
    Dashboard[Dashboard Client] --> Gateway
```

## 2. Distributed Node Architecture

```mermaid
graph TD
    subgraph Backend Node
        API[Express API Routes]
        RPC[RPC Protocol/Server]
        Socket[Socket.IO Manager]
        P2P[Peer Manager]
        MsgBus[Message Bus]
        DB[(Local MongoDB)]
        
        API --> DB
        API --> MsgBus
        Socket --> MsgBus
        RPC --> P2P
        P2P --> MsgBus
    end
```

## 3. RPC Request/Response (Resource Check)

```mermaid
sequenceDiagram
    participant U as User
    participant A as Node A
    participant B as Node B

    U->>A: Download Resource /find/file.pdf
    A->>B: RPC POST /api/rpc/request (GET_RESOURCE_URL)
    B-->>A: Resource Metadata (URL)
    A-->>U: Resource URL
```

## 4. Chat Message Propagation

```mermaid
sequenceDiagram
    participant C1 as Client 1 (Connected to Node A)
    participant A as Node A
    participant B as Node B
    participant C2 as Client 2 (Connected to Node B)

    C1->>A: Socket: chat_message
    A->>A: Broadcast to local clients
    A->>B: MessageBus POST /api/messaging/receive
    B->>C2: Socket: chat_message
```

## 5. Stream Communication

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant Gateway as Gateway
    participant Dash as Dashboard

    C1->>Gateway: POST /api/monitor/message
    Gateway->>Dash: Socket: network_event
```

## 6. P2P Node Communication

```mermaid
sequenceDiagram
    participant A as Node A
    participant B as Node B
    
    Note over A,B: Background Sync
    A->>B: POST /api/p2p/sync
    B-->>A: Node B Resource State
    A->>A: Update Routing Table
```

## 7. Distributed Resource Retrieval

```mermaid
sequenceDiagram
    participant U as User
    participant A as Node A
    participant B as Node B

    U->>A: Upload file.pdf
    A->>A: Save to local DB & filesystem
    A->>B: Publish RESOURCE_SHARED via MessageBus
    B->>B: Update remote state
```

## 8. WebRTC Signaling

```mermaid
sequenceDiagram
    participant C1 as Client 1 (Node A)
    participant A as Node A
    participant B as Node B
    participant C2 as Client 2 (Node B)

    C1->>A: Socket: webrtc_offer
    A->>B: MessageBus: webrtc_offer
    B->>C2: Socket: webrtc_offer
    
    C2->>B: Socket: webrtc_answer
    B->>A: MessageBus: webrtc_answer
    A->>C1: Socket: webrtc_answer
    
    C1->>A: Socket: webrtc_ice
    A->>B: MessageBus: webrtc_ice
    B->>C2: Socket: webrtc_ice
```

## 9. WebRTC Peer Connection

```mermaid
graph LR
    subgraph Browser 1
        Media1[Camera/Mic/Screen]
    end
    subgraph Browser 2
        Media2[Camera/Mic/Screen]
    end
    
    Media1 <-->|Direct UDP/TCP P2P| Media2
```

## 10. Node Failure Scenario

```mermaid
sequenceDiagram
    participant U as User
    participant A as Node A (Failed)
    participant Gateway as Gateway
    participant Dash as Dashboard

    Note over A: Process crashes
    A-xGateway: Heartbeat missing
    Gateway->>Gateway: Mark Node A as OFFLINE
    Gateway->>Dash: Socket: node_status (A is OFFLINE)
    
    U->>A: Request RPC
    Note over U: Request timeout
    U->>U: Display graceful failure alert
```
