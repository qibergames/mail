import type { LinguiConfig } from '@lingui/conf'

export default {
  locales: ['hu', 'en'],
  sourceLocale: 'en',
  fallbackLocales: { default: 'hu' },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
    },
  ],
} satisfies LinguiConfig
