export const DEFAULT_PROFILE_IMAGE = '/tricandy-logo.png'

export function isProfileImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const url = value.trim()
  return url === DEFAULT_PROFILE_IMAGE || /^https?:\/\//i.test(url)
}

export function profileImageUrl(value?: string | null): string {
  const url = value?.trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'drive.google.com') {
      const fileId = parsed.searchParams.get('id') || parsed.pathname.match(/\/d\/([^/]+)/)?.[1]
      if (fileId) return `/api/profile/image?fileId=${encodeURIComponent(fileId)}`
    }
  } catch {
    return url
  }
  return url
}
