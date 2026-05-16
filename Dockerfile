FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY src ./src
COPY README.md AGENT.MD ./

RUN mkdir -p data logs

EXPOSE 8787

CMD ["npm", "run", "multi-watch"]
