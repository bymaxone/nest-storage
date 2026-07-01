/**
 * @fileoverview Unit tests for `pickUploadStrategy` — the full single-shot vs
 * multipart decision table.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import { pickUploadStrategy, type UploadStrategy } from './upload-strategy'
import type { UploadBody } from './stream-utils'

const THRESHOLD = 4

describe('pickUploadStrategy', () => {
  it.each<[string, UploadBody, number | undefined, UploadStrategy]>([
    ['buffer below threshold', Buffer.from('ab'), undefined, 'single-shot'],
    ['buffer at threshold', Buffer.from('abcd'), undefined, 'multipart'],
    ['Uint8Array below threshold', new Uint8Array([1, 2]), undefined, 'single-shot'],
    ['stream with declaredSize below threshold', Readable.from(['x']), 2, 'single-shot'],
    ['stream with declaredSize at threshold', Readable.from(['x']), 4, 'multipart'],
    ['stream without declaredSize', Readable.from(['x']), undefined, 'multipart'],
  ])('returns %s → %s', (_label, body, declaredSize, expected) => {
    // Each row exercises one branch of the decision table.
    expect(pickUploadStrategy(body, declaredSize, THRESHOLD)).toBe(expected)
  })
})
