# AWS — Case Study

This project does not deploy to AWS. This document is a deployment-architecture discussion: how the system's *actual* topology (Gateway + 3 symmetric node processes + MongoDB + browser clients) would map onto real AWS infrastructure if it were deployed, and what distributed-systems principles AWS itself embodies. It is written for understanding and discussion, not as a build spec.

## 1. What AWS is, and the distributed-systems principle it embodies

AWS is a collection of managed infrastructure services — compute (EC2), storage (S3, EBS), networking (VPC), and dozens of higher-level managed services — that let you rent and compose the building blocks of a distributed system instead of operating physical servers yourself. The core distributed-systems principle it embodies is **abstraction over the hard parts of distribution**: EC2 gives you a VM without you needing to rack hardware; S3 gives you a durable, replicated, highly-available object store without you needing to implement replication yourself; a VPC gives you network isolation and routing without you needing to run your own switches.

This is directly relevant to this project because this project does, by hand, several things AWS offers as managed services: our Gateway's node registry is a tiny hand-rolled version of what a service-discovery product does; our gossip protocol and RPC circuit breaker are a tiny hand-rolled version of what a service mesh does; our leader election is a tiny hand-rolled version of what a consensus service (like a managed etcd or AWS's own internal coordination primitives) does. Studying AWS is useful precisely *because* this project reimplements, at a small and understandable scale, problems AWS solves industrially.

## 2. How this project's topology would map onto EC2

A correction worth being explicit about: it is tempting to assume the three node processes could sit in a private subnet, with only the Gateway facing the internet — that's how a typical load-balanced web backend looks. **This project is not that shape.** Per its own architecture (see the root `CLAUDE.md`), the browser connects *directly* to whichever node the Gateway's `/health` assigns it — for chat, file RPC, Socket.IO, everything — and only asks the Gateway for that initial assignment. So all four processes need a public-facing address, not just the Gateway:

```text
                              INTERNET
                                 |
              browsers hit the Gateway once for /health,
              then connect DIRECTLY to whichever node they
              were assigned — not through the Gateway again
                 /            |            |            \
                v             v            v             v
          EC2: Gateway   EC2: Node A  EC2: Node B   EC2: Node C
         (public IP)     (public IP)  (public IP)   (public IP)
                 \             |            |            /
                  +------------+------------+-----------+
                       private-subnet-style traffic:
                  RPC, MessageBus, gossip, leader election,
                    lock coordination — node-to-node only
                       |
                  MongoDB (Atlas, or a
                  self-managed replica set
                  on separate EC2 instances)
```

- **All four instances need a public IP** (or a public DNS name) that the browser can reach, since node discovery only picks *which* node to talk to — it doesn't proxy the actual traffic. This is the opposite of the usual "only the load balancer is public" shape, and it's a direct, load-bearing consequence of the "distributed web-based system" property this project demonstrates (see `docs/distributed-web-based-system.md`): the client talks to whichever node it's transparently handed, not to one fixed entry point.
- **Each node's app port (5001/5002/5003) must accept inbound traffic from `0.0.0.0/0`** (or at least from wherever students' browsers connect from) — this is genuinely public traffic, not something that can be hidden behind a private subnet.
- **Node-to-node ports still get restricted**, just not by "public vs. private subnet" — the inter-node traffic (RPC on the same port, MessageBus, gossip, P2P) should be security-group-scoped to only the Gateway's and the other nodes' security groups, even though the port itself is open to the internet for the browser traffic. A security group rule is per-source, not per-port, so "5001 open to browsers" and "5001 restricted to peers for RPC" aren't actually in conflict — the port is the same, the point is that nothing *requires* locking the whole port down, since the application layer (JWT auth, admission checks) is what actually gates access, the same way it already does for every other request.
- `NODE_HOST`, `GATEWAY_URL`, and `PEER_NODES` (see `server/services/peerDiscoveryService.js`, `server/nodes/BaseNode.js`) are the environment variables that make each node's self-reported address configurable instead of assuming `localhost` — this used to be a gap in this project; it's now implemented, defaulting to the old localhost-only behavior when unset so local dev is unaffected.
- SSH access (port 22) is the one thing that genuinely should be source-restricted to an administrator's IP, on every instance.

## 3. File storage

The project went through two approaches here before settling on the current one — worth recording *why*, not just what changed.

**Tried and reverted — AWS S3.** A single shared bucket, uploaded to directly from whichever node received the file, downloaded via presigned URLs. This is literally what the managed-service abstraction described in Section 1 is for: S3 handles durability and availability itself, so the application doesn't need to implement replication. It was reverted because durability was never actually needed: a shared file in this project only matters for the lifetime of the classroom session it was shared in — nobody downloads it again afterward — so paying for a durable, replicated cloud store (and taking on a real dependency on AWS credentials) bought nothing. It also *reduced* how much of the "distributed file sharing" problem this project demonstrates itself solving, since AWS was doing the hard part instead of the application.

**Current — in-memory per node + RPC, no replication, no disk, no cloud.** The node that receives an upload keeps the raw bytes in its own process memory (`node.fileStore`, a plain `Map<resourceId, buffer>` in `BaseNode.js`) — nothing is written to disk and nothing is pushed to peers. When a client connected to a *different* node needs to download that file, that node has only the file's metadata (synced via Mongo + the MessageBus, same as every other piece of classroom state) — it doesn't have the bytes, so it asks the owning node for them directly over **RPC** (`findResource`/`getResource` in `server/services/resourceService.js`, via `server/distributed/rpc/`), and the owning node's RPC response carries the bytes back (as a base64 data URL, since the RPC transport is JSON over HTTP). If the owning node's process has since restarted, the bytes are simply gone — accepted, since nothing in this project needs a file to outlive the node that received it, let alone the session.

This makes the RPC layer genuinely load-bearing for file sharing rather than a demo bolted on next to a real storage backend: the *only* way a second node ever gets a file's bytes is by asking the first node for them, node-to-node, synchronously. It also means a rejected or session-ended file has no storage to clean up anywhere — the memory is freed (`node.fileStore.delete(...)`) and that's the entire lifecycle.

## 4. What would actually need to change for a real deployment

Being specific, not aspirational, about the gap between "runs locally" and "runs on 3 EC2 instances":

1. ~~No more hardcoded `localhost`~~ — **done.** `BaseNode.js`'s `gatewayUrl` and each node's self-reported host are now driven by `GATEWAY_URL` and `NODE_HOST` env vars, defaulting to the old localhost-only behavior when unset so local dev is unaffected. Verified live: overriding `NODE_HOST`/`GATEWAY_URL` on one node and confirming the Gateway recorded the overridden address, with the rest of the system (cross-node RPC, leader election) unaffected.
2. ~~A `PEER_NODES` environment variable~~ — **done.** The gossip fallback now reads an optional static seed list (`node-A@10.0.1.5:5001,...`) instead of assuming every peer is on `localhost` at ports 5001-5003; Gateway-mediated discovery remains the primary path and still works unchanged.
3. **Docker** — not built in this project, but the config-via-environment-variables pattern (already used for `MONGODB_URI`, `JWT_SECRET`, and now `NODE_HOST`/`GATEWAY_URL`/`PEER_NODES`) is the right shape for one image to run as any of the four processes, differing only by env vars.
4. **Health-check-based failure recovery at the infrastructure level** (e.g., an Auto Scaling Group replacing a crashed EC2 instance) is a different, complementary layer to the application-level failure handling (leader election, RPC circuit breaker, client-side failover) this project already implements — AWS would handle "the machine died," the application already handles "the process is unreachable." One related gap *was* found and fixed during end-to-end testing: the Gateway's node registry lived only in memory and didn't resurrect an already-running node after the Gateway itself restarted — heartbeats now self-register an unrecognized node, so a Gateway bounce (a redeploy, an ASG replacement) no longer permanently orphans every node that was already running.

## 5. Cost and scope discipline

If this were ever actually deployed for a live demonstration: the smallest reasonable instance size (e.g. `t3.micro` or `t3.small`) for all four EC2 instances (Gateway + 3 nodes), no NAT Gateway unless strictly required, no managed Kubernetes, and instances stopped or terminated immediately after the demonstration — this is explicitly an academic demonstration, not a production workload, and the infrastructure choices should reflect that.
