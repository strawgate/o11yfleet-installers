// portal-api.js — Thin API wrapper for user + admin portals.
// Pages include this script and use FP.api to make calls.
// Auth is via URL params (?tenant=UUID&api=URL) or localStorage, matching
// the existing app.html pattern. Admin pages use X-Admin: true.

window.FP = window.FP || {};

(function () {
  const params = new URLSearchParams(window.location.search);

  // Read config from URL params or localStorage
  const tenantId = params.get('tenant') || localStorage.getItem('fp-tenant-id') || '';
  const apiBase = params.get('api') || localStorage.getItem('fp-api-base') || '';

  // Persist for subsequent page navigations
  if (tenantId) localStorage.setItem('fp-tenant-id', tenantId);
  if (apiBase) localStorage.setItem('fp-api-base', apiBase);

  FP.tenantId = tenantId;
  FP.apiBase = apiBase;

  // Detect admin mode from admin.css or admin-specific attributes
  FP.isAdmin = document.querySelector('link[href*="admin.css"]') !== null ||
    document.querySelector('.admin-stripe') !== null;

  /** Build headers for API requests */
  function headers(extra) {
    const h = { 'Content-Type': 'application/json' };
    if (FP.isAdmin) {
      h['X-Admin'] = 'true';
    } else if (FP.tenantId) {
      h['X-Tenant-Id'] = FP.tenantId;
    }
    return Object.assign(h, extra || {});
  }

  /** GET JSON from the API */
  FP.get = async function (path) {
    const res = await fetch(FP.apiBase + path, { headers: headers() });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return res.json();
  };

  /** POST JSON to the API */
  FP.post = async function (path, body) {
    const res = await fetch(FP.apiBase + path, {
      method: 'POST',
      headers: headers(),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
    return res.json();
  };

  /** POST raw text (YAML upload) */
  FP.postText = async function (path, text) {
    const h = {};
    if (FP.isAdmin) h['X-Admin'] = 'true';
    else if (FP.tenantId) h['X-Tenant-Id'] = FP.tenantId;
    h['Content-Type'] = 'text/plain';
    const res = await fetch(FP.apiBase + path, {
      method: 'POST', headers: h, body: text,
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
    return res.json();
  };

  /** PUT JSON */
  FP.put = async function (path, body) {
    const res = await fetch(FP.apiBase + path, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
    return res.json();
  };

  /** DELETE */
  FP.del = async function (path) {
    const res = await fetch(FP.apiBase + path, {
      method: 'DELETE', headers: headers(),
    });
    if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
    if (res.status === 204) return {};
    return res.json();
  };

  /** Check if API is configured. If not, show a connect bar. */
  FP.ready = function () {
    return !!(FP.tenantId && FP.apiBase);
  };

  /** Relative time helper */
  FP.relTime = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return Math.max(1, Math.floor(diff / 1000)) + 's ago';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  };

  /** Truncate a string to n chars */
  FP.trunc = function (s, n) {
    if (!s) return '—';
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  /** Show a connect banner if API is not configured */
  FP.showConnectBarIfNeeded = function () {
    if (FP.ready()) return;
    const bar = document.createElement('div');
    bar.className = 'banner warn mb-6';
    bar.style.margin = '18px';
    bar.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2L1.5 13.5h13z"/><path d="M8 6.5v3M8 11.5v.01" stroke-linecap="round"/></svg>
      <div>
        <div class="b-title">Not connected to API</div>
        <div class="b-body">Add <code>?tenant=UUID&api=http://localhost:8787</code> to connect.</div>
      </div>`;
    const main = document.querySelector('.main .main-wide');
    if (main) main.prepend(bar);
  };

  /** Auto-refresh: call fn every intervalMs, returns stop function */
  FP.autoRefresh = function (fn, intervalMs) {
    fn(); // initial call
    const id = setInterval(fn, intervalMs || 10000);
    return function stop() { clearInterval(id); };
  };
})();
