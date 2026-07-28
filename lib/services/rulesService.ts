import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CompanyRule } from '@/lib/models/types'

const RULES_COLLECTION = 'companyRules'

/**
 * Create a new company rule (admin only)
 */
export async function createCompanyRule(ruleData: Omit<CompanyRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const rule = {
      ...ruleData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const docRef = await addDoc(collection(db, RULES_COLLECTION), rule)
    return docRef.id
  } catch (error) {
    console.error('Error creating company rule:', error)
    throw error
  }
}

/**
 * Get all active company rules
 */
export async function getActiveCompanyRules(): Promise<CompanyRule[]> {
  try {
    const q = query(
      collection(db, RULES_COLLECTION),
      where('isActive', '==', true),
      orderBy('order', 'asc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as CompanyRule))
  } catch (error) {
    console.error('Error fetching active company rules:', error)
    throw error
  }
}

/**
 * Get all company rules (admin only)
 */
export async function getAllCompanyRules(): Promise<CompanyRule[]> {
  try {
    const q = query(collection(db, RULES_COLLECTION), orderBy('order', 'asc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as CompanyRule))
  } catch (error) {
    console.error('Error fetching all company rules:', error)
    throw error
  }
}

/**
 * Update company rule
 */
export async function updateCompanyRule(ruleId: string, updates: Partial<Omit<CompanyRule, 'id' | 'createdAt'>>): Promise<void> {
  try {
    const docRef = doc(db, RULES_COLLECTION, ruleId)
    await updateDoc(docRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating company rule:', error)
    throw error
  }
}

/**
 * Delete company rule
 */
export async function deleteCompanyRule(ruleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, RULES_COLLECTION, ruleId))
  } catch (error) {
    console.error('Error deleting company rule:', error)
    throw error
  }
}
