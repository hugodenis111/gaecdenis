// Garde seulement les fichiers de l'appli (pas les données de la ferme) pour qu'elle s'ouvre vite.
const CACHE = 'ferme-denis-v39';
const FICHIERS = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'icon.svg', 'icon-512.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE && !k.startsWith('ferme-denis-donnees')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Les données (Supabase) et les fonds de carte ne passent jamais par ce cache.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // « no-cache » : on demande toujours au serveur si le fichier a changé (réponse très courte s'il n'a pas changé),
    // pour que tout le monde ait la nouvelle version dès qu'elle est en ligne ; sans réseau, la copie gardée sert.
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => {
        // Erreur du serveur (404, 503…) : on ne remplace pas la bonne copie gardée, on la ressert si on l'a
        if (!r.ok) return caches.match(e.request).then((m) => m || r);
        const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r;
      })
      .catch(() => caches.match(e.request))
  );
});
