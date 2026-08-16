import 'server-only'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const ARCHIVE_FOLDER_NAME = 'Employee Portal - Weekly Archives'
const MONTHLY_ARCHIVE_FOLDER_NAME = 'Employee Portal - Monthly Archives'
const PROFILE_IMAGE_FOLDER_NAME = 'Employee Portal - Profile Images'

export interface DriveFile {
  id: string
  name: string
  mimeType?: string
  size?: string
  md5Checksum?: string
  webViewLink?: string
  createdTime?: string
  modifiedTime?: string
  appProperties?: Record<string, string>
}

export interface WeeklyArchiveFile {
  id: string
  name: string
  archiveKey: string
  size: number
  createdTime?: string
  modifiedTime?: string
  webViewLink?: string
  archiveKind: 'weekly' | 'monthly'
}

export interface DriveStorageStatus {
  configured: boolean
  accountEmail: string
  limitBytes: number | null
  usageBytes: number
  usageInDriveBytes: number
  usageInTrashBytes: number
  usagePercent: number | null
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

export async function getDriveStorageStatus(): Promise<DriveStorageStatus> {
  const accessToken = await googleAccessToken()
  const result = await driveRequest<{
    user?: { emailAddress?: string }
    storageQuota?: { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string }
  }>(accessToken, '/about?fields=user(emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)')
  const limitBytes = result.storageQuota?.limit ? Number(result.storageQuota.limit) : null
  const usageBytes = Number(result.storageQuota?.usage || 0)
  const validLimitBytes = Number.isFinite(limitBytes) && Number(limitBytes) > 0 ? Number(limitBytes) : null
  return {
    configured: true,
    accountEmail: String(result.user?.emailAddress || ''),
    limitBytes: validLimitBytes,
    usageBytes: Number.isFinite(usageBytes) ? usageBytes : 0,
    usageInDriveBytes: Number(result.storageQuota?.usageInDrive || 0),
    usageInTrashBytes: Number(result.storageQuota?.usageInDriveTrash || 0),
    usagePercent: validLimitBytes
      ? Math.round((usageBytes / validLimitBytes) * 10_000) / 100
      : null,
  }
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

async function findFiles(
  accessToken: string,
  query: string,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `${query} and trashed = false`,
    spaces: 'drive',
    pageSize: '100',
    fields: 'files(id,name,size,md5Checksum,webViewLink,appProperties)',
  })
  const result = await driveRequest<{ files?: DriveFile[] }>(
    accessToken,
    `/files?${params.toString()}`,
  )
  return result.files ?? []
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

async function ensureMonthlyArchiveFolder(accessToken: string): Promise<string> {
  const existing = await findFile(
    accessToken,
    `mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='portalMonthlyArchiveFolder' and value='true' }`,
  )
  if (existing) return existing.id

  const folder = await driveRequest<DriveFile>(accessToken, '/files?fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: MONTHLY_ARCHIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        portalMonthlyArchiveFolder: 'true',
        application: 'employee-management-portal',
      },
    }),
  })
  return folder.id
}

async function ensureDatedArchiveFolder(
  accessToken: string,
  rootFolderId: string,
  archiveKey: string,
  archiveKind: 'weekly' | 'monthly',
): Promise<string> {
  const [year, month] = archiveKey.split('-')
  if (!/^\d{4}$/.test(year || '') || !/^\d{2}$/.test(month || '')) return rootFolderId

  const ensureChild = async (parentId: string, name: string, level: 'year' | 'month') => {
    const property = `${archiveKind}-${level}-${level === 'year' ? year : `${year}-${month}`}`
    const existing = await findFile(
      accessToken,
      `'${escapeDriveQuery(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='portalArchivePeriod' and value='${property}' }`,
    )
    if (existing) return existing.id
    const folder = await driveRequest<DriveFile>(accessToken, '/files?fields=id,name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
        appProperties: {
          portalArchivePeriod: property,
          archiveKind,
          application: 'employee-management-portal',
        },
      }),
    })
    return folder.id
  }

  const yearFolderId = await ensureChild(rootFolderId, year, 'year')
  return ensureChild(yearFolderId, `Tháng ${month}`, 'month')
}

async function ensureProfileImageFolder(accessToken: string): Promise<string> {
  const existing = await findFile(
    accessToken,
    `mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='portalProfileImageFolder' and value='true' }`,
  )
  if (existing) return existing.id

  const folder = await driveRequest<DriveFile>(accessToken, '/files?fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: PROFILE_IMAGE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        portalProfileImageFolder: 'true',
        application: 'employee-management-portal',
      },
    }),
  })
  return folder.id
}

export async function storeProfileImage(params: {
  employeeId: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: Buffer
}): Promise<{ id: string; url: string }> {
  const accessToken = await googleAccessToken()
  const folderId = await ensureProfileImageFolder(accessToken)
  const extension = params.contentType === 'image/png' ? 'png' : params.contentType === 'image/webp' ? 'webp' : 'jpg'
  const boundary = `codex-profile-${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: `profile-${params.employeeId}-${Date.now()}.${extension}`,
    mimeType: params.contentType,
    parents: [folderId],
    appProperties: {
      portalProfileImage: 'true',
      employeeId: params.employeeId,
      application: 'employee-management-portal',
    },
  })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${params.contentType}\r\n\r\n`),
    params.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const response = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    body,
    cache: 'no-store',
  })
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500)
    throw new Error(`Google Drive profile upload failed (${response.status}): ${details}`)
  }
  const file = await response.json() as { id: string }
  const permissions = await driveRequest<{ permissions?: Array<{ type?: string; role?: string }> }>(
    accessToken,
    `/files/${encodeURIComponent(file.id)}/permissions?fields=permissions(type,role)`,
  )
  const alreadyPublic = permissions.permissions?.some(
    (permission) => permission.type === 'anyone' && permission.role === 'reader',
  )
  if (!alreadyPublic) {
    const permission = await fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}/permissions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      cache: 'no-store',
    })
    if (!permission.ok) {
      const details = (await permission.text()).slice(0, 500)
      throw new Error(`Google Drive profile permission failed (${permission.status}): ${details}`)
    }
  }
  return {
    id: file.id,
    url: `https://drive.google.com/uc?export=view&id=${encodeURIComponent(file.id)}`,
  }
}

export async function deleteProfileImage(
  employeeId: string,
  fileId: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) return
  const accessToken = await googleAccessToken()
  const metadata = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?fields=id,appProperties`,
  )
  if (
    metadata.appProperties?.application !== 'employee-management-portal' ||
    metadata.appProperties.portalProfileImage !== 'true' ||
    metadata.appProperties.employeeId !== employeeId
  ) {
    throw new Error('The requested file is not owned by this employee profile.')
  }
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok && response.status !== 404) {
    const details = (await response.text()).slice(0, 500)
    throw new Error(`Google Drive profile delete failed (${response.status}): ${details}`)
  }
}

export async function deleteOtherProfileImages(
  employeeId: string,
  keepFileId: string,
): Promise<void> {
  const accessToken = await googleAccessToken()
  const safeEmployeeId = escapeDriveQuery(employeeId)
  const files = await findFiles(
    accessToken,
    `appProperties has { key='portalProfileImage' and value='true' } and appProperties has { key='employeeId' and value='${safeEmployeeId}' }`,
  )
  const staleFiles = files.filter((file) => file.id !== keepFileId)
  await Promise.all(staleFiles.map(async (file) => {
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!response.ok && response.status !== 404) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`Google Drive profile cleanup failed (${response.status}): ${details}`)
    }
  }))
}

export async function deleteAllProfileImages(employeeId: string): Promise<number> {
  const accessToken = await googleAccessToken()
  const safeEmployeeId = escapeDriveQuery(employeeId)
  const files = await findFiles(
    accessToken,
    `appProperties has { key='portalProfileImage' and value='true' } and appProperties has { key='employeeId' and value='${safeEmployeeId}' }`,
  )
  await Promise.all(files.map(async (file) => {
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!response.ok && response.status !== 404) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`Google Drive profile cleanup failed (${response.status}): ${details}`)
    }
  }))
  return files.length
}

export async function readProfileImage(fileId: string): Promise<{
  contentType: string
  bytes: ArrayBuffer
}> {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) {
    throw new Error('Invalid Google Drive profile image ID.')
  }
  const accessToken = await googleAccessToken()
  const metadata = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,appProperties`,
  )
  if (
    metadata.appProperties?.application !== 'employee-management-portal' ||
    metadata.appProperties.portalProfileImage !== 'true' ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(metadata.mimeType || '')
  ) {
    throw new Error('The requested file is not an Employee Portal profile image.')
  }
  const response = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    throw new Error(`Google Drive profile image download failed (${response.status}).`)
  }
  return {
    contentType: metadata.mimeType!,
    bytes: await response.arrayBuffer(),
  }
}

async function uploadJsonFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  archiveKey: string,
  checksum: string,
  json: string,
  archiveKind: 'weekly' | 'monthly' | 'connection-test' = 'weekly',
): Promise<DriveFile> {
  const boundary = `codex-archive-${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
    appProperties: {
      archiveKey,
      checksum,
      archiveKind,
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

  const folderId = await ensureDatedArchiveFolder(
    accessToken,
    await ensureArchiveFolder(accessToken),
    params.archiveKey,
    'weekly',
  )
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

export async function storeMonthlyArchive(params: {
  archiveKey: string
  checksum: string
  json: string
}): Promise<DriveFile> {
  const accessToken = await googleAccessToken()
  const archiveKey = escapeDriveQuery(params.archiveKey)
  const checksum = escapeDriveQuery(params.checksum)
  const existing = await findFile(
    accessToken,
    `appProperties has { key='archiveKind' and value='monthly' } and appProperties has { key='archiveKey' and value='${archiveKey}' } and appProperties has { key='checksum' and value='${checksum}' }`,
  )
  if (existing) return existing

  const folderId = await ensureDatedArchiveFolder(
    accessToken,
    await ensureMonthlyArchiveFolder(accessToken),
    params.archiveKey,
    'monthly',
  )
  const file = await uploadJsonFile(
    accessToken,
    folderId,
    `employee-portal-month-${params.archiveKey}.json`,
    params.archiveKey,
    params.checksum,
    params.json,
    'monthly',
  )
  const verified = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(file.id)}?fields=id,name,size,md5Checksum,webViewLink,appProperties`,
  )
  if (!verified.size || Number(verified.size) <= 0) throw new Error('Google Drive returned an empty monthly archive file.')
  return verified
}

async function listArchivesInFolder(
  accessToken: string,
  _folderId: string,
  archiveKind: 'weekly' | 'monthly',
): Promise<WeeklyArchiveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `appProperties has { key='application' and value='employee-management-portal' } and appProperties has { key='archiveKind' and value='${archiveKind}' } and trashed = false`,
      spaces: 'drive',
      pageSize: '100',
      orderBy: 'createdTime desc',
      fields: 'nextPageToken,files(id,name,size,createdTime,modifiedTime,webViewLink,appProperties)',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const result = await driveRequest<{ files?: DriveFile[]; nextPageToken?: string }>(
      accessToken,
      `/files?${params.toString()}`,
    )
    files.push(...(result.files || []))
    pageToken = result.nextPageToken
  } while (pageToken)

  return files
    .filter((file) => Boolean(file.appProperties?.archiveKey) && !file.name.startsWith('_connection-test-'))
    .map((file) => ({
      id: file.id,
      name: file.name,
      archiveKey: file.appProperties!.archiveKey,
      size: Number(file.size || 0),
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      archiveKind,
    }))
}

export async function listWeeklyArchives(): Promise<WeeklyArchiveFile[]> {
  const accessToken = await googleAccessToken()
  return listArchivesInFolder(accessToken, await ensureArchiveFolder(accessToken), 'weekly')
}

export async function listMonthlyArchives(): Promise<WeeklyArchiveFile[]> {
  const accessToken = await googleAccessToken()
  return listArchivesInFolder(accessToken, await ensureMonthlyArchiveFolder(accessToken), 'monthly')
}

export async function listAllArchives(): Promise<WeeklyArchiveFile[]> {
  const accessToken = await googleAccessToken()
  const [weeklyFolderId, monthlyFolderId] = await Promise.all([
    ensureArchiveFolder(accessToken),
    ensureMonthlyArchiveFolder(accessToken),
  ])
  const files = await Promise.all([
    listArchivesInFolder(accessToken, weeklyFolderId, 'weekly'),
    listArchivesInFolder(accessToken, monthlyFolderId, 'monthly'),
  ])
  return files.flat().sort((left, right) =>
    String(right.createdTime || '').localeCompare(String(left.createdTime || '')),
  )
}

export async function readArchive(fileId: string): Promise<unknown> {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) {
    throw new Error('Invalid Google Drive archive file ID.')
  }
  const accessToken = await googleAccessToken()
  const metadata = await driveRequest<DriveFile>(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?fields=id,name,size,appProperties`,
  )
  if (
    metadata.appProperties?.application !== 'employee-management-portal' ||
    !metadata.appProperties.archiveKey
  ) {
    throw new Error('The requested file is not an Employee Portal archive.')
  }
  if (Number(metadata.size || 0) > 20 * 1024 * 1024) {
    throw new Error('Archive file is too large to display safely.')
  }
  return driveRequest<unknown>(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?alt=media`,
  )
}

export const readWeeklyArchive = readArchive

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
    'connection-test',
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
