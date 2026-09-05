import { setupI18n } from '@lingui/core'
import { compileMessage } from '@lingui/message-utils/compileMessage'
import { I18nProvider } from '@lingui/react'
import { useMemo } from 'react'
import type { Locale } from '@/lib/locale'
import { messages as en } from '@/locales/en/messages'
import { messages as hu } from '@/locales/hu/messages'

const catalogs = { en, hu }

export function LocaleProvider({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  const i18n = useMemo(() => {
    const instance = setupI18n({ locale, messages: catalogs })
    // Catalogs are plain strings; compiling them on the fly keeps ICU features working and silences lingui's warnings.
    instance.setMessagesCompiler(compileMessage)
    return instance
  }, [locale])
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
