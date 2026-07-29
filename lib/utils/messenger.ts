const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'mobile.facebook.com',
])

export function toMessengerUrl(facebookUrl: string): string {
  const value = facebookUrl.trim()
  if (!value) return value

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'm.me' || host === 'www.m.me') return value
    if (!FACEBOOK_HOSTS.has(host)) return value

    const profileId = url.searchParams.get('id')?.trim()
    if (url.pathname.toLowerCase() === '/profile.php' && profileId) {
      return `https://m.me/${encodeURIComponent(profileId)}`
    }

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0]?.toLowerCase() === 'people' && segments.at(-1)) {
      return `https://m.me/${encodeURIComponent(segments.at(-1)!)}`
    }

    const username = segments[0]
    if (username && !['share', 'sharer', 'messages', 'watch', 'reel'].includes(username.toLowerCase())) {
      return `https://m.me/${encodeURIComponent(username)}`
    }
  } catch {
    return value
  }

  return value
}
