export const initPageLoader = () => {
  const loader = document.querySelector('#pageLoader');
  if (!loader) return;
  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 600);
  };
  // Cached pages can already be "complete" before we attach `load`.
  if (document.readyState === 'complete') {
    requestAnimationFrame(hide);
    return;
  }
  window.addEventListener('load', () => hide(), { once: true });
  // Do not block the app forever if a font, extension, or subresource stalls `load`.
  setTimeout(() => hide(), 2800);
};

export const initReveal = () => {
  const items = Array.from(document.querySelectorAll('.reveal'));
  if (!items.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  items.forEach((item) => observer.observe(item));
};

export const initPasswordToggles = () => {
  const toggles = Array.from(document.querySelectorAll('[data-toggle-password]'));
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.getAttribute('data-toggle-password');
      const input = document.getElementById(targetId);
      if (!input) return;
      const nextType = input.type === 'password' ? 'text' : 'password';
      input.type = nextType;
      toggle.textContent = nextType === 'password' ? 'Show' : 'Hide';
    });
  });
};

export const initUI = () => {
  initPageLoader();
  initReveal();
  initPasswordToggles();
};
