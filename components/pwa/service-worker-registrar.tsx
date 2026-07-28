'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const registerServiceWorker = async () => {
      try {
        await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
      } catch (error) {
        console.error('Không thể đăng ký service worker:', error)
      }
    }

    if (document.readyState === 'complete') {
      void registerServiceWorker()
      return
    }

    window.addEventListener('load', registerServiceWorker, { once: true })
    return () => window.removeEventListener('load', registerServiceWorker)
  }, [])

  return null
}
