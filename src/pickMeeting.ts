// Default meeting for the admin "Guests" tab: the nearest one that is not before today (Asia/Jerusalem).
// Dates are DD/MM/YY and are compared as dates, not strings.

function toKey(str: string): number {
  const [d, m, y] = str.split('/').map(Number)
  if (!d || !m || !y) return NaN
  return (y < 100 ? 2000 + y : y) * 10000 + m * 100 + d
}

export function jerusalemTodayKey(now: Date = new Date()): number {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).split('-').map(Number)
  return y * 10000 + m * 100 + d
}

export function pickDefaultMeeting(meetings: string[], nextMeeting: string, todayKey: number = jerusalemTodayKey()): string {
  const known = [...new Set([...meetings, nextMeeting].filter(Boolean))].filter(d => !isNaN(toKey(d)))
  if (!known.length) return ''
  const upcoming = known.filter(d => toKey(d) >= todayKey).sort((a, b) => toKey(a) - toKey(b))
  if (upcoming.length) return upcoming[0]
  if (nextMeeting && known.includes(nextMeeting)) return nextMeeting
  return known.sort((a, b) => toKey(b) - toKey(a))[0]
}
