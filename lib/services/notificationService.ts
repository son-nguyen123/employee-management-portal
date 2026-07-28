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
