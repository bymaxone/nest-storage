/**
 * @fileoverview The deadline of the cleanup that follows an abandoned call is a duration a timer can
 * hold, and the helpers give the SDK a signal only when the caller has one.
 * @layer server/utils
 */
import {
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { MAX_TIMER_MS } from '../constants/timer.constants'
import { getEventListeners } from 'node:events'
import { abortable, bindToSignal, CLEANUP_DEADLINE_MS, sendOptions, within } from './abort-support'

describe('abort-support', () => {
  it('keeps the cleanup deadline within what a timer can hold', () => {
    // AbortSignal.timeout over 2**31 - 1 ms would fire at once and cancel the very cleanup it bounds.
    expect(CLEANUP_DEADLINE_MS).toBeGreaterThan(0)
    expect(CLEANUP_DEADLINE_MS).toBeLessThanOrEqual(MAX_TIMER_MS)
  })

  it('hands the SDK the caller signal, and nothing when there is none', () => {
    // With no signal the send options are absent, so a call behaves exactly as it did without the option.
    const signal = new AbortController().signal

    expect(sendOptions(signal)).toEqual({ abortSignal: signal })
    expect(sendOptions(undefined)).toBeUndefined()
  })

  describe('bindToSignal', () => {
    function makeClient(): { client: S3Client; send: jest.SpyInstance } {
      const client = new S3Client({
        region: 'us-east-1',
        credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      })
      const send: jest.SpyInstance = jest.spyOn(client, 'send')
      return { client, send }
    }

    it('adds the signal to every request but the multipart create, which is sent without it', async () => {
      // The create must finish whatever the caller does, so that its upload id can be aborted.
      const { client, send } = makeClient()
      send.mockResolvedValue({ UploadId: 'u1' })
      const signal = new AbortController().signal
      const bound = bindToSignal(client, signal)

      await bound.client.send(new HeadObjectCommand({ Bucket: 'b', Key: 'k' }))
      await bound.client.send(new CreateMultipartUploadCommand({ Bucket: 'b', Key: 'k' }))

      const optionsOfCall = (n: number): unknown => {
        const call: unknown = send.mock.calls[n]
        return Array.isArray(call) ? (call[1] as unknown) : undefined
      }
      expect(optionsOfCall(0)).toEqual({ abortSignal: signal })
      expect(optionsOfCall(1)).toBeUndefined()
    })

    it('reads the upload id the create answered', async () => {
      // The id is what the cleanup aborts, even when the caller stopped waiting before it arrived.
      const { client, send } = makeClient()
      send.mockResolvedValue({ UploadId: 'u1' })
      const bound = bindToSignal(client, new AbortController().signal)

      await bound.client.send(new CreateMultipartUploadCommand({ Bucket: 'b', Key: 'k' }))

      expect(await bound.createdUploadId()).toBe('u1')
    })

    it('has no upload id before a create was sent, or when the create failed', async () => {
      // Nothing was created, so there is nothing to abort.
      const { client, send } = makeClient()
      send.mockRejectedValue(new Error('refused'))
      const bound = bindToSignal(client, new AbortController().signal)
      expect(await bound.createdUploadId()).toBeUndefined()

      await bound.client.send(new CreateMultipartUploadCommand({ Bucket: 'b', Key: 'k' })).catch(() => undefined)

      expect(await bound.createdUploadId()).toBeUndefined()
    })

    it('leaves every other member of the client as it was', () => {
      // Only send is replaced; the rest of the client is read through unchanged.
      const { client } = makeClient()
      const bound = bindToSignal(client, new AbortController().signal)

      expect(bound.client.config).toBe(client.config)
    })
  })

  describe('within', () => {
    it('returns what settles in time', async () => {
      // A promise that is already settled is not held back by the deadline.
      expect(await within(Promise.resolve(5), 1000)).toBe(5)
    })

    it('gives up on what does not settle in time', async () => {
      // A cleanup that waits for an id that never comes ends at its deadline.
      expect(await within(new Promise<number>(() => undefined), 20)).toBeUndefined()
    })
  })

  describe('abortable', () => {
    const context = { key: 'k', op: 'upload' }

    it('is exactly the work when there is no signal', async () => {
      // Without a signal a call behaves as it did without the option.
      await expect(abortable(Promise.resolve(1), undefined, context)).resolves.toBe(1)
      await expect(abortable(Promise.reject(new Error('boom')), undefined, context)).rejects.toThrow('boom')
    })

    it('settles as the work does and leaves no listener behind, on success and on failure', async () => {
      // The signal is reused by the host across calls; nothing of the library stays on it.
      const signal = new AbortController().signal

      await expect(abortable(Promise.resolve(7), signal, context)).resolves.toBe(7)
      const failure = new Error('boom')
      await expect(abortable(Promise.reject(failure), signal, context)).rejects.toBe(failure)
      expect(getEventListeners(signal, 'abort')).toHaveLength(0)
    })

    it('rejects STORAGE_REQUEST_ABORTED at once when the signal has already aborted, and drops what the work later rejects', async () => {
      // The work may have started, and aborted the signal itself, before the wait began; no event is coming.
      let fail: (error: Error) => void = () => undefined
      const work = new Promise<number>((_resolve, reject) => {
        fail = reject
      })

      await expect(abortable(work, AbortSignal.abort(), context)).rejects.toMatchObject({
        code: 'STORAGE_REQUEST_ABORTED',
      })
      fail(new Error('Premature close'))
      await new Promise((resolve) => setImmediate(resolve))
    })

    it('rejects STORAGE_REQUEST_ABORTED at once when the signal aborts, and drops what the work later rejects', async () => {
      // A body read that nobody can finish is not waited for, and its eventual failure is not an unhandled rejection.
      const controller = new AbortController()
      let fail: (error: Error) => void = () => undefined
      const work = new Promise<number>((_resolve, reject) => {
        fail = reject
      })
      const waiting = abortable(work, controller.signal, context)
      controller.abort()

      await expect(waiting).rejects.toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
      fail(new Error('Premature close'))
      await new Promise((resolve) => setImmediate(resolve))
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    })
  })
})
