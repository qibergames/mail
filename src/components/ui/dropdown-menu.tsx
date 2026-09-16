import { Menu } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuContent({ className, side = 'bottom', align = 'start', sideOffset = 6, ...props }: ComponentProps<typeof Menu.Popup> & Pick<ComponentProps<typeof Menu.Positioner>, 'side' | 'align' | 'sideOffset'>) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50 outline-none">
        <Menu.Popup
          className={cn('min-w-56 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl outline-none transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0', className)}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

const itemClass = 'flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(itemClass, className)} {...props} />
}

/** A menu entry that navigates: renders the given link (e.g. a router Link) with the item's behaviour. */
export function DropdownMenuLinkItem({ className, ...props }: ComponentProps<typeof Menu.LinkItem>) {
  return <Menu.LinkItem className={cn(itemClass, className)} {...props} />
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemClass, 'relative pl-8', className)} {...props}>
      <Menu.RadioItemIndicator className="absolute left-2.5 grid size-4 place-items-center"><Check className="size-4" /></Menu.RadioItemIndicator>
      {children}
    </Menu.RadioItem>
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return <Menu.GroupLabel className={cn('px-3 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}
