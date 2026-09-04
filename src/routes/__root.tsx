import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LocaleProvider } from '@/components/locale-provider'
import { ServiceWorker } from '@/components/service-worker'
import { ThemeProvider } from '@/components/theme-provider'
import { readCookie, resolveLocale } from '@/lib/locale'
import appCss from '@/styles.css?url'

const getLocale = createServerFn({ method: 'GET' }).handler(() => {
  const request = getRequest()
  return resolveLocale(
    readCookie(request.headers.get('cookie'), 'qibermail-locale'),
    request.headers.get('accept-language'),
  )
})

export const Route = createRootRoute({
  beforeLoad: async () => ({ locale: await getLocale() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'QiberMail' },
      { name: 'description', content: 'Self-hosted email on Cloudflare' },
      { name: 'theme-color', content: '#f6f8fc' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { locale } = Route.useRouteContext()
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
        <ServiceWorker />
        <Scripts />
      </body>
    </html>
  )
}
