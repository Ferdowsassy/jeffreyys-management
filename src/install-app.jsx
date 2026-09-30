import React, {useEffect, useRef, useState} from 'react';
import {Download, X} from 'lucide-react';

// Preserve the browser's one-shot event when login replaces the install control.
let pendingPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pendingPrompt = event;
  window.dispatchEvent(new Event('jeffreyys-install-ready'));
});
window.addEventListener('appinstalled', () => {pendingPrompt = null;});

export function InstallApp() {
  const [prompt, setPrompt] = useState(pendingPrompt), [installed, setInstalled] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(standalone.matches || navigator.standalone === true);
    const available = () => setPrompt(pendingPrompt);
    const completed = () => {setInstalled(true);setPrompt(null);};
    update();
    standalone.addEventListener('change', update);
    window.addEventListener('jeffreyys-install-ready', available);
    window.addEventListener('appinstalled', completed);
    return () => {
      standalone.removeEventListener('change', update);
      window.removeEventListener('jeffreyys-install-ready', available);
      window.removeEventListener('appinstalled', completed);
    };
  }, []);
  if (installed) return null;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function install() {
    if (!prompt) {dialog.current.showModal();return;}
    try {await prompt.prompt(); await prompt.userChoice;}
    finally {pendingPrompt = null;setPrompt(null);}
  }
  return <div className="install-app">
    <button type="button" className="install-button" onClick={install}><Download size={16}/> App installieren</button>
    <dialog ref={dialog} className="install-dialog" aria-labelledby="install-title">
      <form method="dialog"><button className="icon-button" aria-label="Schließen"><X size={20}/></button></form>
      <img src="/icons/icon-192.png" alt="" width="56" height="56"/>
      <h2 id="install-title">Jeffreyys als App</h2>
      {apple ? <p>Öffne diese Seite in Safari. Tippe auf <strong>Teilen</strong>, dann auf <strong>Zum Home-Bildschirm</strong> und <strong>Hinzufügen</strong>.</p> : <p>Öffne das Menü deines Browsers und wähle <strong>App installieren</strong> oder <strong>Zum Startbildschirm hinzufügen</strong>. Auf dem Mac findest du in Safari <strong>Ablage → Zum Dock hinzufügen</strong>.</p>}
      <p>Danach öffnest du Jeffreyys direkt über das App-Symbol. Für Schichten und Lieferungen brauchst du eine Internetverbindung.</p>
    </dialog>
  </div>;
}
