import { Trans, useLingui } from '@lingui/react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthShell } from '@/components/auth-shell'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/setup')({ component: SetupPage })

function SetupPage() {
  const { i18n } = useLingui()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget))
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, turnstileToken: token }),
    })
    setLoading(false)
    if (response.ok) return location.assign('/inbox')
    const result = (await response.json().catch(() => null)) as { message?: string } | null
    setError(result?.message ?? i18n._('Setup failed'))
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader><CardTitle><Trans id="Set up QiberMail" /></CardTitle><CardDescription><Trans id="Create the first administrator and mailbox." /></CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2"><Label htmlFor="name"><Trans id="Name" /></Label><Input id="name" name="name" autoComplete="name" required maxLength={100} /></div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="grid gap-2"><Label htmlFor="username"><Trans id="Mailbox" /></Label><Input id="username" name="username" autoComplete="username" required /></div>
              <span className="pb-2">@</span>
              <div className="grid gap-2"><Label htmlFor="domain"><Trans id="Domain" /></Label><Input id="domain" name="domain" inputMode="url" placeholder="example.com" required /></div>
            </div>
            <div className="grid gap-2"><Label htmlFor="resetEmail"><Trans id="Recovery email" /></Label><Input id="resetEmail" name="resetEmail" type="email" autoComplete="email" required /></div>
            <div className="grid gap-2"><Label htmlFor="password"><Trans id="Password" /></Label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></div>
            <Turnstile onToken={setToken} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={loading || !token}>{loading ? <Trans id="Setting up…" /> : <Trans id="Create QiberMail" />}</Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
