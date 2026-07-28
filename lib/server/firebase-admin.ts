import 'server-only'

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Thiếu biến môi trường server ${name}.`)
  }
  return value
}

function firebaseAdminPrivateKey(): string {
  let privateKey = requiredEnv('FIREBASE_ADMIN_PRIVATE_KEY')

  // Accept both a raw PEM value and a JSON-quoted value copied from a
  // service-account file. Vercel also commonly stores newlines as "\n".
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    try {
      const parsed = JSON.parse(privateKey)
      if (typeof parsed === 'string') privateKey = parsed
    } catch {
      // Validation below returns a safe error without echoing the secret.
    }
  }

  privateKey = privateKey.replace(/\\n/g, '\n')
  if (
    !privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
    !privateKey.includes('-----END PRIVATE KEY-----')
  ) {
    throw new Error('Firebase Admin private key không hợp lệ.')
  }

  return privateKey
}

function getAdminApp() {
  if (getApps().length) return getApps()[0]

  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_ADMIN_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
      privateKey: firebaseAdminPrivateKey(),
    }),
  })
}

function lazyService<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const service = factory()
      const value = Reflect.get(service, property)
      return typeof value === 'function' ? value.bind(service) : value
    },
  })
}

// Keep credentials lazy so `next build` can analyze routes before Vercel injects
// runtime secrets. The first authenticated API request initializes Admin SDK.
export const adminAuth = lazyService<Auth>(() => getAuth(getAdminApp()))
export const adminDb = lazyService<Firestore>(() => getFirestore(getAdminApp()))
export const adminMessaging = lazyService<Messaging>(() => getMessaging(getAdminApp()))
