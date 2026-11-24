/**
 * @fileoverview The seam that wraps an operation in an OpenTelemetry span when the optional peer is installed.
 * @layer server/observability
 */
import { Injectable } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'
import { StorageException } from '../errors/storage-exception'
import { absorb } from '../utils/absorb'
import { tagged } from '../utils/prototype-guard'
import { mirrorOf, verdictOf } from '../utils/settle-or-cut'
import { outcomeOf, type StorageOutcome } from './storage-operations'

/** The span names the library starts. */
export type StorageSpanName = 'storage.upload' | 'storage.download_url' | 'storage.scan'

/**
 * The attributes a span carries, named one by one: the outcome, whether an upload was multipart, and when a scan
 * runs. A key, a bucket or a payload has no member, so a call site cannot add one.
 */
export interface StorageSpanAttributes {
  readonly 'bymax.storage.outcome'?: StorageOutcome
  readonly 'bymax.storage.multipart'?: 'true' | 'false'
  readonly 'bymax.storage.scan_mode'?: 'pre-upload' | 'post-upload'
}

/** The few members of the API the seam uses, so that no declaration here imports an optional peer. */
interface Span {
  setStatus(status: { code: number; message?: string }): unknown
  setAttributes(attributes: StorageSpanAttributes): unknown
  end(): unknown
}
interface OtelApi {
  trace: {
    getTracer(name: string): {
      startActiveSpan<T>(
        name: string,
        options: { attributes: StorageSpanAttributes },
        fn: (span: Span) => T,
      ): T
    }
  }
}

/** `SpanStatusCode.ERROR`, inlined because the enum lives in the package that may be absent. */
const STATUS_ERROR = 2
const TRACER_NAME = '@bymax-one/nest-storage'
const LIBRARY_CODE = /^STORAGE_[A-Z_]+$/

/** The library error code a failure carries, or a generic marker; the text of a message never leaves. */
function codeOf(error: unknown): string {
  if (!(error instanceof StorageException)) return 'STORAGE_ERROR'
  return LIBRARY_CODE.test(error.code) ? error.code : 'STORAGE_ERROR'
}

/** What a span states of a result, once the operation succeeded. */
export type ResultAttributes<T> = (result: T) => StorageSpanAttributes

/**
 * Starts a span around an operation when `@opentelemetry/api` is installed, and runs it bare otherwise.
 *
 * The peer is optional, so it is loaded with a dynamic `import()` that a missing package turns into a no-op:
 * the server bundle never names it statically, and an application that does not trace installs nothing. With
 * the API present and no SDK registered the API itself is a no-op. A span carries a closed set of attributes
 * and, on failure, the library error code and nothing of the message.
 */
@Injectable()
export class StorageTracing implements OnModuleInit {
  #api: OtelApi | undefined

  /** Loads the API once, at start-up; a package that is not there leaves the seam inert. */
  async onModuleInit(): Promise<void> {
    try {
      const loaded: unknown = await verdictOf(import('@opentelemetry/api'))
      this.#api = loaded as OtelApi
    } catch {
      // The package is not installed: the seam stays inert.
    }
  }

  /** Runs the operation and reports it on the span, where nothing the span does can change what comes back. */
  private async traced<T>(
    span: Span,
    run: () => Promise<T>,
    describe: ResultAttributes<T>,
  ): Promise<T> {
    let result: T
    try {
      result = await verdictOf(run())
    } catch (error) {
      absorb(() => span.setAttributes({ 'bymax.storage.outcome': outcomeOf(error) }))
      absorb(() => span.setStatus({ code: STATUS_ERROR, message: codeOf(error) }))
      absorb(() => span.end())
      throw error
    }
    absorb(() => span.setAttributes({ 'bymax.storage.outcome': 'success', ...describe(result) }))
    absorb(() => span.end())
    return result
  }

  /**
   * Runs `run` inside a span named `name`.
   *
   * The tracer belongs to the host's SDK, so it is never trusted with the operation: whatever it returns or
   * throws is ignored, the operation runs exactly once, through the span when the tracer started it and bare
   * otherwise, and its own result or error is what comes back.
   *
   * @param name - One of the library's span names.
   * @param attributes - Closed-set attributes of the span.
   * @param run - The operation; its result or its error passes through unchanged.
   * @param describe - What the span states of a successful result; a throw of its own is the operation's own.
   */
  span<T>(
    name: StorageSpanName,
    attributes: StorageSpanAttributes,
    run: () => Promise<T>,
    describe: ResultAttributes<T> = () => ({}),
  ): Promise<T> {
    return tagged(this.started(name, attributes, run, describe))
  }

  /** What {@link span} answers with, once the tracer has had its turn. */
  private started<T>(
    name: StorageSpanName,
    attributes: StorageSpanAttributes,
    run: () => Promise<T>,
    describe: ResultAttributes<T>,
  ): Promise<T> {
    const api = this.#api
    if (!api) return run()
    // One-shot: the operation runs at most once, however often or late the tracer calls back. Whoever claims
    // it first runs it, the tracer through the span or this method bare.
    const latch: { claimed: boolean; started?: Promise<T> } = { claimed: false }
    absorb(() =>
      api.trace.getTracer(TRACER_NAME).startActiveSpan(name, { attributes }, (span): unknown => {
        if (!latch.claimed) {
          latch.claimed = true
          latch.started = this.traced(span, run, describe)
        }
        // The host gets a copy of the outcome, never the promise the caller awaits: a hook of its own on that
        // promise could plant a constructor or a `then` on it.
        return mirrorOf(latch.started)
      }),
    )
    if (latch.started) return latch.started
    latch.claimed = true
    return run()
  }
}
