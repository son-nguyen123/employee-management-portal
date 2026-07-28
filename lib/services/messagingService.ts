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

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    throw new Error('Ứng dụng chưa có NEXT_PUBLIC_FIREBASE_VAPID_KEY.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Bạn đã chặn thông báo trong cài đặt trình duyệt.'
        : 'Bạn chưa cấp quyền nhận thông báo.'
    )
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    SERVICE_WORKER_PATH,
    { scope: '/' }
  )
  await navigator.serviceWorker.ready

  const messaging = await getMessagingInstance()
  // Firebase's FID API requires onRegistered() to be attached before
  // register(). Persist only from that callback so the initial document is
  // written once and cannot race with a second create/update.
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
