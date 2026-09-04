import { useLingui } from '@lingui/react'
import type { Locale } from '@/lib/locale'
import { Button } from '@/components/ui/button'

export function LocaleToggle() {
  const { i18n } = useLingui()

  function changeLocale(locale: Locale) {
    document.cookie = `qibermail-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
    location.reload()
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Language">
      {(['hu', 'en'] as const).map((locale) => (
        <Button
          key={locale}
          type="button"
          variant={i18n.locale === locale ? 'secondary' : 'ghost'}
          size="sm"
          className="rounded-lg px-2.5"
          aria-pressed={i18n.locale === locale}
          onClick={() => changeLocale(locale)}
        >
          {locale.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}
