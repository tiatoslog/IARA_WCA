'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker. Só em produção: em dev o SW serve casca velha e
 * transforma qualquer edição num mistério de cache.
 */
export function RegistrarPWA() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* falha de registro não pode derrubar o app */
    });
  }, []);

  return null;
}
