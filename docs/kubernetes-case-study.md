# Docker + Kubernetes — Case Study & Deployment Guide

This replaces the earlier AWS plan. The reasoning for the switch: AWS needs a payment method on file even for free-tier usage, and this project's four always-on processes (Gateway + 3 nodes) don't comfortably fit AWS's free-tier limit of 750 combined instance-hours/month if you want them running continuously rather than only during short demo windows. Docker + a local Kubernetes cluster has neither constraint — no billing account, no instance-hour ceiling, and it runs entirely on hardware you already have.

`docs/aws-case-study.md` and `docs/aws-deployment-guide.md` are left in place rather than deleted — they're still accurate as a *discussion* of what AWS deployment would involve (and the architectural corrections made while writing them, like nodes needing public reachability, apply here too), just not the path this project is actually taking.

---

## 1. What Docker and Kubernetes are, and the principle they embody

**Docker** packages an application with its exact runtime (Node.js version, OS libraries, installed dependencies) into one portable image, so "it works on my machine" becomes "it works in this container," anywhere a container runtime exists. **Kubernetes** is an orchestrator sitting on top of containers — it decides where each container runs, restarts it if it dies, and gives it a declarative spec (a YAML file saying "this is what should be running") instead of a sequence of manual commands.

The connection to this project is direct, not just thematic: this project's Gateway already does a small, hand-rolled version of what Kubernetes does — it registers nodes, tracks their health via heartbeat, and marks them OFFLINE after 10s of silence (`server/gateway/services/registryService.js`). Kubernetes' own node/pod health tracking, readiness probes, and automatic pod restarts are the same idea, built industrially instead of by hand. Studying this deployment is useful for the same reason the AWS case study was: it's a chance to see a hand-built mechanism next to the production-grade version of the same concept.

---

## 2. How this project's processes map onto Docker + Kubernetes concepts

| This project's concept | Docker/K8s equivalent |
|---|---|
| A running `node gateway/server.js` or `node nodes/nodeA/server.js` process | A **container**, built from one shared image (`server/Dockerfile`) — see §3 for why one image, not four |
| "Keep this process running, restart it if it crashes" (not built in this project at all — previously just a terminal window staying open) | A Kubernetes **Deployment** with `replicas: 1` |
| The project's own env-var-driven config (`NODE_ID`, `NODE_HOST`, `MONGODB_URI`, ...) | A **ConfigMap** (non-secret values) + a **Secret** (`MONGODB_URI`, `JWT_SECRET`) |
| Three *symmetric-but-distinct* node identities (not interchangeable — each has a fixed `NODE_ID` the Bully election ranks by) | Three separate Deployments (`node-a`, `node-b`, `node-c`), each pinned to `replicas: 1` — **not** one Deployment scaled to 3 replicas, which would be the wrong shape here (see the comment in `k8s/node-a-deployment.yaml`) |
| The Gateway's own node registry / heartbeat / OFFLINE detection | Kubernetes' pod liveness/readiness probes (`k8s/*-deployment.yaml`) — a second, platform-level version of the same health-tracking idea, running alongside the project's own |
| Grouping everything that belongs to this project | A dedicated **Namespace** (`distributed-study-room`) |

---

## 3. Why one Docker image, not four

The Gateway and the three node processes are the exact same codebase (`server/`) — they only differ in which entry file runs (`gateway/server.js` vs `nodes/nodeA/server.js`, etc.) and which env vars they're given. `server/Dockerfile` builds **one** image; each Kubernetes Deployment picks which process to run via `command:` override in its container spec. This mirrors the project's existing pattern (one `BaseNode` class, instantiated differently per entry file) rather than inventing a new one — four separate images would just be four copies of the same `node_modules`, four times the build time, with zero actual difference until a container actually starts.

The client (`client/Dockerfile`) is a genuinely different image — a multi-stage build that compiles the Vite SPA then serves the static output through nginx, since there's no Node.js process to run in production, just files to serve.

---

## 4. "Expose it on the same network" — why every pod uses `hostNetwork: true`

This project's defining architectural property (see `docs/distributed-web-based-system.md`) is that the browser connects **directly** to whichever node it's assigned — not through the Gateway, not through any reverse proxy. That property doesn't go away just because the processes are now in containers: every pod still needs to be reachable at a real, fixed address from any device on the network, including the browser itself.

The straightforward Kubernetes way to expose something is a `NodePort` Service, but that remaps the port (e.g. your app's 5001 becomes some Service's 30501 externally) — which would require this project to report a *different* port than it's actually listening on, a mismatch it isn't built for today (the self-reported `NODE_HOST`/port and the actual listen port are the same value — see `server/nodes/BaseNode.js`). Rather than add that complexity, every pod here sets `hostNetwork: true`, which makes the container bind directly to the host machine's own network interface — the exact same ports (5000/5001/5002/5003/8080) the app already uses in local dev, now reachable at `<your-machine's-LAN-IP>:<port>` from any other device on the network. This is literally what "expose it on the same network" means: anyone on your LAN can reach it, the same as if the process were just running natively on your laptop, just managed by Kubernetes instead of a terminal window.

**The tradeoff, stated plainly:** `hostNetwork: true` only behaves predictably on a **single-node cluster** — if two pods needing the same port landed on the same host, they'd conflict. This project's node-a/b/c pods use different ports (5001/5002/5003) specifically so this isn't an issue even on one node. A real multi-machine cluster (§8) would remove this constraint entirely by letting each node pod land on a genuinely different physical machine.

---

## 5. Prerequisites

- **Docker Desktop**, with its built-in Kubernetes enabled (Settings → Kubernetes → Enable Kubernetes) — this is the simplest path since `docker build` and `kubectl` then share the same image store automatically, no extra "load the image into the cluster" step. (If you'd rather use `minikube` or `kind` instead, see the note in §6 — it's one extra command per image, not a different workflow.)
- `kubectl` (installed alongside Docker Desktop's Kubernetes, or separately).
- Your MongoDB Atlas connection string and `JWT_SECRET` (reuse the ones from your local `.env`).
- **Atlas Network Access:** same requirement as the AWS plan — Atlas blocks all IPs by default; add your machine's IP (or `0.0.0.0/0` for the demo) in Atlas → Network Access.
- Your machine's LAN IP (`ipconfig` on Windows, look for "IPv4 Address"; `hostname -I` on Linux/WSL) — you'll substitute this into `k8s/configmap.yaml` and the client build command.

---

## 6. Build the images

From the repo root:

```bash
docker build -t study-room-server:local ./server
docker build -t study-room-client:local --build-arg VITE_GATEWAY_URL=http://<your-lan-ip>:5000 ./client
```

**If you're on Docker Desktop's built-in Kubernetes:** nothing else needed — the cluster already sees these images.

**If you're on `minikube` instead:** either build directly into minikube's own Docker daemon (`eval $(minikube docker-env)` before running the two `docker build` commands above), or build normally and then:
```bash
minikube image load study-room-server:local
minikube image load study-room-client:local
```

**If you're on `kind` instead:**
```bash
kind load docker-image study-room-server:local
kind load docker-image study-room-client:local
```
Skipping this step on minikube/kind is the single most common cause of `ErrImageNeverPull`/`ImagePullBackOff` — the manifests use `imagePullPolicy: Never` specifically to force using a local image rather than silently trying (and failing) to pull from a registry, so if you see that error, this is almost always why.

---

## 7. Configure and apply the manifests

```bash
# Edit k8s/configmap.yaml first — replace all 5 occurrences of
# REPLACE_WITH_YOUR_LAN_IP with your actual machine's LAN IP.

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Secret: copy the template, fill in real values, apply that instead
cp k8s/secret.example.yaml k8s/secret.yaml
# edit k8s/secret.yaml with your real MONGODB_URI and JWT_SECRET
kubectl apply -f k8s/secret.yaml

kubectl apply -f k8s/gateway-deployment.yaml
kubectl apply -f k8s/node-a-deployment.yaml
kubectl apply -f k8s/node-b-deployment.yaml
kubectl apply -f k8s/node-c-deployment.yaml
kubectl apply -f k8s/client-deployment.yaml
```

Watch everything come up:
```bash
kubectl get pods -n distributed-study-room -w
```
All 5 should reach `Running` with `READY 1/1` within about 15-20 seconds (the gateway and nodes retry registration every 5s on failure, so a pod coming up slightly before another isn't a problem — same self-healing behavior as local dev).

---

## 8. Verify it actually works

```bash
curl http://<your-lan-ip>:5000/health
```
Should show all three nodes `ONLINE` within a few seconds. Then open `http://<your-lan-ip>:8080` in a browser — on your own machine, or on any other device connected to the same WiFi/network, since that's the entire point of `hostNetwork`. Register, create a classroom, join from a second device or browser profile.

Worth specifically re-confirming the things Kubernetes changes vs. plain local dev:

- **Pod self-healing:** `kubectl delete pod -n distributed-study-room -l app=node-c` — Kubernetes restarts it automatically (a new pod, same Deployment) within seconds, demonstrating the platform-level health tracking from §2's table. Watch `kubectl get pods -n distributed-study-room -w` while you do this.
- **Leader election still works the same way** as it always has (this is unchanged application logic, just running in a container) — while node-c's pod is restarting, `curl http://<your-lan-ip>:5001/health` on node-a or node-b should show a new leader elected, then node-c should legitimately reclaim leadership once its new pod is back up (same behavior verified in `docs/system-status-and-testing.md`'s leader-election test, now happening inside containers).
- **Logs:** `kubectl logs -n distributed-study-room -l app=gateway -f` (or `node-a`/`node-b`/`node-c`/`client`) — same `[ELECTION]`/`[MSG BUS]`/etc. log lines as running the process directly, just reached through `kubectl` instead of a terminal window.

---

## 9. Tearing down

```bash
kubectl delete namespace distributed-study-room
```
This deletes everything in one shot (all 5 Deployments, the ConfigMap, the Secret) since they're all scoped to that namespace. The built Docker images stay on your machine (`docker images` to see them, `docker rmi study-room-server:local study-room-client:local` to remove them too if you want to reclaim disk space).

---

## 10. What a real multi-machine cluster would add (not built here)

Everything above runs on one machine's single-node cluster — genuinely useful (other devices on the LAN can reach it, which satisfies "expose it on the same network"), but it's still one physical machine under the hood. A **true** multi-machine Kubernetes cluster — e.g. a few Raspberry Pis or old laptops joined into one cluster with `kubeadm`, or managed nodes on a cloud provider — would let each node pod land on a genuinely separate physical machine via `nodeSelector`/pod affinity rules, removing the `hostNetwork` single-node constraint from §4 entirely and making the deployment's physical topology match the distributed-systems story even more literally (node-A really is a different computer from node-B, not just a different container on the same one). This is the same kind of honest "what's actually been proven vs. what's architecturally possible" distinction the AWS case study drew — not built here because it requires hardware (or a paid cluster) this plan was specifically written to avoid needing.
