/* Load the original embedded data from a standalone JSON file before starting the app. */
(async function bootstrap() {
  try {
    const response = await fetch('./data/crowdcast.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    window.__CROWDCAST_DATA__ = await response.json();
    const script = document.createElement('script');
    script.src = './src/app.js';
    script.onerror = () => { throw new Error('Application script could not be loaded'); };
    document.body.appendChild(script);
  } catch (error) {
    console.error('CrowdCast initialization failed:', error);
    const note = document.createElement('div');
    note.setAttribute('role', 'alert');
    note.style.cssText = 'padding:16px;background:#fff3cd;color:#664d03;font:14px sans-serif';
    note.textContent = 'Unable to load app data. Start the included local web server and reload.';
    document.body.prepend(note);
  }
})();
