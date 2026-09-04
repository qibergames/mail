import { Trans, useLingui } from '@lingui/react'
import { Link, Outlet } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { Button } from './ui/button'

export type SectionNavItem = { section: string; label: string; group: string; icon: LucideIcon }

export function SectionShell({ area, title, items }: { area: 'settings' | 'tools' | 'admin'; title: string; items: SectionNavItem[] }) {
  const { i18n } = useLingui()
  const groups = [...new Set(items.map((item) => item.group))]
  return <main className="min-h-dvh bg-muted p-3 md:p-6 dark:bg-background">
    <div className="mx-auto max-w-7xl space-y-4 md:space-y-6">
      <header className="flex items-center gap-3">
        <Button asChild variant="outline" size="icon" className="rounded-xl shadow-xs"><Link to="/inbox" aria-label={i18n._('Back to inbox')} title={i18n._('Back to inbox')}><ArrowLeft /></Link></Button>
        <h1 className="text-2xl font-bold tracking-tight"><Trans id={title} /></h1>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <aside className="min-w-0 rounded-2xl border bg-card p-2 shadow-sm lg:sticky lg:top-6 lg:p-3">
          <div className="grid gap-3 lg:gap-6">
            {groups.map((group) => <section key={group}>
              <h2 className="mb-1.5 hidden px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase lg:block"><Trans id={group} /></h2>
              <nav className="flex flex-wrap gap-1 lg:grid lg:gap-0.5" aria-label={i18n._(group)}>
                {items.filter((item) => item.group === group).map((item) => <SectionLink key={item.section} area={area} item={item} />)}
              </nav>
            </section>)}
          </div>
        </aside>
        <section className="min-w-0 space-y-4 md:space-y-5"><Outlet /></section>
      </div>
    </div>
  </main>
}

function SectionLink({ area, item }: { area: 'settings' | 'tools' | 'admin'; item: SectionNavItem }) {
  const content = <><item.icon className="size-4" /><Trans id={item.label} /></>
  const props = { className: 'flex min-h-9 min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-primary [&.active]:text-primary-foreground [&.active]:shadow-sm [&>svg]:shrink-0' }
  if (area === 'settings') return <Link to="/settings/$section" params={{ section: item.section }} {...props}>{content}</Link>
  if (area === 'tools') return <Link to="/tools/$section" params={{ section: item.section }} {...props}>{content}</Link>
  return <Link to="/admin/$section" params={{ section: item.section }} {...props}>{content}</Link>
}
