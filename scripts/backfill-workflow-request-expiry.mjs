import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
if (!projectId) throw new Error('Missing Firebase project id')

const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
const cliConfig = JSON.parse(await readFile(configPath, 'utf8'))
const accessToken = cliConfig.tokens?.access_token
if (!accessToken) throw new Error('Firebase CLI is not logged in. Run firebase login first.')

const apply = process.argv.includes('--apply')
const ttlMs = 45 * 24 * 60 * 60 * 1000
const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
const missing = []
let pageToken = ''

do {
  const url = new URL(`${root}/workflowRequests`)
  url.searchParams.set('pageSize', '300')
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`workflowRequests: ${response.status} ${await response.text()}`)
  const result = await response.json()
  for (const document of result.documents || []) {
    if (document.fields?.expiresAt) continue
    const createdAt = document.fields?.createdAt?.timestampValue
    if (!createdAt) {
      console.warn(`Skipping ${document.name}: missing createdAt`)
      continue
    }
    const expiresAt = new Date(new Date(createdAt).getTime() + ttlMs)
    missing.push({
      name: document.name,
      expiresAt: expiresAt.toISOString(),
    })
  }
  pageToken = result.nextPageToken || ''
} while (pageToken)

console.log(`Found ${missing.length} workflowRequests without expiresAt.`)
if (!apply || !missing.length) {
  console.log(apply ? 'Nothing to update.' : 'Dry run only. Re-run with --apply to write the expiry fields.')
} else {
  for (let offset = 0; offset < missing.length; offset += 400) {
    const chunk = missing.slice(offset, offset + 400)
    const response = await fetch(`${root}:batchWrite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        writes: chunk.map(({ name, expiresAt }) => ({
          update: { name, fields: { expiresAt: { timestampValue: expiresAt } } },
          updateMask: { fieldPaths: ['expiresAt'] },
        })),
      }),
    })
    if (!response.ok) throw new Error(`workflowRequests batch ${offset}: ${response.status} ${await response.text()}`)
    console.log(`Updated ${Math.min(offset + chunk.length, missing.length)}/${missing.length}`)
  }
}
