// Shared portal sidebar partial. portal/* pages call FB.shell({...}).
window.FB = window.FB || {};

// Pages with mock data declare: FB.shell({ ..., prototype: 'This page shows sample data.' })
// This renders a prominent striped banner at the top of the main content area.
FB.prototypeBanner = function (msg) {
  const main = document.querySelector('.main-content') || document.querySelector('main');
  if (!main) return;
  const banner = document.createElement('div');
  banner.className = 'prototype-banner';
  banner.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2L1.5 13.5h13z"/><path d="M8 6.5v3M8 11.5v.01" stroke-linecap="round"/></svg>
    <div>
      <span class="pb-title">Prototype</span>
      <span class="pb-sub"> — ${msg}</span>
    </div>`;
  main.prepend(banner);
};

FB.shell = function (opts) {
  const cur = opts.current || '';
  const role = opts.role || 'user';
  const orgName = opts.orgName || 'Acme Platform';
  const orgPlan = opts.orgPlan || 'Business';
  const orgInitials = orgName.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const userName = opts.userName || 'Maya Patel';
  const userEmail = opts.userEmail || 'maya@acmeplatform.com';
  const userInit = userName.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const isAdmin = role === 'admin';

  const userNav = [
    { sec: 'Workspace' },
    { id: 'overview', label: 'Overview', href: 'overview.html', icon: 'home' },
    { id: 'agents', label: 'Agents', href: 'agents.html', icon: 'cpu', badge: '42' },
    { id: 'configurations', label: 'Configurations', href: 'configurations.html', icon: 'file', badge: '7' },
    { id: 'rollouts', label: 'Rollouts', href: 'rollouts.html', icon: 'rocket', placeholder: true },
    { id: 'flow', label: 'Flow & metrics', href: 'flow.html', icon: 'activity', placeholder: true },
    { id: 'audit', label: 'Audit log', href: 'audit.html', icon: 'list', placeholder: true },
    { sec: 'Setup' },
    { id: 'getting-started', label: 'Getting started', href: 'getting-started.html', icon: 'play' },
    { id: 'integrations', label: 'Integrations', href: 'integrations.html', icon: 'link', placeholder: true },
    { id: 'tokens', label: 'API tokens', href: 'tokens.html', icon: 'key' },
    { sec: 'Settings' },
    { id: 'team', label: 'Team', href: 'team.html', icon: 'users' },
    { id: 'billing', label: 'Plan & billing', href: 'billing.html', icon: 'card' },
    { id: 'settings', label: 'Workspace settings', href: 'settings.html', icon: 'settings' },
  ];
  const adminNav = [
    { sec: 'Operations' },
    { id: 'overview', label: 'Overview', href: 'overview.html', icon: 'home' },
    { id: 'tenants', label: 'Tenants', href: 'tenants.html', icon: 'building' },
    { id: 'users', label: 'Users', href: 'users.html', icon: 'users', placeholder: true },
    { id: 'health', label: 'System health', href: 'health.html', icon: 'activity' },
    { id: 'events', label: 'Audit events', href: 'events.html', icon: 'list' },
    { sec: 'Plans' },
    { id: 'plans', label: 'Plans & pricing', href: 'plans.html', icon: 'card' },
    { id: 'flags', label: 'Feature flags', href: 'flags.html', icon: 'flag' },
    { sec: 'Platform' },
    { id: 'releases', label: 'Releases', href: 'releases.html', icon: 'tag', placeholder: true },
    { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings', placeholder: true },
  ];
  const nav = isAdmin ? adminNav : userNav;

  const ICONS = {
    home: '<path d="M3 9.5L8 4l5 5.5V13a1 1 0 0 1-1 1h-2v-3H8v3H6a1 1 0 0 1-1-1V9.5z"/>',
    cpu: '<rect x="4" y="4" width="8" height="8" rx="1.4"/><path d="M2 6h2M2 9h2M12 6h2M12 9h2M6 2v2M9 2v2M6 12v2M9 12v2"/><rect x="6" y="6" width="4" height="4" fill="currentColor" stroke="none" opacity="0.3"/>',
    file: '<path d="M4 2h6l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M10 2v3h3"/>',
    rocket: '<path d="M9.5 6.5L4 12l-1 2 2-1 5.5-5.5"/><path d="M9 4l3 3M11 2c2 0 4 2 4 4l-3-3-1-1z"/><circle cx="10.5" cy="5.5" r="0.8" fill="currentColor"/>',
    activity: '<path d="M2 8h3l2-5 3 10 2-5h3"/>',
    list: '<path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.5" cy="4" r="0.8" fill="currentColor"/><circle cx="2.5" cy="8" r="0.8" fill="currentColor"/><circle cx="2.5" cy="12" r="0.8" fill="currentColor"/>',
    play: '<circle cx="8" cy="8" r="6"/><path d="M7 5.5L11 8L7 10.5z" fill="currentColor"/>',
    link: '<path d="M6 8a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M10 8a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1"/>',
    key: '<circle cx="5" cy="11" r="2.5"/><path d="M7 9l6-6M11 5l1 1"/>',
    users: '<circle cx="6" cy="6" r="2.5"/><path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5"/><circle cx="11.5" cy="6" r="2"/><path d="M11 9.5c1.6 0 3 1.2 3 3"/>',
    card: '<rect x="2" y="4" width="12" height="9" rx="1.4"/><path d="M2 7h12"/>',
    settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/>',
    building: '<rect x="3" y="2" width="10" height="12" rx="0.5"/><path d="M5 5h2M5 8h2M5 11h2M9 5h2M9 8h2M9 11h2"/>',
    flag: '<path d="M3 14V2M3 3l8 1-1 3 1 3-8-1"/>',
    tag: '<path d="M2 8V3a1 1 0 0 1 1-1h5l6 6-6 6-6-6z"/><circle cx="5.5" cy="5.5" r="0.8" fill="currentColor"/>',
  };

  function navHtml() {
    return nav.map(item => {
      if (item.sec) return `<div class="sidebar-section">${item.sec}</div>`;
      const active = item.id === cur ? 'aria-current="page"' : '';
      const icon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[item.icon] || ''}</svg>`;
      const badge = item.badge ? `<span class="badge">${item.badge}</span>` : '';
      const phAttr = item.placeholder ? ' data-placeholder="true"' : '';
      const href = item.placeholder ? '#' : item.href;
      return `<a class="sidebar-link" href="${href}" ${active}${phAttr}>${icon}<span>${item.label}</span>${badge}</a>`;
    }).join('');
  }

  const brandHref = isAdmin ? 'overview.html' : 'overview.html';
  const adminBadge = isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
  const homeHref = isAdmin ? '../admin-login.html' : '../index.html';

  const sidebar = `
<aside class="sidebar">
  <a href="${brandHref}" class="sidebar-brand">
    <svg viewBox="0 0 24 24" fill="none"><path d="M3 6.5L12 2L21 6.5V13C21 17.5 17 20.5 12 22C7 20.5 3 17.5 3 13V6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.2" fill="currentColor"/><path d="M7 11H9.5M14.5 11H17M12 6V8.5M12 13.5V16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    O11yFleet ${adminBadge}
  </a>
  <nav class="sidebar-nav">${navHtml()}</nav>
  <div class="sidebar-foot">
    ${ isAdmin ? '' : `
    <div class="org-switcher">
      <span class="org-mark">${orgInitials}</span>
      <div class="org-meta">
        <div class="org-name">${orgName}</div>
        <div class="org-plan">${orgPlan}</div>
      </div>
      <svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" width="12" height="12"><path d="M3 5l3 3 3-3M3 7l3-3 3 3" stroke-linecap="round"/></svg>
    </div>` }
  </div>
</aside>`;

  const crumbs = (opts.crumbs || []).map((c, i, arr) => {
    if (i === arr.length - 1) return `<span class="current">${c.label}</span>`;
    return `<a href="${c.href || '#'}">${c.label}</a><span class="sep">/</span>`;
  }).join('');

  const topbar = `
<header class="topbar">
  <button class="icon-btn" data-sidebar-toggle style="display: none;">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
  </button>
  <div class="crumbs">${crumbs}</div>
  <div class="search">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3" stroke-linecap="round"/></svg>
    <span>Search collectors, configs…</span>
    <span class="kbd-hint">⌘K</span>
  </div>
  <div class="topbar-right">
    <button class="icon-btn" data-theme-toggle aria-label="Theme">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 9.5A6 6 0 1 1 6.5 2c-.2 1.6.6 3.4 2 4.6 1.4 1.2 3.4 1.8 5.5.5z"/></svg>
    </button>
    <button class="icon-btn" aria-label="Notifications" data-dropdown="notif-menu" style="position: relative;">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7a4 4 0 1 1 8 0v3l1 2H3l1-2V7z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/></svg>
      <span class="dot-indicator"></span>
    </button>
    <div class="profile-wrap">
      <button class="profile" data-dropdown="profile-menu">
        <span class="avatar">${userInit}</span>
        <span style="font-weight: 450;">${userName.split(' ')[0]}</span>
        <svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" width="11" height="11"><path d="M3 5l3 3 3-3" stroke-linecap="round"/></svg>
      </button>
      <div class="dropdown" id="profile-menu">
        <div class="meta">
          <div class="name">${userName}</div>
          <div class="email">${userEmail}</div>
        </div>
        <a href="${ isAdmin ? 'settings.html' : 'settings.html' }">Account settings</a>
        ${ isAdmin ? '' : '<a href="team.html">Team</a><a href="billing.html">Plan & billing</a>'}
        <div class="divider"></div>
        <a href="#" onclick="event.preventDefault(); document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'); localStorage.setItem('fb-theme', document.documentElement.getAttribute('data-theme'));">Toggle theme</a>
        <a href="${homeHref}">Sign out</a>
      </div>
      <div class="dropdown" id="notif-menu" style="min-width: 320px;">
        <div class="meta"><div class="name">Notifications</div><div class="email">3 new</div></div>
        <a href="#"><div><div style="font-size: 13px;">Rollout v14 finished — 42/42 collectors</div><div class="email" style="margin-top: 2px;">2m ago</div></div></a>
        <a href="#"><div><div style="font-size: 13px;">otel-gateway-02 offline · 14m</div><div class="email" style="margin-top: 2px;">14m ago</div></div></a>
        <a href="#"><div><div style="font-size: 13px;">3 collectors drifted from intended config</div><div class="email" style="margin-top: 2px;">1h ago</div></div></a>
      </div>
    </div>
  </div>
</header>`;

  document.getElementById('shell-sidebar').innerHTML = sidebar;
  document.getElementById('shell-topbar').innerHTML = topbar;

  // Show prototype banner if the page declared one
  if (opts.prototype) {
    FB.prototypeBanner(opts.prototype);
  }
};
