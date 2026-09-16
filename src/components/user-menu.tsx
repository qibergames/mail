import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, Settings, ShieldAlert, Wrench } from 'lucide-react'
import { AppVersion } from './app-version'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuLinkItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

type Mailbox = { id: string; name: string | null; address: string }

/** Initials for the avatar: first letters of the first two words of the name, or the address's first letter. */
export function initialsOf(name: string | null | undefined, fallback: string) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const letters = words.length ? words.slice(0, 2).map((word) => word[0]) : [fallback.trim().charAt(0) || '?']
  return letters.join('').toUpperCase()
}

/**
 * Account block at the foot of the sidebar: who is signed in and which mailbox is open, with the
 * mailbox switcher, the settings links and sign-out folded into one menu.
 */
export function UserMenu({ user, mailboxes, mailboxId, onSwitchMailbox, onSignOut }: {
  user: { name: string; email: string; role?: string | null } | undefined
  mailboxes: Array<Mailbox>
  mailboxId: string
  onSwitchMailbox: (id: string) => void
  onSignOut: () => void
}) {
  const { i18n } = useLingui()
  const mailbox = mailboxes.find((box) => box.id === mailboxId)
  const name = user?.name || mailbox?.name || mailbox?.address || ''
  const subtitle = mailbox?.address ?? user?.email ?? ''
  return <div className="grid gap-1">
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-accent" aria-label={i18n._('Account menu')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{initialsOf(name, subtitle)}</span>
        <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate text-sm font-semibold">{name}</span><span className="truncate text-xs text-muted-foreground">{subtitle}</span></span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-[calc(16rem-2rem)]">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{initialsOf(name, subtitle)}</span>
          <span className="grid min-w-0 leading-tight"><span className="truncate text-sm font-semibold">{name}</span><span className="truncate text-xs text-muted-foreground">{user?.email}</span></span>
        </div>
        {mailboxes.length > 0 && <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel><Trans id="Switch mailbox" /></DropdownMenuLabel>
            <DropdownMenuRadioGroup value={mailboxId} onValueChange={(value) => onSwitchMailbox(String(value))}>
              {mailboxes.map((box) => <DropdownMenuRadioItem key={box.id} value={box.id}><span className="grid min-w-0 leading-tight">{box.name && <span className="truncate">{box.name}</span>}<span className={box.name ? 'truncate text-xs text-muted-foreground' : 'truncate'}>{box.address}</span></span></DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </>}
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link to="/settings/$section" params={{ section: 'profile' }} />}><Settings /><Trans id="Settings" /></DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link to="/tools/$section" params={{ section: 'contacts' }} />}><Wrench /><Trans id="Tools" /></DropdownMenuLinkItem>
        {user?.role === 'admin' && <DropdownMenuLinkItem render={<Link to="/admin/$section" params={{ section: 'accounts' }} />}><ShieldAlert /><Trans id="Administration" /></DropdownMenuLinkItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}><LogOut /><Trans id="Sign out" /></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AppVersion />
  </div>
}
