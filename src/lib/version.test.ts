import { describe, expect, test } from 'bun:test'
import { commitUrl, describeAge, shortSha } from './version'
import { isNewer } from './app-update'

const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'

describe('version', () => {
  test('shortens a commit and links it, but leaves a local build alone', () => {
    expect(shortSha(sha)).toBe('a1b2c3d')
    expect(commitUrl(sha)).toBe(`https://github.com/qibergames/mail/commit/${sha}`)
    expect(shortSha('dev')).toBe('dev')
    expect(commitUrl('dev')).toBeNull()
  })

  test('describes the build age in the reader\'s language', () => {
    const now = Date.parse('2026-09-16T12:00:00Z')
    expect(describeAge('2026-09-16T09:00:00Z', 'en', now)).toBe('3 hours ago')
    expect(describeAge('2026-09-14T12:00:00Z', 'hu', now)).toBe('tegnapelőtt')
    expect(describeAge('2026-09-16T11:59:40Z', 'en', now)).toBe('this minute')
    expect(describeAge('nonsense', 'en', now)).toBeNull()
  })
})

describe('update detection', () => {
  const current = { sha, builtAt: '2026-09-16T10:00:00Z' }
  test('only a different commit built later counts as an update', () => {
    expect(isNewer(current, current)).toBe(false)
    expect(isNewer({ sha: 'ffff', builtAt: '2026-09-16T11:00:00Z' }, current)).toBe(true)
    expect(isNewer({ sha: 'ffff', builtAt: '2026-09-16T09:00:00Z' }, current)).toBe(false)
    expect(isNewer({ sha: 'ffff', builtAt: 'unknown' }, current)).toBe(true)
  })
})
