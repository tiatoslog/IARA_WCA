import type { MetadataRoute } from 'next';

/**
 * Manifesto do PWA. É o que permite "Instalar" no Android, no Chrome desktop e
 * "Adicionar à Tela de Início" no iOS.
 *
 * `display: standalone` tira a barra do navegador: aberto do ícone, o IARA OS
 * ocupa a tela inteira e parece um aplicativo, não uma aba.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'IARA OS — Atos Log',
    short_name: 'IARA',
    description: 'O escritório digital vivo da Atos Log.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f2ece1',
    theme_color: '#e8dfd0',
    lang: 'pt-BR',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icones/icone-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
