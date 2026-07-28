import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  QueryConstraint,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Notification } from '@/lib/models/types'

const NOTIFICATIONS_COLLECTION = 'notifications'

/**
 * Get all notifications for an employee
 */
export async function getEmployeeNotifications(employeeId: string): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Notification))
  } catch (error) {
    console.error('Error fetching employee notifications:', error)
    throw error
  }
}

/**
 * Get unread notifications for an employee
 */
export async function getUnreadNotifications(employeeId: string): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('employeeId', '==', employeeId),
      where('isRead', '==', false),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Notification))
  } catch (error) {
    console.error('Error fetching unread notifications:', error)
    throw error
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const docRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId)
    await updateDoc(docRef, {
      isRead: true,
    })
  } catch (error) {
    console.error('Error marking notification as read:', error)
    throw error
  }
}

/**
 * Mark all notifications as read for an employee
 */
export async function markAllNotificationsAsRead(employeeId: string): Promise<void> {
  try {
    const notifications = await getUnreadNotifications(employeeId)
    const updatePromises = notifications.map((notification) =>
      updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notification.id!), { isRead: true })
    )
    await Promise.all(updatePromises)
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    throw error
  }
}

/**
 * Delete notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId))
  } catch (error) {
    console.error('Error deleting notification:', error)
    throw error
  }
}

/**
 * Subscribe to real-time notifications for an employee
 */
export function subscribeToEmployeeNotifications(
  employeeId: string,
  callback: (notifications: Notification[]) => void
): () => void {
  const q = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('createdAt', 'desc')
  )

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const notifications = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Notification))
    callback(notifications)
  })

  return unsubscribe
}

/**
 * The manager badge represents work that still needs a decision, not whether
 * the notification page has been opened. It therefore follows workflow
 * statuses directly and also covers pending records created before manager
 * notifications were introduced.
 */
export function subscribeToManagementPendingCount(
  callback: (count: number) => void
): () => void {
  const counts = {
    schedules: 0,
    leaveRequests: 0,
    lateRequests: 0,
    salaryAdvances: 0,
  }
  const publish = () => callback(Object.values(counts).reduce((total, value) => total + value, 0))

  const now = new Date()
  const daysUntilNextMonday = ((8 - now.getDay()) % 7) || 7
  const nextMonday = new Date(now)
  nextMonday.setDate(now.getDate() + daysUntilNextMonday)
  nextMonday.setHours(0, 0, 0, 0)
  const nextSunday = new Date(nextMonday)
  nextSunday.setDate(nextMonday.getDate() + 6)
  nextSunday.setHours(23, 59, 59, 999)

  const scheduleQuery = query(
    collection(db, 'workSchedules'),
    where('status', 'in', ['Pending', 'Registered'])
  )
  const pendingQuery = (collectionName: string) => query(
    collection(db, collectionName),
    where('status', '==', 'Pending')
  )

  const unsubscribes = [
    onSnapshot(scheduleQuery, (snapshot) => {
      const batches = new Set<string>()
      snapshot.docs.forEach((item) => {
        const data = item.data()
        const date = data.date?.toDate?.()
        if (!(date instanceof Date) || date < nextMonday || date > nextSunday) return
        batches.add(data.batchKey || `${data.employeeId}-${nextMonday.toISOString().slice(0, 10)}`)
      })
      counts.schedules = batches.size
      publish()
    }),
    onSnapshot(pendingQuery('leaveRequests'), (snapshot) => {
      counts.leaveRequests = snapshot.size
      publish()
    }),
    onSnapshot(pendingQuery('lateRequests'), (snapshot) => {
      counts.lateRequests = snapshot.size
      publish()
    }),
    onSnapshot(pendingQuery('salaryAdvances'), (snapshot) => {
      counts.salaryAdvances = snapshot.size
      publish()
    }),
  ]

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

/**
 * Get count of unread notifications for an employee
 */
export async function getUnreadNotificationCount(employeeId: string): Promise<number> {
  try {
    const unreadNotifications = await getUnreadNotifications(employeeId)
    return unreadNotifications.length
  } catch (error) {
    console.error('Error fetching unread notification count:', error)
    throw error
  }
}
