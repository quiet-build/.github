# quiet-build / .github

Org-level configuration and reusable GitHub Actions workflows for
[`quiet-build`](https://github.com/quiet-build) repositories.

## Reusable workflows

### `deploy-static-site.yml`

Deploys a Vite-based static site to **both** GitHub Pages and Cloudflare
Pages in parallel. Optional Lighthouse PWA audit and bundle-size gate.

**Minimal caller** (`.github/workflows/deploy.yml` in any repo):

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    permissions:
      contents: read
      pages: write
      id-token: write
    uses: quiet-build/.github/.github/workflows/deploy-static-site.yml@main
    secrets:
      CLOUDFLARE_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Caller with PWA gate + bundle check** (e.g. `flappy-3d`):

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    permissions:
      contents: read
      pages: write
      id-token: write
    uses: quiet-build/.github/.github/workflows/deploy-static-site.yml@main
    with:
      bundle-check-command: bash scripts/bundle-check.sh
      lighthouse-pwa-gate: "0.9"
    secrets:
      CLOUDFLARE_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

#### Inputs (all optional, all strings)

| Input | Default | Description |
|---|---|---|
| `node-version` | `22` | Node.js version |
| `install-command` | `npm ci --legacy-peer-deps` | Dependency install |
| `build-command` | `npm run build` | Build command |
| `dist-dir` | `dist` | Build output directory |
| `pages-base` | `/<repo>/` | `VITE_BASE` for the GitHub Pages build |
| `cloudflare-project-name` | `<repo>` | Cloudflare Pages project name |
| `cloudflare-branch` | `main` | Cloudflare Pages branch |
| `bundle-check-command` | _(empty)_ | Bundle-size check command — empty skips |
| `lighthouse-pwa-gate` | _(empty)_ | Minimum Lighthouse PWA score, e.g. `"0.9"` — empty skips the audit |

#### Required secrets

Both must exist as **org-level** secrets on `quiet-build` (or per-repo
with the same names):

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Pages:Edit`
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

#### Required permissions

The caller's `uses:` job must grant:

```yaml
permissions:
  contents: read   # checkout
  pages: write     # GitHub Pages deploy
  id-token: write  # OIDC token for actions/deploy-pages
```

`permissions` cannot live at the workflow top-level of `workflow_call`
workflows (GitHub rejects with `startup_failure`) — that's why they're at
the job level here and at the caller's `uses:` job.

## Notes

- The workflow builds **twice** — once with `VITE_BASE=/<repo>/` for GitHub
  Pages, once with `VITE_BASE=/` for Cloudflare Pages (asset paths differ
  between the two hosts).
- Cloudflare Pages projects are auto-created by `wrangler` on first deploy.
- `NPM_CONFIG_LEGACY_PEER_DEPS=true` is set on the Cloudflare job so that
  `wrangler-action`'s implicit `npm i wrangler` respects the workspace's
  peer-dep workaround.
