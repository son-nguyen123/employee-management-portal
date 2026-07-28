import 'server-only'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const ARCHIVE_FOLDER_NAME = 'Employee Portal - Weekly Archives'

interface DriveFile {
  id: string
  name: string
  size?: string
  md5Checksum?: string
  webViewLink?: string
  appProperties?: Record<string, string>
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing server environment variable ${name}.`)
  return value
}

async function googleAccessToken(): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
      refresh_token: requiredEnv('GOOGLE_DRIVE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })

  const result = await response.json() as { access_token?: string; error?: string }
  if (!response.ok || !result.access_token) {
    throw new Error(`Google OAuth token exchange failed: ${result.error ?? response.status}.`)
  }

  return result.access_token
}

async function driveRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500)
    throw new Error(`Google Drive API failed (${response.status}): ${details}`)
  }

  return response.json() as Promise<T>
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function findFile(
  accessToken: string,
  query: string,
): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    q: `${query} and trashed = false`,
    spaces: 'drive',
    pageSize: '10',
    fields: 'files(id,name,size,md5Checksum,webViewLink,appProperties)',
  })
  const result = await driveRequest<{ files?: DriveFile[] }>(
    accessToken,
    `/files?${params.toString()}`,
  )
  return result.files?.[0] ?? null
}

async function ensureArchiveFolder(accessToken: string): Promise<string> {
  const existing = await findFile(
    accessToken,
    `mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='portalArchiveFolder' and value='true' }`,
  )
  if (existing) return existing.id

  const folder = await driveRequest<DriveFile>(accessToken, '/files?fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: ARCHIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        portalArchiveFolder: 'true',
        application: 'employee-management-portal',
      },
    }),
  })
  return folder.id
}

async function uploadJsonFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  archiveKey: string,
  checksum: string,
  json: string,
): Promise<DriveFile> {
  const boundary = `codex-archive-${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
    appProperties: {
      archiveKey,
      checksum,
      application: 'employee-management-portal',
    },
  })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n`),
    Buffer.from(`--${boundary}--`),
  ])

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,md5Checksum,webViewLink,appProperties`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      body,
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500)
    throw new Error(`Google Drive upload failed (${response.status}): ${details}`)
  }

  return response.json() as Promise<DriveFile>
}

export async function storeWeeklyArchive(params: {
  archiveKey: string
  checksum: string
  json: string
}): Promise<DriveFile> {
  const accessToken = await googleAccessToken()
  const archiveKey = escapeDriveQuery(params.archiveKey)
  const checksum = escapeDriveQuery(params.checksum)
  const existing = await findFile(
    accessToken,
    `appProperties has { key='archiveKey' and value='${archiveKey}' } and appProperties has { key='checksum' and value='${checksum}' }`,
  )
  if (existing) return existing

  const folderId = await ensureArchiveFolder(accessToken)
  const file = await uploadJsonFile(
    accessToken,
    folderId,
    `employee-portal-week-${params.archiveKey}.json`,
    params.archiveKey,
    params.checksum,
    params.json,
  )

  const verified = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(file.id)}?fields=id,name,size,md5Checksum,webViewLink,appProperties`,
  )
  if (!verified.size || Number(verified.size) <= 0) {
    throw new Error('Google Drive returned an empty archive file.')
  }
  return verified
}

export async function testGoogleDriveArchiveConnection(): Promise<{
  uploadedBytes: number
  cleanedUp: boolean
}> {
  const accessToken = await googleAccessToken()
  const folderId = await ensureArchiveFolder(accessToken)
  const testId = `${Date.now()}-${crypto.randomUUID()}`
  const json = JSON.stringify({
    test: true,
    application: 'employee-management-portal',
  })
  const file = await uploadJsonFile(
    accessToken,
    folderId,
    `_connection-test-${testId}.json`,
    `connection-test-${testId}`,
    'connection-test',
    json,
  )
  const verified = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(file.id)}?fields=id,name,size`,
  )
  const uploadedBytes = Number(verified.size ?? 0)
  if (uploadedBytes <= 0) {
    throw new Error('Google Drive returned an empty connection-test file.')
  }

  const deleteResponse = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  )
  if (!deleteResponse.ok) {
    const details = (await deleteResponse.text()).slice(0, 500)
    throw new Error(`Google Drive test cleanup failed (${deleteResponse.status}): ${details}`)
  }

  return { uploadedBytes, cleanedUp: true }
}
