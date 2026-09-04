export {}

declare global {
  interface QiberMailSecrets {
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    CF_TOKEN?: string
    CF_EMAIL?: string
    CF_API_KEY?: string
    CF_EMAIL_WORKER_NAME?: string
    TURNSTILE_SECRET_KEY?: string
    VITE_TURNSTILE_SITE_KEY?: string
    VAPID_SUBJECT?: string
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
    CF_AID?: string
    D1_DATABASE_ID?: string
    D1_BACKUP_TOKEN?: string
    GITHUB_UPDATE_TOKEN?: string
    GITHUB_UPDATE_REPO?: string
    GITHUB_UPDATE_REF?: string
  }

  interface CloudflareEnv extends QiberMailSecrets {}

  namespace Cloudflare {
    interface Env extends QiberMailSecrets {}
  }
}
