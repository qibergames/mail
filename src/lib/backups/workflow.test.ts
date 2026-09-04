import { expect, test } from 'bun:test'
import { getBackupWorkflow } from './binding'

test('backup workflow binding fails clearly when unavailable', () => {
  expect(() => getBackupWorkflow({} as CloudflareEnv)).toThrow('Database backup workflow is not configured')
})
