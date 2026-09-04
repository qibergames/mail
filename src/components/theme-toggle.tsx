import { Laptop, Moon, Sun } from 'lucide-react'
import { useTheme } from './theme-provider'
import type { Theme } from '@/lib/theme'
import { Button } from '@/components/ui/button'

const choices: Array<{ value: Theme; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Laptop },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Theme">
      {choices.map(({ value, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant={theme === value ? 'secondary' : 'ghost'}
          size="icon-sm"
          className="rounded-lg"
          aria-label={value}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  )
}
