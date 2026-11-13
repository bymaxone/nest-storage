/**
 * @fileoverview The endpoint as a log line shows it: protocol, host and port, and nothing a URL can
 * carry that is secret or personal.
 * @layer server/utils
 */
import { describeEndpoint } from './describe-endpoint'

describe('describeEndpoint', () => {
  it.each([
    ['https://s3.example.com', 'https://s3.example.com'],
    ['http://localhost:9000', 'http://localhost:9000'],
    ['https://s3.example.com:9443/base/path?x=1#frag', 'https://s3.example.com:9443'],
  ])('keeps only protocol, host and port of %s', (endpoint, expected) => {
    // Path, query and fragment can name buckets or carry tokens; they are not needed to identify the store.
    expect(describeEndpoint(endpoint)).toBe(expected)
  })

  it('drops user and password', () => {
    // userinfo is a credential; it must never reach a log line.
    const shown = describeEndpoint('https://AKIAEXAMPLE:SECRETEXAMPLE@s3.example.com:9000')

    expect(shown).toBe('https://s3.example.com:9000')
  })

  it('does not echo a value it cannot parse', () => {
    // An unparseable string may still hold a secret, so none of it is repeated.
    expect(describeEndpoint('not a url with SECRETEXAMPLE')).toBe('<unparseable endpoint>')
  })
})
