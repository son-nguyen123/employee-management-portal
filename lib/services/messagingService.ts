import { getInstallations, getId } from 'firebase/installations'
import {
  getMessaging,
  isSupported,
  onMessage,
  onRegistered,
  onUnregistered,
  register,
  unregister,
  type MessagePayload,
  type Messaging,
  type Unsubscribe,
} from 'firebase/messaging'
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import app, { db } from '@/lib/firebase'

const SERVICE_WORKER_PATH = '/firebase-messaging-sw.js'

let messagingInstance: Messaging | null = null
let registrationObserver: Unsubscribe | null = null
let unregistrationObserver: Unsubscribe | null = null

export type PushPermissionState =
  | NotificationPermission
  | 'unsupported'
  | 'unavailable'

export interface PushRegistrationResult {
  fid: string
  permission: NotificationPermission
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

function assertBrowser(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('Thông báo đẩy chỉ hoạt động trên trình duyệt.')
  }
}

async function getMessagingInstance(): Promise<Messaging> {
  assertBrowser()
  if (!(await isSupported())) {
    throw new Error('Trình duyệt này chưa hỗ trợ thông báo đẩy.')
  }

  if (!messagingInstance) {
    messagingInstance = getMessaging(app)
  }

  return messagingInstance
}

async function saveDeviceRegistration(employeeId: string, fid: string): Promise<void> {
  const deviceRef = doc(
    db,
    'employees',
    employeeId,
    'notificationDevices',
    fid
  )
  const existingDevice = await getDoc(deviceRef)
  const deviceData = {
    employeeId,
    fid,
    platform: navigator.userAgent.slice(0, 300),
    permission: 'granted' as const,
    updatedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  }

  if (existingDevice.exists()) {
    await setDoc(deviceRef, deviceData, { merge: true })
    return
  }

  await setDoc(deviceRef, {
    ...deviceData,
    createdAt: serverTimestamp(),
  })
}

function observeRegistrationChanges(
  messaging: Messaging,
  employeeId: string
): Promise<string> {
  registrationObserver?.()
  unregistrationObserver?.()

  return new Promise((resolve, reject) => {
    registrationObserver = onRegistered(messaging, (fid) => {
      void saveDeviceRegistration(employeeId, fid)
        .then(() => resolve(fid))
        .catch((error) => {
          console.error('Không thể đồng bộ thiết bị nhận thông báo:', error)
          reject(error)
        })
    })

    unregistrationObserver = onUnregistered(messaging, (fid) => {
      void deleteDoc(
        doc(db, 'employees', employeeId, 'notificationDevices', fid)
      ).catch((error) => {
        console.error('Không thể xóa thiết bị nhận thông báo:', error)
      })
    })
  })
}

async function registerPushDevice(
  employeeId: string,
  permission: NotificationPermission
): Promise<PushRegistrationResult> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    throw new Error('Ứng dụng chưa có NEXT_PUBLIC_FIREBASE_VAPID_KEY.')
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    SERVICE_WORKER_PATH,
    { scope: '/' }
  )
  await navigator.serviceWorker.ready

  const messaging = await getMessagingInstance()
  // Attach the callback before register(). Calling register() again refreshes
  // stale registrations and emits the current FID for Firestore synchronization.
  const firstRegistration = observeRegistrationChanges(messaging, employeeId)
  try {
    await register(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    })
    const fid = await firstRegistration
    return { fid, permission }
  } catch (error) {
    registrationObserver?.()
    unregistrationObserver?.()
    registrationObserver = null
    unregistrationObserver = null
    throw error
  }
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {
    return 'unsupported'
  }

  if (!(await isSupported())) {
    return 'unavailable'
  }

  return Notification.permission
}

export async function isPushDeviceRegistered(employeeId: string): Promise<boolean> {
  const state = await getPushPermissionState()
  if (state !== 'granted') return false

  const fid = await getId(getInstallations(app))
  const snapshot = await getDoc(
    doc(db, 'employees', employeeId, 'notificationDevices', fid)
  )
  return snapshot.exists()
}

export async function enablePushNotifications(
  employeeId: string
): Promise<PushRegistrationResult> {
  assertBrowser()

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Bạn đã chặn thông báo trong cài đặt trình duyệt.'
        : 'Bạn chưa cấp quyền nhận thông báo.'
    )
  }

  return registerPushDevice(employeeId, permission)
}

export async function syncPushDeviceRegistration(
  employeeId: string
): Promise<PushRegistrationResult | null> {
  assertBrowser()
  const permission = await getPushPermissionState()
  if (permission !== 'granted') return null
  return registerPushDevice(employeeId, permission)
}

export async function disablePushNotifications(employeeId: string): Promise<void> {
  assertBrowser()

  const messaging = await getMessagingInstance()
  const fid = await getId(getInstallations(app))
  await unregister(messaging)
  await deleteDoc(
    doc(db, 'employees', employeeId, 'notificationDevices', fid)
  )

  registrationObserver?.()
  unregistrationObserver?.()
  registrationObserver = null
  unregistrationObserver = null
}

export async function subscribeToForegroundMessages(
  callback: (payload: MessagePayload) => void
): Promise<Unsubscribe> {
  const state = await getPushPermissionState()
  if (state !== 'granted') {
    return () => undefined
  }

  const messaging = await getMessagingInstance()
  return onMessage(messaging, callback)
}

/**
 * Keep the installed PWA icon in sync where the Badging API is available.
 * Unsupported and older devices silently keep using the in-app navigation badge.
 */
export async function syncAppIconBadge(unreadCount: number): Promise<void> {
  if (typeof navigator === 'undefined') return
  const badgeNavigator = navigator as BadgeNavigator
  try {
    if (unreadCount > 0 && badgeNavigator.setAppBadge) {
      await badgeNavigator.setAppBadge(Math.min(unreadCount, 99))
    } else if (unreadCount === 0 && badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge()
    }
  } catch (error) {
    // Badge support varies by browser/installation mode and must never affect app use.
    console.debug('Không thể đồng bộ huy hiệu ứng dụng:', error)
  }
}
