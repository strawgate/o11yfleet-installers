# o11yfleet GitHub App

This directory holds the **canonical manifest** for the o11yfleet GitHub App.
The manifest is rendered (with origin substitution) by the worker route
`GET /auth/github/app-manifest` and posted to GitHub's app-manifest creation
endpoint. The conversion callback returns a fresh app's `client_id`,
`client_secret`, `app_id`, `webhook_secret`, and `pem` private key — those go
into Cloudflare Worker secrets, not source.

## Why a checked-in manifest

GitHub's app-manifest flow is a **one-shot** bootstrap: there is no API to
update an existing app from a manifest, and most config (permissions, events,
URLs) can only change in the web UI. The manifest's value is therefore:

- **Spec as code.** Permission changes are diff-reviewable in PRs.
- **Reproducibility.** Spinning up a fresh app for a new env (preview,
  self-hosted fork) produces an identical app.
- **Setup automation.** First-time creation is two clicks instead of a
  20-field web form plus copy-pasting 5 secrets.

Drift between this manifest and the live app is partially detectable
via `GET /app` (returns `permissions` and `events` only — not URLs).
A drift-check job is tracked in a future issue.

## Field substitutions

The route does string substitution before posting:

| Placeholder     | Substituted with         | Source                   |
| --------------- | ------------------------ | ------------------------ |
| `${origin}`     | `https://<request host>` | request URL origin       |
| `${siteOrigin}` | site host for the env    | `siteOriginForRequest()` |

Local dev: `origin` is typically `http://localhost:8787`, `siteOrigin` is
`http://localhost:4000`.

## Permission set

| Permission               | Scope      | Why                                                 |
| ------------------------ | ---------- | --------------------------------------------------- |
| `email_addresses: read`  | Account    | Sign in with GitHub                                 |
| `metadata: read`         | Repository | Required by GitHub for any repo permission          |
| `contents: read`         | Repository | Fetch collector YAML on `push`                      |
| `commit_statuses: write` | Repository | "deployed to N agents" badge per commit             |
| `deployments: write`     | Repository | Surface rollouts in the GitHub Deployments timeline |
| `pull_requests: write`   | Repository | Comment diff/impact on PRs                          |
| `checks: write`          | Repository | Validation Check Run on push/PR                     |

## Events

`push`, `pull_request`, `installation`, `installation_repositories`.

`hook_attributes.active` is currently `false`. It will flip to `true` once the
webhook receiver lands ([#510](https://github.com/strawgate/o11yfleet/issues/510)).

## After-create checklist

When you run the manifest flow and GitHub redirects back with the generated
secrets, save them to the worker's environment:

```bash
npx wrangler secret put GITHUB_APP_CLIENT_ID
npx wrangler secret put GITHUB_APP_CLIENT_SECRET
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_WEBHOOK_SECRET
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

`GITHUB_APP_PRIVATE_KEY` is the multi-line PEM. Wrangler accepts it as-is.

## Updating the manifest

Editing this file does **not** update an existing app. After merging a manifest
change, either:

1. **Already-bootstrapped envs**: hand-apply the change in
   <https://github.com/settings/apps/o11yfleet> (or org equivalent). New
   permission requests trigger a re-approval prompt for every install.
2. **Net-new env (preview, fresh dev account)**: re-run the manifest flow
   against that env's worker URL. The new app picks up the latest manifest.
