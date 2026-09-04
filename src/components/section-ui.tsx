import { Trans } from '@lingui/react'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

export type Status = { tone: 'success' | 'error'; text: string } | null

export function Loading() {
  return <div className="grid min-h-64 place-items-center text-muted-foreground"><LoaderCircle className="animate-spin" /></div>
}

export function StatusBanner({ status }: { status: Status }) {
  if (!status) return null
  const Icon = status.tone === 'error' ? AlertCircle : CheckCircle2
  return <p role={status.tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2 break-all rounded-xl border p-3 text-sm shadow-xs', status.tone === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')}>
    <Icon className="mt-0.5 size-4 shrink-0" />{status.text}
  </p>
}

export function SectionHeader({ icon: Icon, title, description, count, children }: { icon: LucideIcon; title: string; description?: string; count?: number; children?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/15 ring-inset"><Icon className="size-6" /></span>
    <div className="min-w-0 flex-1">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl"><Trans id={title} /></h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground"><Trans id={description} /></p>}
    </div>
    {count !== undefined && <span className="w-fit shrink-0 rounded-full border bg-muted px-3 py-1 text-sm font-medium tabular-nums">{count}</span>}
    {children}
  </div>
}

export function EmptyState({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed bg-card/50 p-12 text-center text-sm text-muted-foreground">
    {Icon && <span className="grid size-12 place-items-center rounded-2xl bg-muted"><Icon className="size-6" /></span>}
    {children}
  </div>
}

export function Badge({ children, active, danger }: { children: React.ReactNode; active?: boolean; danger?: boolean }) {
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', active && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', danger && 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400', !active && !danger && 'bg-muted text-muted-foreground')}>{children}</span>
}

export function ItemGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>
}

export function ItemCard({ icon: Icon, title, description, meta, badges, actions }: { icon: LucideIcon; title: string; description?: string; meta?: string | null; badges?: React.ReactNode; actions?: React.ReactNode }) {
  return <article className="flex min-w-0 gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>
    <div className="min-w-0 flex-1">
      <h3 className="truncate font-semibold">{title}</h3>
      {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
      {meta && <p className="mt-2 break-all text-xs text-muted-foreground">{meta}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">{badges}{actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}</div>
    </div>
  </article>
}

export function Field({ label, icon: Icon, className, ...props }: React.ComponentProps<typeof Input> & { label: string; icon?: LucideIcon }) {
  return <label className={cn('grid content-start gap-2 text-sm font-medium', className)}>
    <Trans id={label} />
    {Icon
      ? <span className="relative"><Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" {...props} /></span>
      : <Input {...props} />}
  </label>
}

export function SelectField({ label, options, className, ...props }: React.ComponentProps<'select'> & { label: string; options: Array<string | [string, string]> }) {
  return <label className={cn('grid content-start gap-2 text-sm font-medium', className)}>
    <Trans id={label} />
    <span className="relative">
      <select className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring" {...props}>
        {options.map((option) => { const [value, text] = Array.isArray(option) ? option : [option, option]; return <option key={value} value={value}>{text}</option> })}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  </label>
}

export function TextAreaField({ label, className, ...props }: React.ComponentProps<'textarea'> & { label: string }) {
  return <label className={cn('grid content-start gap-2 text-sm font-medium', className)}><Trans id={label} /><textarea className="min-h-24 rounded-md border bg-background p-3 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" {...props} /></label>
}

export function CheckboxField({ label, className, ...props }: React.ComponentProps<'input'> & { label: string }) {
  return <label className={cn('flex items-center gap-2.5 text-sm font-medium', className)}><input type="checkbox" className="size-4 accent-primary" {...props} /><Trans id={label} /></label>
}
