/**
 * @fileoverview The one way the library writes an operational log line: as an object with an `event` code
 * and library text in `message`, through a logger the host may have replaced, which cannot break the call.
 * @layer server/utils
 */
import { absorb } from './absorb'

/** The levels the library writes at. */
export type LogLevel = 'debug' | 'log' | 'warn' | 'error'

/** The logger methods the library uses; a Nest `Logger` satisfies it. They are typed to return a value, since a host method typed `void` may still return a promise. */
export interface LogSink {
  debug(message: unknown): unknown
  log(message: unknown): unknown
  warn(message: unknown): unknown
  error(message: unknown): unknown
}

/**
 * One log event. `message` is the library's own text. An error that the provider, the scanner or the host
 * raised is passed as the object under `err`, so the logger's serialiser and redaction apply to it, and is
 * never interpolated into `message`.
 */
export interface LogEntry {
  readonly event: string
  readonly message: string
  readonly err?: Error
  readonly [field: string]: unknown
}

/**
 * Writes one event. A logger method that throws changes nothing about the call being logged, and neither
 * does a sink handed here directly whose method is async and rejects. A Nest `Logger` instance as the sink
 * drops the value its host method returns, so an async host `LoggerService` that rejects is not absorbed here:
 * it is an unhandled rejection, and Node ends the process on it unless the application handles it.
 *
 * @param sink - The logger.
 * @param level - The level to write at.
 * @param entry - The event.
 */
export function emit(sink: LogSink, level: LogLevel, entry: LogEntry): void {
  // The result is returned to `absorb`: a method typed `void` can still hand back a promise.
  absorb(() => sink[level](entry))
}
