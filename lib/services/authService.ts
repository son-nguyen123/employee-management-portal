import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  User,
  updateProfile,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { AuthUser } from '@/lib/models/types'

/**
 * Sign up a new user with email and password
 */
export async function signUp(email: string, password: string, displayName?: string): Promise<User> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password)
    const user = userCredential.user

    if (displayName) {
      await updateProfile(user, { displayName })
    }

    return user
  } catch (error) {
    console.error('Error signing up:', error)
    throw error
  }
}

/**
 * Sign in user with email and password
 */
export async function signIn(email: string, password: string): Promise<User> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password)
    return userCredential.user
  } catch (error) {
    console.error('Error signing in:', error)
    throw error
  }
}

/**
 * Sign in user with Google
 */
export async function signInWithGoogle(): Promise<User> {
  let hasLeftApp = false
  let returnTimer: ReturnType<typeof setTimeout> | undefined
  let stopWatchingAuth: (() => void) | undefined
  let rejectWhenIncomplete: ((reason: Error) => void) | undefined

  const incompleteError = Object.assign(
    new Error('Google sign-in did not complete after returning to the app.'),
    { code: 'auth/sign-in-incomplete' }
  )
  const returnedWithoutResult = new Promise<never>((_, reject) => {
    rejectWhenIncomplete = reject
  })
  const authenticatedUser = new Promise<User>((resolve) => {
    stopWatchingAuth = onAuthStateChanged(auth, (user) => {
      if (user) resolve(user)
    })
  })
  const markAppHidden = () => {
    hasLeftApp = true
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      markAppHidden()
      return
    }
    handleAppReturn()
  }
  const handleAppReturn = () => {
    if (!hasLeftApp) return
    if (returnTimer) clearTimeout(returnTimer)
    returnTimer = setTimeout(() => {
      if (!auth.currentUser) rejectWhenIncomplete?.(incompleteError)
    }, 1800)
  }

  try {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    window.addEventListener('pagehide', markAppHidden)
    window.addEventListener('pageshow', handleAppReturn)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const user = await Promise.race([
      signInWithPopup(auth, provider).then((credential) => credential.user),
      authenticatedUser,
      returnedWithoutResult,
    ])
    return user
  } catch (error) {
    console.error('Error signing in with Google:', error)
    throw error
  } finally {
    if (returnTimer) clearTimeout(returnTimer)
    stopWatchingAuth?.()
    window.removeEventListener('pagehide', markAppHidden)
    window.removeEventListener('pageshow', handleAppReturn)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

/**
 * Sign out current user
 */
export async function logOut(): Promise<void> {
  try {
    await signOut(auth)
  } catch (error) {
    console.error('Error signing out:', error)
    throw error
  }
}

/**
 * Get current authenticated user
 */
export function getCurrentUser(): User | null {
  return auth.currentUser
}

/**
 * Convert Firebase User to AuthUser
 */
export function convertFirebaseUserToAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  }
}

/**
 * Subscribe to auth state changes
 */
export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}

/**
 * Update user profile
 */
export async function updateUserProfile(displayName?: string, photoURL?: string): Promise<void> {
  try {
    const user = auth.currentUser
    if (user) {
      await updateProfile(user, {
        displayName: displayName || user.displayName,
        photoURL: photoURL || user.photoURL,
      })
    }
  } catch (error) {
    console.error('Error updating user profile:', error)
    throw error
  }
}

/**
 * Get user ID token
 */
export async function getUserIdToken(): Promise<string> {
  try {
    const user = auth.currentUser
    if (user) {
      return await user.getIdToken()
    }
    throw new Error('No authenticated user')
  } catch (error) {
    console.error('Error getting ID token:', error)
    throw error
  }
}
