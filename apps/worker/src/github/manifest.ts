// Renders the GitHub App manifest with per-environment URL substitution.
//
// The canonical manifest lives in `infra/github-app/o11yfleet.json` so the
// permission set is reviewable in PRs without reading TS string literals.
// String fields containing `${origin}` / `${siteOrigin}` are substituted
// here at request time.
//
// See infra/github-app/README.md for the full rationale + after-create steps.

import manifestTemplate from "../../../../infra/github-app/o11yfleet.json";

export interface ManifestPlaceholders {
  origin: string;
  siteOrigin: string;
}

interface RenderedManifest {
  name: string;
  url: string;
  description: string;
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
}

/**
 * Substitute `${origin}` and `${siteOrigin}` placeholders into the manifest's
 * URL fields and return a fresh object suitable for posting to GitHub's
 * `/settings/apps/new?state=...` endpoint as the `manifest` form field.
 *
 * The `$schema` field is dropped — it's a JSON-Schema hint for editors only,
 * GitHub rejects unknown manifest fields.
 */
export function renderGitHubAppManifest(placeholders: ManifestPlaceholders): RenderedManifest {
  const sub = (value: string): string =>
    value
      .replace(/\$\{origin\}/g, placeholders.origin)
      .replace(/\$\{siteOrigin\}/g, placeholders.siteOrigin);

  const tpl = manifestTemplate as unknown as RenderedManifest & { $schema?: string };
  return {
    name: tpl.name,
    url: tpl.url,
    description: tpl.description,
    public: tpl.public,
    request_oauth_on_install: tpl.request_oauth_on_install,
    default_permissions: { ...tpl.default_permissions },
    default_events: [...tpl.default_events],
    hook_attributes: {
      url: sub(tpl.hook_attributes.url),
      active: tpl.hook_attributes.active,
    },
    redirect_url: sub(tpl.redirect_url),
    callback_urls: tpl.callback_urls.map(sub),
    setup_url: sub(tpl.setup_url),
  };
}
