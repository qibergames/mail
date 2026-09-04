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

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const { i18n } = useLingui()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const result = await authClient.signIn.email(
      { email: String(data.get('email')), password: String(data.get('password')) },
      { headers: { 'x-turnstile-token': token } },
    )
    setLoading(false)
    if (result.error) return setError(result.error.message ?? i18n._('Login failed'))
    location.assign('/inbox')
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle><Trans id="Sign in" /></CardTitle>
          <CardDescription><Trans id="Sign in to your QiberMail account." /></CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2"><Label htmlFor="email"><Trans id="Email" /></Label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
            <div className="grid gap-2"><Label htmlFor="password"><Trans id="Password" /></Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <Turnstile onToken={setToken} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={loading || !token}>{loading ? <Trans id="Signing in…" /> : <Trans id="Sign in" />}</Button>
            <Button asChild type="button" variant="ghost"><Link to="/forgot-password"><Trans id="Forgot password?" /></Link></Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
