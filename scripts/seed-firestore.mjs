import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  Timestamp,
  doc,
  getDoc,
  getFirestore,
  writeBatch,
} from 'firebase/firestore'

const requiredConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const missingConfig = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingConfig.length > 0) {
  throw new Error(`Missing Firebase configuration: ${missingConfig.join(', ')}`)
}

const email = process.env.FIREBASE_SEED_EMAIL
const password = process.env.FIREBASE_SEED_PASSWORD

if (!email || !password) {
  throw new Error(
    'Set FIREBASE_SEED_EMAIL and FIREBASE_SEED_PASSWORD for an existing Firebase Authentication user.'
  )
}

const app = initializeApp(requiredConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const credential = await signInWithEmailAndPassword(auth, email, password)
const user = credential.user
const employeeRef = doc(db, 'employees', user.uid)
const employeeSnapshot = await getDoc(employeeRef)
const now = Timestamp.now()

if (!employeeSnapshot.exists()) {
  const batch = writeBatch(db)
  batch.set(employeeRef, {
    uid: user.uid,
    employeeCode: `EMP-${user.uid.slice(0, 8).toUpperCase()}`,
    fullName: user.displayName || email.split('@')[0],
    phone: '',
    email: user.email || email,
    role: 'employee',
    status: 'active',
    joinDate: now,
    createdAt: now,
    updatedAt: now,
  })
  await batch.commit()
  console.log('Created employees profile with role=employee.')
  console.log('Promote this user to admin in Firebase Console, then run the seed command again.')
  process.exit(0)
}

if (employeeSnapshot.data().role !== 'admin') {
  throw new Error(
    'The signed-in user is not an admin. Set employees/{uid}.role to admin in Firebase Console and run again.'
  )
}

const companyRules = [
  {
    id: 'punctuality',
    title: 'Punctuality and Attendance',
    content: 'Employees must arrive by the scheduled start time and report absences in advance.',
    order: 1,
  },
  {
    id: 'professional-conduct',
    title: 'Professional Conduct',
    content: 'Maintain respectful, professional behavior and follow workplace policies.',
    order: 2,
  },
  {
    id: 'data-security',
    title: 'Data Security',
    content: 'Protect company and customer information and report suspected security incidents.',
    order: 3,
  },
]

const batch = writeBatch(db)
for (const rule of companyRules) {
  batch.set(doc(db, 'companyRules', rule.id), {
    title: rule.title,
    content: rule.content,
    order: rule.order,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
}
await batch.commit()

console.log(`Seeded ${companyRules.length} companyRules documents.`)
console.log('Other collections are created automatically when the app writes its first document.')
