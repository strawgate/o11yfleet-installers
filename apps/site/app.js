// Theme toggle — persists to localStorage, defaults to dark.
(function () {
  const root = document.documentElement;
  const stored = localStorage.getItem('fb-theme');
  const initial = stored || 'dark';
  root.setAttribute('data-theme', initial);

  function bindToggle() {
    const btns = document.querySelectorAll('[data-theme-toggle]');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = root.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        localStorage.setItem('fb-theme', next);
      });
    });
  }

  function bindMobileNav() {
    const t = document.querySelector('[data-mobile-toggle]');
    const n = document.querySelector('[data-nav]');
    if (!t || !n) return;
    t.addEventListener('click', () => n.classList.toggle('open'));
  }

  function bindReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(e => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    els.forEach(e => io.observe(e));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindToggle();
    bindMobileNav();
    bindReveal();
  });
})();
