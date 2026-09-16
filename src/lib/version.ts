/**
 * Build identity baked in by vite.config.ts: the deployed commit and when the bundle was built. The
 * same constant is compiled into the client and the Worker, so the two can be compared to detect a
 * deploy that happened while a tab was open.
 */
export type AppVersion = { sha: string; builtAt: string }

// Tests run the source without Vite, where the build constant does not exist.
export const appVersion: AppVersion = typeof __APP_VERSION__ === 'undefined' ? { sha: 'dev', builtAt: '' } : __APP_VERSION__

export const REPOSITORY_URL = 'https://github.com/qibergames/mail'

export function shortSha(sha: string) {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha
}

/** Link to the commit on GitHub, or null for a local build without a git checkout. */
export function commitUrl(sha: string) {
  return /^[0-9a-f]{40}$/i.test(sha) ? `${REPOSITORY_URL}/commit/${sha}` : null
}

/** "5 minutes ago" style age of the build, in the given locale, or null when the timestamp is unusable. */
export function describeAge(builtAt: string, locale: string, now = Date.now()) {
  const built = Date.parse(builtAt)
  if (Number.isNaN(built)) return null
  const seconds = Math.round((now - built) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]]
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(-Math.round(seconds / size), unit)
  }
  return format.format(0, 'minute')
}

export function formatBuildTime(builtAt: string, locale: string) {
  const built = Date.parse(builtAt)
  if (Number.isNaN(built)) return builtAt
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(built)
}
