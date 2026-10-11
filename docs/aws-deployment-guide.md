# AWS Deployment Guide — 4 EC2 Instances, Free Tier

This is a practical, copy-pasteable runbook for deploying this project to real AWS infrastructure: one Gateway + three node instances, each on a free-tier Amazon Linux EC2 box, with swap enabled so `npm install`/`npm run build` don't OOM on 1GB of RAM. MongoDB stays on Atlas (external, already how this project runs locally) — nothing to self-host there.

Read `docs/aws-case-study.md` first if you haven't — in particular §2's correction that **all four instances need a public IP**, not just the Gateway, because browsers connect directly to whichever node they're assigned rather than going through the Gateway for everything.

---

## 0. What you're building

| Instance | Role | Port | Runs |
|---|---|---|---|
| `gateway` | Discovery + monitoring dashboard feed + auth | 5000 | `server/gateway/server.js`, and the built client (served statically) |
| `node-a` | Classroom node A | 5001 | `server/nodes/nodeA/server.js` |
| `node-b` | Classroom node B | 5002 | `server/nodes/nodeB/server.js` |
| `node-c` | Classroom node C | 5003 | `server/nodes/nodeC/server.js` |

All four are the smallest free-tier-eligible type (`t2.micro` or `t3.micro`, 1 vCPU / 1GB RAM — check which is free under "Free tier eligible" in the instance launch screen for your account). AWS's free tier is 750 instance-hours/month *combined*, so running all four simultaneously for a demo burns through that faster than running one 24/7 — stop them when you're not actively demoing (§8).

**Prerequisites:**
- An AWS account, logged into the EC2 console.
- An EC2 key pair (create one in the console if you don't have one — you'll need the `.pem` file to SSH in).
- This repo pushed somewhere you can `git clone` from the instances (a GitHub repo is easiest — if it's private, either make a throwaway deploy key or just `scp` the folder over instead, see the note in §4).
- Your MongoDB Atlas connection string and a `JWT_SECRET` value (the same ones from your local `.env` work fine — reuse them).
- **Atlas Network Access:** Atlas blocks all IPs by default. Before any instance can connect, go to Atlas → Network Access → Add IP Address, and either add each instance's public IP once you have them, or add `0.0.0.0/0` for the demo (tighten it back afterward). Skipping this is the single most common "it just hangs" mistake.

---

## 1. Launch the 4 EC2 instances

Repeat this 4 times (or use "Launch more like this" after the first) — name them `gateway`, `node-a`, `node-b`, `node-c` so you don't lose track:

1. EC2 console → **Launch instance**.
2. **Name:** `gateway` (then `node-a`, `node-b`, `node-c` for the others).
3. **AMI:** Amazon Linux 2023 (free tier eligible).
4. **Instance type:** `t2.micro` or `t3.micro` (whichever shows "Free tier eligible").
5. **Key pair:** select the one you created.
6. **Network settings:** create ONE security group and reuse it for all four instances (simpler than four separate ones, and correct here since all four need the same rules — see the case-study doc's note that these ports are genuinely public, not just inter-node). Inbound rules:
   - SSH (22) — source: **My IP** (not 0.0.0.0/0 — this is the one port that should stay restricted).
   - Custom TCP, port **5000** — source: 0.0.0.0/0 (Gateway).
   - Custom TCP, port **5001** — source: 0.0.0.0/0 (node-A).
   - Custom TCP, port **5002** — source: 0.0.0.0/0 (node-B).
   - Custom TCP, port **5003** — source: 0.0.0.0/0 (node-C).
   - Custom TCP, port **8080** — source: 0.0.0.0/0 (the built client, served from the Gateway instance — see §6).
7. **Storage:** the default 8GB gp3 is fine.
8. Launch. Repeat for the other 3, picking the **same security group** each time.
9. Once all four are running, note each one's **Public IPv4 address** (EC2 console → Instances → click each one). You'll need all four for the `.env` files in §5.

---

## 2. SSH in and set up swap (do this on all 4 instances)

Free-tier instances have 1GB of RAM. `npm install` and `npm run build` (the Vite client build) can both OOM-kill themselves on 1GB with no swap — this is the fix:

```bash
ssh -i /path/to/your-key.pem ec2-user@<instance-public-ip>

# Create a 2GB swap file
sudo dd if=/dev/zero of=/swapfile bs=128M count=16
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it survive a reboot
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab

# Verify — you should see a "Swap:" line with ~2.0Gi total
free -h
```

Do this on all four instances before installing anything — it costs nothing to have and avoids a confusing silent kill mid-`npm install`.

---

## 3. Install Node.js and git (do this on all 4 instances)

```bash
sudo dnf update -y
sudo dnf install -y git

# NodeSource repo for a current Node.js (Amazon Linux's default repo is often old)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

node -v   # sanity check, expect v20.x
npm -v

# PM2 — keeps the process running, restarts it on crash, restarts it on reboot
sudo npm install -g pm2
```

---

## 4. Get the code onto each instance

If your repo is on GitHub (public, or you've set up a deploy key):

```bash
git clone <your-repo-url> app
cd app
npm run postinstall   # installs client/ and server/ deps — this is the step swap protects
```

If it's private and you don't want to set up a deploy key for a one-off demo, it's simpler to just copy your local working tree over directly from your own machine (run this from your local machine, not the EC2 instance):

```bash
scp -i /path/to/your-key.pem -r "/path/to/FA-Project" ec2-user@<instance-public-ip>:~/app
```
(This copies `node_modules` too if you have them locally, which is slower over the network but skips `npm install` entirely — your call. Excluding `node_modules`/`.git` first with `rsync --exclude` is faster if you have `rsync` available.)

Either way, you should end up with the project at `~/app` on every instance, and still need to run `npm run postinstall` on each if you didn't copy `node_modules`.

---

## 5. Configure `.env` on each instance

Each instance gets its **own** `.env` at the project root (`~/app/.env`), not a copied shared one — this is where `NODE_HOST`, `GATEWAY_URL`, and `PEER_NODES` differ per instance. Substitute your 4 real public IPs everywhere you see `<gateway-ip>`, `<node-a-ip>`, etc.

**On the `gateway` instance** (`~/app/.env`):
```bash
GATEWAY_PORT=5000
MONGODB_URI=<your Atlas connection string>
JWT_SECRET=<your secret — same value on all 4 instances>
VITE_GATEWAY_URL=http://<gateway-ip>:5000
```

**On the `node-a` instance** (`~/app/.env`):
```bash
MONGODB_URI=<same Atlas connection string>
JWT_SECRET=<same secret as the gateway>
GATEWAY_URL=http://<gateway-ip>:5000
NODE_HOST=<node-a-ip>
PEER_NODES=node-A@<node-a-ip>:5001,node-B@<node-b-ip>:5002,node-C@<node-c-ip>:5003
```

**On `node-b`** — same as node-A but `GATEWAY_URL` still points at the gateway, and `NODE_HOST=<node-b-ip>`. **On `node-c`** likewise with `NODE_HOST=<node-c-ip>`. `PEER_NODES` is identical on all three node instances (it's just the full list — each node filters out its own entry automatically).

`NODE_HOST` is deliberately each node's **public** IP, not its private VPC IP — the browser (outside the VPC) needs to reach it directly, and the other node instances can reach a public IP just fine too, even over the "internal" RPC/MessageBus/gossip traffic (see the case-study doc's note on why this isn't the usual private-subnet shape).

---

## 6. Build and serve the client (on the `gateway` instance only)

The client's `VITE_GATEWAY_URL` gets baked in at *build* time, not read at runtime — build it only after `.env` is set correctly on the gateway instance:

```bash
cd ~/app/client
npm run build          # produces client/dist/
pm2 serve dist 8080 --name client --spa
```
(`pm2 serve` is a built-in PM2 feature for exactly this — serving a static folder, with `--spa` so client-side routes like `/classroom/:code` don't 404 on a direct load/refresh.)

Visit `http://<gateway-ip>:8080` from your own browser once everything's started (next section) — that's the actual app.

---

## 7. Start every process with PM2

Each node's `NODE_ID`/`NODE_PORT` default correctly per-file (`nodes/nodeA/server.js` defaults to `node-A`/5001, etc. — see `server/nodes/nodeA/server.js`), so you don't need to export anything beyond what's already in `.env`.

**On `gateway`:**
```bash
cd ~/app/server
pm2 start gateway/server.js --name gateway
```

**On `node-a`:**
```bash
cd ~/app/server
pm2 start nodes/nodeA/server.js --name node-a
```

**On `node-b`:** `pm2 start nodes/nodeB/server.js --name node-b` (same directory).
**On `node-c`:** `pm2 start nodes/nodeC/server.js --name node-c`.

Start the Gateway first, then the three nodes, waiting a few seconds between each — not strictly required (nodes retry registration every 5s and the registry self-heals from heartbeats either way), but it avoids a wall of harmless "failed to register" log lines on first boot.

On every instance, make PM2 survive a reboot:
```bash
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
# it will print a command starting with "sudo env..." — run exactly what it prints, then:
pm2 save
```

---

## 8. Verify it actually works

From your own machine (not SSH'd in):

```bash
curl http://<gateway-ip>:5000/health
```
You should see all three nodes listed as `ONLINE` within about 10-15 seconds of the last one starting. If a node is missing, SSH into it and check `pm2 logs node-a` (etc.) — the most common cause is `MONGODB_URI` not reachable yet (check Atlas's Network Access allowlist) or a typo in one of the IPs in `.env`.

Then open `http://<gateway-ip>:8080` in a real browser, register a teacher account, create a classroom, and join it from a second browser (or incognito window) as a student — exactly like the local testing flow in `docs/system-status-and-testing.md`, just against real public IPs instead of localhost. Worth specifically re-confirming the things that are genuinely different on real infrastructure rather than just localhost-with-extra-steps:

- **Leader election** across the three real instances — `curl http://<node-a-ip>:5001/health` on each and confirm they agree on a leader, same as the local test.
- **Cross-node file RPC** — upload a file while connected to node-a, then open the same classroom from a client connected to node-b or node-c, and confirm the download still works (watch `pm2 logs node-b` for the `[RPC] Node node-B fetching "..." bytes from owning node node-A` line).
- **Kill one node's PM2 process** (`pm2 stop node-c`) and confirm the Dashboard (`http://<gateway-ip>:8080/admin/distributed`) shows it OFFLINE within ~10s, a new leader gets elected if it was the leader, and a connected client fails over to another node.

---

## 9. Shutting down (don't burn free-tier hours for nothing)

When you're done demoing for the day:
```bash
pm2 save   # so state resumes correctly if you start the instance again later
```
then, in the EC2 console, **Stop** (not Terminate) all four instances — stopped instances don't count against free-tier compute hours, only storage (a few cents/month for the 4×8GB volumes). **Stopping reassigns a new public IP** when you start them again (unless you've attached Elastic IPs, which do cost a small amount when the instance is stopped) — if you restart later, you'll need to update every `.env`'s IPs again, or attach an Elastic IP to each instance ahead of time if you want the addresses to stay fixed across stop/start cycles.

When you're fully done with the demo, **Terminate** the instances instead of leaving them stopped indefinitely.
