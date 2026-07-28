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
): void {
  registrationObserver?.()
  unregistrationObserver?.()

  registrationObserver = onRegistered(messaging, (fid) => {
    void saveDeviceRegistration(employeeId, fid).catch((error) => {
      console.error('Không thể đồng bộ thiết bị nhận thông báo:', error)
    })
  })

  unregistrationObserver = onUnregistered(messaging, (fid) => {
    void deleteDoc(
      doc(db, 'employees', employeeId, 'notificationDevices', fid)
    ).catch((error) => {
      console.error('Không thể xóa thiết bị nhận thông báo:', error)
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
  // Register and persist the first device before attaching the lifecycle
  // observer. Attaching it earlier makes onRegistered and this initial save
  // race: both see a missing document, then the second write is evaluated as
  // an update with a different createdAt and is correctly rejected by Rules.
  await register(messaging, {
    vapidKey,
    serviceWorkerRegistration,
  })

  const fid = await getId(getInstallations(app))
  await saveDeviceRegistration(employeeId, fid)
  observeRegistrationChanges(messaging, employeeId)

  return { fid, permission }
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
