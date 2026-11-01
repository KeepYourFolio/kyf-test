/* Prototype Web Share Target : le contenu partagé reste en mémoire du service worker,
   n'est jamais écrit dans un cache, ni journalisé, ni envoyé au réseau.
   La page le réclame une seule fois par message, puis il est effacé. */
var CACHE = "kyf-test-partage-1";
var FICHIERS = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
var EN_ATTENTE = null;      /* { t: ts, title, text, url, files:[File] } */
var DUREE_MAX = 120000;     /* 2 min : au-delà, le contenu est jeté */

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FICHIERS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  /* 1. Partage entrant : POST vers l'action du manifest, traité entièrement ici, jamais transmis au réseau */
  if (r.method === "POST" && u.origin === self.location.origin && /\/partage-recu$/.test(u.pathname)) {
    e.respondWith((async function () {
      try {
        var fd = await r.formData();
        var fichiers = fd.getAll("images").filter(function (f) { return f && typeof f === "object" && f.size > 0; });
        EN_ATTENTE = {
          t: Date.now(),
          title: String(fd.get("title") || ""),
          text: String(fd.get("text") || ""),
          url: String(fd.get("url") || ""),
          files: fichiers
        };
      } catch (err) {
        EN_ATTENTE = null;   /* message d'erreur volontairement sans contenu */
      }
      return Response.redirect(new URL("./?partage=1", self.registration.scope).href, 303);
    })());
    return;
  }
  /* 2. Le reste : GET du même site uniquement, comme KYF Mobile */
  if (r.method !== "GET" || u.origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(function (rep) {
    if (rep && rep.ok) { var copie = rep.clone(); caches.open(CACHE).then(function (c) { c.put(r, copie); }); }
    return rep;
  }).catch(function () {
    return caches.match(r).then(function (m) { return m || caches.match("index.html"); });
  }));
});

/* La page réclame le contenu : une seule lecture, puis effacement */
self.addEventListener("message", function (e) {
  if (!e.data || e.data.type !== "RECLAMER_PARTAGE" || !e.ports || !e.ports[0]) return;
  var p = EN_ATTENTE;
  EN_ATTENTE = null;
  if (p && Date.now() - p.t > DUREE_MAX) p = null;
  e.ports[0].postMessage(p ? { ok: true, title: p.title, text: p.text, url: p.url, files: p.files, delai: Date.now() - p.t } : { ok: false });
});
