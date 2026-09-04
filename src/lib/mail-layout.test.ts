import { expect, test } from 'bun:test'
import { clampMessageListWidth } from './mail-layout'

test('message list resize keeps both panes usable', () => {
  expect(clampMessageListWidth(100, 1200)).toBe(288)
  expect(clampMessageListWidth(500, 1200)).toBe(500)
  expect(clampMessageListWidth(1100, 1200)).toBe(880)
})
