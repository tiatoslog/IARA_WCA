/*
 * Service worker do IARA OS.
 *
 * Escopo deliberadamente estreito. A IARA é um sistema ao vivo: a inteligência
 * dela mora no motor, não no navegador. Cachear resposta de conversa seria
 * mentir — o operador veria um dado velho achando que é agora.
 *
 * Então aqui só entra a CASCA: os sprites do escritório, os ícones e o
 * documento. Nada de estado, nada de telemetria, nada de WebSocket (que o
 * service worker nem intercepta).
 */

const VERSAO = 'iara-v1';
const CASCA = ['/', '/icones/icone-192.png', '/icones/icone-512.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      // Um asset que falhe não pode derrubar a instalação inteira.
      .then((cache) => Promise.allSettled(CASCA.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // O barramento e as rotas internas do Next nunca passam por cache.
  if (url.pathname.startsWith('/barramento') || url.pathname.startsWith('/_next/webpack')) return;

  // Sprites e ícones: cache primeiro. São imutáveis e é o que faz a sala
  // aparecer instantânea no celular, inclusive sem rede.
  if (url.pathname.startsWith('/escritorio/') || url.pathname.startsWith('/icones/')) {
    evento.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copia = res.clone();
            void caches.open(VERSAO).then((c) => c.put(req, copia));
            return res;
          }),
      ),
    );
    return;
  }

  // Documento: rede primeiro, cache só como rede de segurança quando offline.
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          void caches.open(VERSAO).then((c) => c.put('/', copia));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
  }
});
