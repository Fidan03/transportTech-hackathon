/* The installed app launches this hosted website; no dashboard data is cached. */
(() => {
  const button = document.getElementById('install-app');
  let installPrompt;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = window.matchMedia('(display-mode: standalone)').matches;
  });

  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = undefined;
    button.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('App installation could not be started:', error);
    }
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    button.hidden = true;
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.warn('App service worker registration failed:', error);
      });
    });
  }
})();
