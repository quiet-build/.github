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
    uses: quiet-build/.github/.github/workflows/deploy-static-site.yml@main
    secrets: inherit
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
    uses: quiet-build/.github/.github/workflows/deploy-static-site.yml@main
    with:
      bundle-check-command: bash scripts/bundle-check.sh
      lighthouse-pwa-gate: 0.9
    secrets: inherit
```

#### Inputs (all optional)

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
| `lighthouse-pwa-gate` | `0` | Minimum Lighthouse PWA score — `0` skips the audit |

#### Required secrets

Both must exist as **org-level** secrets on `quiet-build`:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Pages:Edit`
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

Callers pass them through with `secrets: inherit`.

## Notes

- The workflow builds **twice** — once with `VITE_BASE=/<repo>/` for GitHub
  Pages, once with `VITE_BASE=/` for Cloudflare Pages (because asset paths
  differ between the two hosts).
- Cloudflare Pages projects are auto-created on first deploy by `wrangler`.
