/* The installed app launches this hosted website; no dashboard data is cached. */
(() => {
  const button = document.getElementById('install-app');
  let installPrompt;
  let installToast;
  let notified = false;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = window.matchMedia('(display-mode: standalone)').matches;
    if (!button.hidden && !notified && typeof window.Toastify === 'function') {
      notified = true;
      const content = document.createElement('div');
      const message = document.createElement('p');
      message.textContent = 'CrowdCast-ı masaüstünə əlavə edin və ikonadan rahat açın.';
      message.style.margin = '0 0 10px';
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = 'Tətbiqi quraşdır';
      action.addEventListener('click', installApp);
      content.append(message, action);
      installToast = window.Toastify({
        node: content,
        duration: 12000,
        close: true,
        gravity: 'bottom',
        position: 'right',
        stopOnFocus: true,
        ariaLive: 'polite',
        style: { background: '#0d6b80', maxWidth: 'min(360px, calc(100vw - 48px))' }
      }).showToast();
    }
  });

  async function installApp() {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = undefined;
    button.hidden = true;
    if (installToast) installToast.hideToast();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('App installation could not be started:', error);
    }
  }

  button.addEventListener('click', installApp);

  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    button.hidden = true;
    if (installToast) installToast.hideToast();
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.warn('App service worker registration failed:', error);
      });
    });
  }
})();
