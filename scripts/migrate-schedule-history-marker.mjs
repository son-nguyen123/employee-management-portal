import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
if (!projectId) throw new Error('Missing Firebase project id')

const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
const cliConfig = JSON.parse(await readFile(configPath, 'utf8'))
const accessToken = cliConfig.tokens?.access_token
if (!accessToken) throw new Error('Firebase CLI is not logged in. Run firebase login first.')

const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }

async function listCollection(collectionName) {
  const documents = []
  let pageToken = ''
  do {
    const url = new URL(`${root}/${collectionName}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`${collectionName}: ${response.status} ${await response.text()}`)
    const result = await response.json()
    documents.push(...(result.documents || []))
    pageToken = result.nextPageToken || ''
  } while (pageToken)
  return documents
}

const [employees, schedules] = await Promise.all([
  listCollection('employees'),
  listCollection('workSchedules'),
])
const employeeIdsWithHistory = new Set(schedules
  .map((document) => document.fields?.employeeId?.stringValue)
  .filter(Boolean))
const updates = employees.filter((employee) => {
  const uid = employee.name.split('/').at(-1)
  return employeeIdsWithHistory.has(uid) && employee.fields?.hasSubmittedSchedule?.booleanValue !== true
})

for (let offset = 0; offset < updates.length; offset += 400) {
  const response = await fetch(`${root}:batchWrite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      writes: updates.slice(offset, offset + 400).map((employee) => ({
        update: { name: employee.name, fields: { hasSubmittedSchedule: { booleanValue: true } } },
        updateMask: { fieldPaths: ['hasSubmittedSchedule'] },
      })),
    }),
  })
  if (!response.ok) throw new Error(`employees: ${response.status} ${await response.text()}`)
}

console.log(JSON.stringify({ employees: employees.length, schedules: schedules.length, marked: updates.length }, null, 2))
