# DengueRadar weekly plan job for Nebius Serverless AI (CPU). Node 24 runs the TypeScript sources directly.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY api ./api
COPY data/history ./data/history
COPY job ./job
CMD ["node", "job/weekly_plan.ts"]
