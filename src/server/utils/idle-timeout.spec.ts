/**
 * @fileoverview The idle guard: a silent source is cut off, a live one is not, and the wrapper
 * never leaves an unheard `'error'` behind.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'
import { guardIdleBody, SourceIdleError, withIdleTimeout } from './idle-timeout'

async function collect(stream: AsyncIterable<unknown>): Promise<string> {
  const parts: Buffer[] = []
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(parts).toString()
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('withIdleTimeout', () => {
  it('yields the source chunks unchanged', async () => {
    // A source that ends on its own passes through whole.
    const source = Readable.from([Buffer.from('ab'), Buffer.from('cd')])

    expect(await collect(withIdleTimeout(source, 1000))).toBe('abcd')
  })

  it('fails the read with SourceIdleError when the source goes silent, and destroys it', async () => {
    const source = new Readable({ read() {} })
    source.push(Buffer.from('head'))

    const failure = collect(withIdleTimeout(source, 50))

    await expect(failure).rejects.toBeInstanceOf(SourceIdleError)
    await expect(failure).rejects.toMatchObject({ idleMs: 50, name: 'SourceIdleError' })
    expect(source.destroyed).toBe(true)
  })

  it('restarts the clock on every chunk', async () => {
    // Four chunks 40 ms apart: 160 ms in total, more than the 100 ms limit, but no silence reaches it.
    let sent = 0
    const source = new Readable({
      read() {
        if (sent >= 4) {
          this.push(null)
          return
        }
        sent += 1
        setTimeout(() => this.push(Buffer.from('x')), 40)
      },
    })

    expect(await collect(withIdleTimeout(source, 100))).toBe('xxxx')
  })

  it('does not run the clock while nothing is asking for data', async () => {
    // Nobody reads the wrapper for longer than the limit; the first read must still succeed.
    const source = new Readable({ read() {} })
    const wrapper = withIdleTimeout(source, 60)
    await new Promise((resolve) => setTimeout(resolve, 150))
    source.push(Buffer.from('late'))
    source.push(null)

    expect(await collect(wrapper)).toBe('late')
  })

  it('does not run the clock for read-ahead while the consumer is paused', async () => {
    // The source delivers its second chunk 100 ms in, longer than the 50 ms limit, but the consumer
    // pauses for 150 ms after the first chunk, so by the time it asks again the chunk is waiting.
    const source = new Readable({ read() {} })
    source.push(Buffer.from('one'))
    setTimeout(() => source.push(Buffer.from('two')), 100)
    setTimeout(() => source.push(null), 120)
    const seen: string[] = []

    for await (const chunk of withIdleTimeout(source, 50)) {
      seen.push(String(chunk))
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    expect(seen.join('')).toBe('onetwo')
  })

  it('passes a source error through to the reader', async () => {
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy(new Error('boom'))

    await expect(failure).rejects.toThrow('boom')
  })

  it('keeps an error from crashing the process when nothing reads the wrapper', async () => {
    // The uploader may already be gone; the wrapper still must not raise an unheard 'error'.
    const source = new PassThrough()
    const wrapper = withIdleTimeout(source, 30)
    const crashed = jest.fn()
    process.once('uncaughtException', crashed)

    wrapper.resume()
    await new Promise((resolve) => setTimeout(resolve, 120))
    process.removeListener('uncaughtException', crashed)

    expect(crashed).not.toHaveBeenCalled()
    expect(wrapper.destroyed).toBe(true)
    expect(source.destroyed).toBe(true)
  })

  it('releases the source when the wrapper is destroyed early, without an error', async () => {
    const source = new Readable({ read() {} })
    source.push(Buffer.from('first'))
    const wrapper = withIdleTimeout(source, 5000)
    const forwarded = jest.fn()
    source.on('error', forwarded)
    for await (const _chunk of wrapper) {
      break
    }
    await tick()

    expect(wrapper.destroyed).toBe(true)
    expect(source.destroyed).toBe(true)
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('leaves no timer running once the source ends', async () => {
    const clear = jest.spyOn(global, 'clearTimeout')

    await collect(withIdleTimeout(Readable.from([Buffer.from('a')]), 5000))

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})

describe('guardIdleBody', () => {
  it('returns a buffer or a Uint8Array as is', () => {
    const buffer = Buffer.from('abc')
    const bytes = new Uint8Array([1])

    expect(guardIdleBody(buffer, 10)).toBe(buffer)
    expect(guardIdleBody(bytes, 10)).toBe(bytes)
  })

  it('returns the stream itself when the guard is off', () => {
    const source = new Readable({ read() {} })

    expect(guardIdleBody(source, 0)).toBe(source)
  })

  it('wraps a stream when the guard is on', () => {
    const source = new Readable({ read() {} })

    const guarded = guardIdleBody(source, 100)

    expect(guarded).not.toBe(source)
    expect(guarded).toBeInstanceOf(Readable)
    source.destroy()
  })
})
