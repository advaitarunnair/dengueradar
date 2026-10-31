# Running the daily pipeline on Nebius Serverless Jobs

**Status: built, not deployed.** It needs a Nebius AI Cloud project and credentials that only the team can create. Until then, GitHub Actions (`refresh-and-deploy.yml`) keeps running the pipeline, and Vercel Cron makes sure the weekly plan exists.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Timer | GitHub Actions cron (`nebius-pipeline.yml`) | Nebius's job docs describe creating and running jobs but no built-in schedule |
| Pipeline compute | Nebius Serverless AI job, CPU only | `job/Dockerfile`, `job/pipeline.sh`: clusters, weather, forecast, ranking, publish, demo roll-forward, weekly plan |
| Publishing | `git push` from the job | Same artefacts as before; the commit triggers the Vercel redeploy |
| Model calls | Nebius Token Factory | Called by the job and by the app |
| Fallback | `refresh-and-deploy.yml` (Run workflow) | Same pipeline on GitHub's runners |

## Setup

Flags below are from the Nebius docs (`docs.nebius.com/serverless/jobs/manage`, `/cli/install`, `/cli/configure`), but this has not been run end to end yet, so expect to adjust. In particular, check the `--env-secret` selector format against what the console shows.

1. **Project and billing.** Create or choose a project in the [Nebius console](https://console.nebius.com) with billing enabled. CPU VMs bill only while the job runs. Token Factory credits are separate.
2. **Choose the VM.** List what your project offers (docs: `/compute/virtual-machines/list-platforms`). `cpu-d3` or `cpu-e2` with a small preset is enough. Note the platform, preset and a subnet ID.
3. **Service account.** In the console, create a service account with permission to create AI jobs, then an authorized key. Note the service account ID and public key ID, and keep the private key file safe.
4. **GitHub token for publishing.** Create a fine-grained personal access token limited to this repo with **Contents: read and write**.
5. **Secrets in Nebius SecretStash.** Store `NEBIUS_API_KEY`, `DATABASE_URL` (production), `TAVILY_API_KEY` and the GitHub token. Note each secret's selector.
6. **Make the image public.** After the first build, set the GHCR package `dengueradar-pipeline` to public (it contains dependencies only, no code or secrets), or add registry credentials to the job.
7. **GitHub repository settings** (Settings > Secrets and variables > Actions):
   - Secret: `NEBIUS_SA_PRIVATE_KEY` (the private key file's contents)
   - Variables: `NEBIUS_SA_ID`, `NEBIUS_PUBLIC_KEY_ID`, `NEBIUS_PROJECT_ID`, `NEBIUS_PLATFORM`, `NEBIUS_PRESET`, `NEBIUS_SUBNET_ID`, `NEBIUS_SECRET_NEBIUS_API_KEY`, `NEBIUS_SECRET_DATABASE_URL`, `NEBIUS_SECRET_TAVILY_API_KEY`, `NEBIUS_SECRET_GITHUB_TOKEN`
8. **Test.** Set variable `NEBIUS_ENABLED` to `true` and run **Nebius pipeline** by hand. Check the job's logs in the console and that a "Daily data refresh" commit appears.
9. **Switch over.** Once it works, remove the `schedule:` block from `refresh-and-deploy.yml` so it stays as a manual fallback.
