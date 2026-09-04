import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { getDb } from '@/db'
import { accounts, sessions, users, verifications } from '@/db/schema'

export const auth = betterAuth({
  appName: 'QiberMail',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: { users, sessions, accounts, verifications },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) => {
      const resetEmail = 'resetEmail' in user && typeof user.resetEmail === 'string' ? user.resetEmail : user.email
      await env.OUTBOUND_QUEUE.send({
        type: 'password-reset',
        from: user.email,
        to: resetEmail,
        url,
      })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    modelName: 'sessions',
  },
  user: {
    modelName: 'users',
    additionalFields: {
      resetEmail: { type: 'string', required: false },
      forwardingEmail: { type: 'string', required: false },
      canManageMailboxes: { type: 'boolean', required: false, defaultValue: false, input: false },
      createdByUserId: { type: 'string', required: false, input: false },
    },
  },
  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },
  plugins: [
    admin({ defaultRole: 'user', adminRoles: ['admin'] }),
  ],
})
