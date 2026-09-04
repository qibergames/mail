import { Trans, useLingui } from '@lingui/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthShell } from '@/components/auth-shell'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const { i18n } = useLingui()
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email'))
    await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' }, { headers: { 'x-turnstile-token': token } })
    setMessage(i18n._('If the account exists, a recovery email has been sent.'))
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader><CardTitle><Trans id="Reset password" /></CardTitle><CardDescription><Trans id="Enter your account email." /></CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2"><Label htmlFor="email"><Trans id="Email" /></Label><Input id="email" name="email" type="email" required /></div>
            <Turnstile onToken={setToken} />
            {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
            <Button type="submit" disabled={!token}><Trans id="Send recovery email" /></Button>
            <Button asChild variant="ghost"><Link to="/login"><Trans id="Back to sign in" /></Link></Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
