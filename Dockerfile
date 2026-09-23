FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

# Runs the compiled build, not ts-node-dev: on a 512MB host (Render free tier),
# compiling TypeScript on every startup pushed the process OOM ("JavaScript heap
# out of memory"). Local dev keeps hot-reload via docker-compose.yml's `command:`
# override, which runs ts-node-dev against the bind-mounted source instead.
CMD ["node", "dist/src/server.js"]
