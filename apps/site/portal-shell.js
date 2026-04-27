// portal-shell.js — shared shell behavior for user + admin portals.
// Sidebar toggle, profile dropdown, theme toggle, toasts, copy buttons,
// command palette stub, modals, sheets, relative time, tabs.
(function () {
  const root = document.documentElement;

  const stored = localStorage.getItem('fb-theme') || 'dark';
  root.setAttribute('data-theme', stored);

  function bindTheme() {
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = root.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        localStorage.setItem('fb-theme', next);
      });
    });
  }

  function bindDropdowns() {
    document.querySelectorAll('[data-dropdown]').forEach(trigger => {
      const id = trigger.getAttribute('data-dropdown');
      const menu = document.getElementById(id);
      if (!menu) return;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown.open').forEach(d => { if (d !== menu) d.classList.remove('open'); });
        menu.classList.toggle('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    });
  }

  function bindSidebar() {
    const t = document.querySelector('[data-sidebar-toggle]');
    const sb = document.querySelector('.sidebar');
    if (!t || !sb) return;
    t.addEventListener('click', () => sb.classList.toggle('open'));
  }

  function bindTabs() {
    document.querySelectorAll('[data-tabs]').forEach(group => {
      const name = group.dataset.tabs;
      const btns = group.querySelectorAll('.tab');
      btns.forEach(b => {
        b.addEventListener('click', () => {
          btns.forEach(x => x.classList.remove('active'));
          document.querySelectorAll(`[data-tab-panel][data-tabs-group="${name}"]`).forEach(p => p.classList.remove('active'));
          b.classList.add('active');
          const target = document.querySelector(`[data-tab-panel="${b.dataset.tab}"][data-tabs-group="${name}"]`);
          if (target) target.classList.add('active');
        });
      });
    });
  }

  window.openModal = (id) => { const m = document.getElementById(id); if (m) m.classList.add('open'); };
  window.closeModal = (id) => { const m = document.getElementById(id); if (m) m.classList.remove('open'); };
  function bindModals() {
    document.querySelectorAll('[data-open-modal]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.openModal)));
    document.querySelectorAll('.modal-backdrop').forEach(bd => bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); }));
    document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => { const m = b.closest('.modal-backdrop'); if (m) m.classList.remove('open'); }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open, .sheet.open, .sheet-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  window.openSheet = (id) => {
    const s = document.getElementById(id), bd = document.getElementById(id + '-backdrop');
    if (s) s.classList.add('open'); if (bd) bd.classList.add('open');
  };
  window.closeSheet = (id) => {
    const s = document.getElementById(id), bd = document.getElementById(id + '-backdrop');
    if (s) s.classList.remove('open'); if (bd) bd.classList.remove('open');
  };
  function bindSheets() {
    document.querySelectorAll('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.openSheet)));
    document.querySelectorAll('[data-close-sheet]').forEach(b => b.addEventListener('click', () => { const s = b.closest('.sheet'); if (s) closeSheet(s.id); }));
    document.querySelectorAll('.sheet-backdrop').forEach(bd => bd.addEventListener('click', () => closeSheet(bd.id.replace('-backdrop', ''))));
  }

  function ensureToaster() {
    let t = document.querySelector('.toaster');
    if (!t) { t = document.createElement('div'); t.className = 'toaster'; document.body.appendChild(t); }
    return t;
  }
  window.toast = function (title, body, kind) {
    const t = ensureToaster();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    const icon = kind === 'err'
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11v.01" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    el.innerHTML = icon + `<div><div class="t-title">${title}</div>${body ? `<div class="t-body">${body}</div>` : ''}</div>`;
    t.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 220); }, 3200);
  };

  function bindCopy() {
    document.querySelectorAll('.copy[data-copy]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const v = btn.dataset.copy;
        try { await navigator.clipboard.writeText(v); } catch (_) {}
        btn.classList.add('copied');
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg> copied';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1200);
      });
    });
  }

  function bindCommandPalette() {
    document.querySelectorAll('.search').forEach(s => s.addEventListener('click', () => toast('Command palette', 'Press ⌘K — full search not wired in this prototype.')));
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toast('Command palette', 'Press ⌘K — full search not wired in this prototype.');
      }
    });
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(() => {
    bindTheme(); bindDropdowns(); bindSidebar(); bindTabs();
    bindModals(); bindSheets(); bindCopy(); bindCommandPalette();
  });
})();
