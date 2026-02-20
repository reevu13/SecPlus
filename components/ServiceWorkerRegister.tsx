'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
      const swUrl = `${basePath}/sw.js`;
      const scope = `${basePath}/`;
      navigator.serviceWorker.register(swUrl, { scope }).catch(() => null);
    }
  }, []);

  return null;
}
