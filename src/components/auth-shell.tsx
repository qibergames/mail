import { Mail } from 'lucide-react'
import { LocaleToggle } from './locale-toggle'
import { ThemeToggle } from './theme-toggle'

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-4">
      <div className="absolute right-4 top-4 flex gap-2">
        <LocaleToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-2xl font-semibold">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mail />
          </span>
          QiberMail
        </div>
        {children}
      </div>
    </main>
  )
}
