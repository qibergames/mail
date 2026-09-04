import { Trans, useLingui } from '@lingui/react'
import { Link, Outlet } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { Button } from './ui/button'

export type SectionNavItem = { section: string; label: string; group: string; icon: LucideIcon }

export function SectionShell({ area, title, items }: { area: 'settings' | 'tools' | 'admin'; title: string; items: SectionNavItem[] }) {
  const { i18n } = useLingui()
  const groups = [...new Set(items.map((item) => item.group))]
  return <main className="min-h-dvh bg-muted p-3 md:p-6">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon"><Link to="/inbox" aria-label={i18n._('Back to inbox')}><ArrowLeft /></Link></Button>
        <h1 className="text-2xl font-semibold"><Trans id={title} /></h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-xl border bg-background p-2 lg:sticky lg:top-6 lg:h-fit lg:p-3">
          <div className="grid gap-3 lg:gap-5">
            {groups.map((group) => <section key={group}>
              <h2 className="mb-1 hidden px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:block"><Trans id={group} /></h2>
              <nav className="flex flex-wrap gap-1 lg:grid" aria-label={i18n._(group)}>
                {items.filter((item) => item.group === group).map((item) => <SectionLink key={item.section} area={area} item={item} />)}
              </nav>
            </section>)}
          </div>
        </aside>
        <section className="min-w-0 space-y-5"><Outlet /></section>
      </div>
    </div>
  </main>
}

function SectionLink({ area, item }: { area: 'settings' | 'tools' | 'admin'; item: SectionNavItem }) {
  const content = <><item.icon className="size-4" /><Trans id={item.label} /></>
  const props = { className: 'flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground [&>svg]:shrink-0', activeOptions: { exact: true } }
  if (area === 'settings') return <Link to="/settings/$section" params={{ section: item.section }} {...props}>{content}</Link>
  if (area === 'tools') return <Link to="/tools/$section" params={{ section: item.section }} {...props}>{content}</Link>
  return <Link to="/admin/$section" params={{ section: item.section }} {...props}>{content}</Link>
}
