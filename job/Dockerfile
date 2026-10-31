# DengueRadar daily pipeline for Nebius Serverless AI (CPU). See docs/nebius-jobs.md.
# The image holds dependencies only; job/pipeline.sh clones the latest repo when it runs.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY package.json package-lock.json requirements.txt ./
RUN npm ci --omit=dev --ignore-scripts
RUN python3 -m venv /deps/venv && /deps/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY job/pipeline.sh /deps/pipeline.sh
CMD ["bash", "/deps/pipeline.sh"]
