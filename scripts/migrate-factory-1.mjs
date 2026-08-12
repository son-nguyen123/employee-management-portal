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
const collections = ['employees', 'workSchedules', 'leaveRequests', 'lateRequests', 'salaryAdvances', 'staffRequests', 'penalties']
const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }

for (const collectionName of collections) {
  let pageToken = ''
  const missing = []
  do {
    const url = new URL(`${root}/${collectionName}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`${collectionName}: ${response.status} ${await response.text()}`)
    const result = await response.json()
    for (const document of result.documents || []) {
      const value = document.fields?.factoryId?.stringValue
      if (!['factory-1', 'factory-2'].includes(value)) missing.push(document.name)
    }
    pageToken = result.nextPageToken || ''
  } while (pageToken)

  for (let offset = 0; offset < missing.length; offset += 400) {
    const response = await fetch(`${root}:batchWrite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        writes: missing.slice(offset, offset + 400).map((name) => ({
          update: { name, fields: { factoryId: { stringValue: 'factory-1' } } },
          updateMask: { fieldPaths: ['factoryId'] },
        })),
      }),
    })
    if (!response.ok) throw new Error(`${collectionName}: ${response.status} ${await response.text()}`)
  }
  console.log(`${collectionName}: ${missing.length} document(s) -> factory-1`)
}
