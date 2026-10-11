# Multi-stage: build the Vite SPA, then serve the static output with nginx.
# VITE_GATEWAY_URL is a Vite env var, which Vite bakes into the bundle at
# BUILD time, not read at container-start time like the server's env vars —
# so it has to be supplied as a build ARG, and a client built for one
# Gateway address can't be re-pointed at another without rebuilding.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_GATEWAY_URL
ENV VITE_GATEWAY_URL=${VITE_GATEWAY_URL}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
