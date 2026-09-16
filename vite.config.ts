import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/** The commit being built: Workers Builds exposes it, a local build asks git, anything else is "dev". */
function commitSha() {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA?.trim()
  if (fromCi) return fromCi
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const version = { sha: commitSha(), builtAt: new Date().toISOString() }

/** Stamps the service worker with the build so its caches are keyed per deploy (public/ is copied verbatim). */
function serviceWorkerVersion(): Plugin {
  return {
    name: 'qibermail:service-worker-version',
    apply: 'build',
    closeBundle() {
      const path = join('dist', 'client', 'sw.js')
      try {
        const source = readFileSync(path, 'utf8')
        writeFileSync(path, source.replace('__QIBERMAIL_VERSION__', version.sha.slice(0, 12)))
      } catch { /* not the client build */ }
    },
  }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    lingui(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    serviceWorkerVersion(),
  ],
})
