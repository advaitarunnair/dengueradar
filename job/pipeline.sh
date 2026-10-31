#!/usr/bin/env bash
# The daily pipeline: refresh real data, publish it (the commit triggers the Vercel redeploy), then make sure this
# week's demo window and canonical plan exist. Needs GITHUB_TOKEN, GITHUB_REPO, NEBIUS_API_KEY, DATABASE_URL;
# TAVILY_API_KEY and DATA_GOV_SG_API_KEY are optional.
set -euo pipefail
git clone --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" /work/repo
cd /work/repo
ln -s /deps/node_modules node_modules

/deps/venv/bin/python scripts/build_scores.py

git config user.name "dengueradar-nebius-job"
git config user.email "dengueradar-nebius-job@users.noreply.github.com"
git add data web/public/data
if git diff --cached --quiet; then
  echo "No data changes"
else
  git commit -m "Daily data refresh $(python3 -c "import json; print(json.load(open('web/public/data/meta.json'))['epi_week'])") (Nebius job)"
  git push
fi

USE_LOCAL_DATA=1 node job/weekly_plan.ts
