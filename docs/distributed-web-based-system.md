# Distributed Web-Based System

This document formalizes something that's already true of the running application — it's a write-up of an existing architectural property, not a description of new code.

## What the concept means

A distributed web-based system presents users with a single, coherent web application, while the actual work is carried out by multiple independent backend processes working together. The defining property is **transparency**: a user interacting with the system through their browser should never need to know, or care, which specific backend process is actually serving them.

## How it appears in this project

```text
Browser
   |
   v
Gateway (GET /health — "which nodes are currently online?")
   |
   v
One of three interchangeable Node processes (node-A / node-B / node-C)
   |
   v
Classroom state, chat, resources, attendance — identical behavior
regardless of which node is handling the request
```

Concretely:

- **Node discovery is transparent.** `client/src/pages/LandingPage.jsx` and `client/src/pages/StudyRoom.jsx` call `GET /health` on the Gateway and pick a random ONLINE node. The user never sees a node picker, never types a hostname, never makes this choice themselves.
- **Every node is functionally identical.** `server/nodes/BaseNode.js` is the same class running as `node-A`, `node-B`, and `node-C` — differing only in which `NODE_ID`/`NODE_PORT` environment variables they were started with. There is no "teacher node" or "student node"; role is a property of the logged-in user (carried in their JWT), never of which process they happen to be connected to.
- **State doesn't live on one node.** Classroom membership, chat history, resources, and attendance are all backed by MongoDB — any node can serve any classroom's data correctly, not just the node a particular student originally connected through. Cross-node consistency is handled by the MessageBus (real-time notification) and direct Mongo reads (source of truth) working together — see `docs/distributed-concepts.md`'s Message-Oriented Communication entry.
- **Failure is transparent too.** If the node a user is connected to goes down, `StudyRoom.jsx`'s Socket.IO `disconnect` handler automatically queries the Gateway for another ONLINE node and reconnects — the user sees a brief "Reconnecting..." indicator, not an error page, and their classroom state (admission status, chat history, attendance) is unaffected because none of it was tied to the node that failed.

## Why this matters for the project as a whole

This is the property that makes every other distributed-systems concept in this project *meaningful* rather than cosmetic. RPC, the message bus, leader election, and the logical clocks all exist specifically to maintain this transparency — to make three independent processes behave, from the user's point of view, like one reliable system. A student joining a classroom has no reason to think about any of this; they just think "I joined my class."

## How to demonstrate

1. Open the classroom as two different users (e.g. two browser profiles) — note in the header that each is "Connected via: node-X" with potentially *different* node IDs for the same classroom.
2. Confirm both see the same chat, the same participant list, the same shared resources, in real time, despite being served by different processes.
3. Kill the node one of them is connected to. Confirm their client silently reconnects to a different node and their session continues uninterrupted.
