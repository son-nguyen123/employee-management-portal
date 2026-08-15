export type StoredShift = 'Morning' | 'Afternoon' | 'Evening'

export function parseCustomShiftNote(value: unknown): { marker: string; start: string; end: string } | null {
  if (typeof value !== 'string') return null
  const match = value.match(/\[CUSTOM:(\d{2}:\d{2})-(\d{2}:\d{2})\]/)
  if (!match) return null
  const validTime = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
  }
  if (!validTime(match[1]) || !validTime(match[2]) || match[1] >= match[2]) return null
  return { marker: match[0], start: match[1], end: match[2] }
}

export function scheduleShiftIdentity(date: Date, shift: StoredShift, note: unknown = ''): string {
  const custom = parseCustomShiftNote(note)
  return `${date.toISOString().slice(0, 10)}-${custom?.marker || shift}`
}
