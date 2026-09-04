import { Trans, useLingui } from '@lingui/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const { i18n } = useLingui()
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return setMessage(i18n._('The recovery link is invalid.'))
    const password = String(new FormData(event.currentTarget).get('password'))
    const result = await authClient.resetPassword({ newPassword: password, token })
    if (result.error) return setMessage(result.error.message ?? i18n._('Password reset failed'))
    setDone(true)
    setMessage(i18n._('Your password has been changed.'))
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader><CardTitle><Trans id="Choose a new password" /></CardTitle><CardDescription><Trans id="Use at least 12 characters." /></CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            {!done && <div className="grid gap-2"><Label htmlFor="password"><Trans id="New password" /></Label><Input id="password" name="password" type="password" minLength={12} required /></div>}
            {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
            {!done && <Button type="submit"><Trans id="Change password" /></Button>}
            <Button asChild variant="ghost"><Link to="/login"><Trans id="Back to sign in" /></Link></Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
