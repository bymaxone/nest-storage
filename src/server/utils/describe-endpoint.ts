/**
 * @fileoverview The endpoint as a log line shows it: protocol, host and port, and nothing a URL can
 * carry that is secret or personal.
 * @layer server/utils
 */

/**
 * Describes a store endpoint for a log line. Only the protocol, host and port are kept: user and
 * password, path, query and fragment are dropped, and a value that cannot be parsed is not repeated
 * at all, since it may hold a secret.
 *
 * @param endpoint - The configured endpoint.
 * @returns `protocol//host[:port]`, or a fixed placeholder when `endpoint` is not a URL.
 */
export function describeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.protocol}//${url.host}`
  } catch {
    return '<unparseable endpoint>'
  }
}
