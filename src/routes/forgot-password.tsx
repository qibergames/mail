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
  const [error, setError] = useState('')
  const [turnstileAttempt, setTurnstileAttempt] = useState(0)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email'))
    setError('')
    setMessage('')
    const result = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' }, { headers: { 'x-turnstile-token': token } })
    if (result.error?.code === 'VERIFICATION_FAILED' || result.error?.code === 'TOO_MANY_REQUESTS') {
      setError(result.error.message ?? i18n._('Verification failed'))
      setToken('')
      setTurnstileAttempt((attempt) => attempt + 1)
      return
    }
    setMessage(i18n._('If the account exists, a recovery email has been sent.'))
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader><CardTitle><Trans id="Reset password" /></CardTitle><CardDescription><Trans id="Enter your account email." /></CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2"><Label htmlFor="email"><Trans id="Email" /></Label><Input id="email" name="email" type="email" required /></div>
            <Turnstile key={turnstileAttempt} onToken={setToken} />
            {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={!token}><Trans id="Send recovery email" /></Button>
            <Button asChild variant="ghost"><Link to="/login"><Trans id="Back to sign in" /></Link></Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
