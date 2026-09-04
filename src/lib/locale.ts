export const locales = ['hu', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'hu'

export function isLocale(value: string | null | undefined): value is Locale {
  return locales.some((locale) => locale === value)
}

export function resolveLocale(cookieLocale: string | null, acceptLanguage: string | null): Locale {
  if (isLocale(cookieLocale)) return cookieLocale

  for (const language of acceptLanguage?.split(',') ?? []) {
    const code = language.trim().split(';')[0]?.split('-')[0]?.toLowerCase()
    if (isLocale(code)) return code
  }

  return defaultLocale
}

export function readCookie(cookie: string | null, name: string) {
  const prefix = `${encodeURIComponent(name)}=`
  const value = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return value ? decodeURIComponent(value.slice(prefix.length)) : null
}
