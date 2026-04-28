// portal-api.js — Thin API wrapper for user + admin portals.
// Uses cookie-based auth (fp_session cookie set by /auth/login).
// In production, API base is auto-detected from the domain.

window.FP = window.FP || {};

(function () {
  const params = new URLSearchParams(window.location.search);

  // Auto-detect API base from domain (production) or fall back to params/localStorage
  function detectApiBase() {
    const explicit = params.get("api") || localStorage.getItem("fp-api-base");
    if (explicit) return explicit;
    const host = window.location.hostname;
    // Production: app.o11yfleet.com or admin.o11yfleet.com → api.o11yfleet.com
    if (host.endsWith(".o11yfleet.com") || host === "o11yfleet.com") {
      return "https://api.o11yfleet.com";
    }
    // Cloudflare Pages preview: *.o11yfleet-site.pages.dev
    if (host.endsWith(".pages.dev")) {
      return "https://o11yfleet-worker.o11yfleet.workers.dev";
    }
    // Local dev
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8787";
    }
    return "";
  }

  const apiBase = detectApiBase();
  if (apiBase) localStorage.setItem("fp-api-base", apiBase);

  FP.apiBase = apiBase;

  // Detect admin mode from admin.css or admin-specific attributes
  FP.isAdmin =
    document.querySelector('link[href*="admin.css"]') !== null ||
    document.querySelector(".admin-stripe") !== null;

  // User info (populated after /auth/me check)
  FP.user = JSON.parse(localStorage.getItem("fp-user") || "null");

  /** Fetch wrapper with credentials (sends cookies) */
  async function apiFetch(path, opts) {
    opts = opts || {};
    opts.credentials = "include"; // send cookies cross-origin
    const res = await fetch(FP.apiBase + path, opts);
    if (res.status === 401 || res.status === 403) {
      // Session expired — redirect to login
      localStorage.removeItem("fp-user");
      if (!window.location.pathname.includes("login")) {
        window.location.href = FP.isAdmin ? "/admin-login.html" : "/login.html";
      }
      throw new Error("Session expired");
    }
    return res;
  }

  /** Extract error message from a non-ok response */
  async function extractError(method, path, res) {
    try {
      const body = await res.json();
      if (body && body.error) return body.error;
    } catch (_) {
      /* no JSON body */
    }
    return method + " " + path + ": " + res.status;
  }

  /** GET JSON from the API */
  FP.get = async function (path) {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(await extractError("GET", path, res));
    return res.json();
  };

  /** POST JSON to the API */
  FP.post = async function (path, body) {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await extractError("POST", path, res));
    return res.json();
  };

  /** POST raw text (YAML upload) */
  FP.postText = async function (path, text) {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text,
    });
    if (!res.ok) throw new Error(await extractError("POST", path, res));
    return res.json();
  };

  /** PUT JSON */
  FP.put = async function (path, body) {
    const res = await apiFetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await extractError("PUT", path, res));
    return res.json();
  };

  /** DELETE */
  FP.del = async function (path) {
    const res = await apiFetch(path, { method: "DELETE" });
    if (!res.ok) throw new Error(await extractError("DELETE", path, res));
    if (res.status === 204) return {};
    return res.json();
  };

  /** Login — POST /auth/login, stores user info */
  FP.login = async function (email, password) {
    const res = await fetch(FP.apiBase + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(function () {
        return { error: "Login failed" };
      });
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    FP.user = data.user;
    localStorage.setItem("fp-user", JSON.stringify(data.user));
    return data;
  };

  /** Logout — POST /auth/logout */
  FP.logout = async function () {
    try {
      await fetch(FP.apiBase + "/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {
      /* ignore */
    }
    FP.user = null;
    localStorage.removeItem("fp-user");
  };

  /** Check if user is logged in (from cached user or /auth/me) */
  FP.checkAuth = async function () {
    if (!FP.apiBase) return false;
    try {
      const data = await FP.get("/auth/me");
      FP.user = data.user;
      localStorage.setItem("fp-user", JSON.stringify(data.user));
      return true;
    } catch (e) {
      FP.user = null;
      localStorage.removeItem("fp-user");
      return false;
    }
  };

  /** Check if API is configured and user is logged in */
  FP.ready = function () {
    return !!(FP.apiBase && FP.user);
  };

  /** Relative time helper */
  FP.relTime = function (iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return Math.max(1, Math.floor(diff / 1000)) + "s ago";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  };

  /** Truncate a string to n chars */
  FP.trunc = function (s, n) {
    if (!s) return "—";
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

  /** Show a connect banner if not logged in */
  FP.showConnectBarIfNeeded = function () {
    if (FP.ready()) return;
    var bar = document.createElement("div");
    bar.className = "banner warn mb-6";
    bar.style.margin = "18px";
    if (!FP.apiBase) {
      bar.innerHTML =
        '<div><div class="b-title">API not configured</div><div class="b-body">Add <code>?api=http://localhost:8787</code> to connect.</div></div>';
    } else {
      bar.innerHTML =
        '<div><div class="b-title">Not logged in</div><div class="b-body"><a href="/login.html">Sign in</a> to see your data.</div></div>';
    }
    var main = document.querySelector(".main .main-wide");
    if (main) main.prepend(bar);
  };

  /** Auto-refresh: call fn every intervalMs, returns stop function */
  FP.autoRefresh = function (fn, intervalMs) {
    fn(); // initial call
    var id = setInterval(fn, intervalMs || 10000);
    return function stop() {
      clearInterval(id);
    };
  };
})();
