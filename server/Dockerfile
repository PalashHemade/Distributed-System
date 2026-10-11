# One image, four possible processes. The Gateway and the three node
# processes (node-A/B/C) are the exact same codebase — they only differ in
# which entry file is run and which env vars they're given (NODE_ID,
# NODE_PORT, etc. — see BaseNode.js). Building one image and choosing the
# entry file at `docker run`/Kubernetes container-spec level (CMD override)
# mirrors the config-via-environment-variables pattern already used
# throughout this project, rather than building four near-identical images.
FROM node:22-alpine

WORKDIR /app

# Install deps first so this layer is cached across rebuilds that only
# change application code, not package.json.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# All four possible ports this image might listen on, depending on which
# process it's started as (5000=Gateway, 5001/5002/5003=node-A/B/C).
EXPOSE 5000 5001 5002 5003

# Defaults to the Gateway; every node Deployment in k8s/ overrides this
# with its own `command` (e.g. ["node", "nodes/nodeA/server.js"]).
CMD ["node", "gateway/server.js"]
