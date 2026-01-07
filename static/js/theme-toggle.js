(function () {
  // Theme toggle module: handles init, toggle, and reacting to system changes.
  const STORAGE_KEY = 'theme'; // 'light' | 'dark' | 'system' (explicit)
  const docEl = document.documentElement;

  function getServerPref() {
    // data attribute set on <html> by server when user is authenticated
    return docEl.dataset.serverTheme || null; // 'light' | 'dark' | 'system' | null
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    // theme is either 'dark' or 'light' (effective)
    if (theme === 'dark') {
      docEl.classList.add('dark');
    } else {
      docEl.classList.remove('dark');
    }
    // update icons and aria on any toggle buttons
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      const darkIcon = btn.querySelector('[data-theme-icon="dark"]');
      const lightIcon = btn.querySelector('[data-theme-icon="light"]');
      if (darkIcon) darkIcon.classList.toggle('hidden', theme !== 'dark');
      if (lightIcon) lightIcon.classList.toggle('hidden', theme === 'dark');
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    });

    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
  }

  function determineEffectiveTheme() {
    const stored = localStorage.getItem(STORAGE_KEY); // explicit user override: 'light' | 'dark' | 'system'
    if (stored === 'light' || stored === 'dark') return stored;
    if (stored === 'system') return systemPrefersDark() ? 'dark' : 'light';

    const server = getServerPref();
    if (server === 'light' || server === 'dark') return server;
    if (server === 'system') return systemPrefersDark() ? 'dark' : 'light';

    return systemPrefersDark() ? 'dark' : 'light';
  }

  // init on load
  function init() {
    const theme = determineEffectiveTheme();
    applyTheme(theme);

    // Attach click listeners to toggle buttons
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Cycle through modes: system -> dark -> light -> system
        const stored = localStorage.getItem(STORAGE_KEY) || 'system';
        const nextMap = { system: 'dark', dark: 'light', light: 'system' };
        const next = nextMap[stored] || 'dark';

        // Persist explicit choice (including 'system')
        localStorage.setItem(STORAGE_KEY, next);

        const effective = next === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : next;
        applyTheme(effective);
      });

      // Keyboard accessibility: Space/Enter should activate
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });

    // Listen for system preference changes and update if the stored preference is 'system' or absent
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'system' || !stored) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  // Expose a small API
  window.ThemeToggle = {
    init: init,
    set: function (theme) {
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        localStorage.setItem(STORAGE_KEY, theme);
        if (theme === 'system') {
          applyTheme(systemPrefersDark() ? 'dark' : 'light');
        } else {
          applyTheme(theme);
        }
      }
    },
    clear: function () { localStorage.removeItem(STORAGE_KEY); applyTheme(systemPrefersDark() ? 'dark' : 'light'); }
  };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
