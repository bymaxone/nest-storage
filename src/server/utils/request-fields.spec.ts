/**
 * @fileoverview The readers of what a service method takes: each field once, an absent options object as no
 * fields, and a lifecycle rule that is not an object as a rule with no fields.
 * @layer server/utils
 */
import {
  readBucketScoped,
  readDeleteMany,
  readLifecycleBucket,
  readLifecycleRule,
} from './request-fields'

describe('request-fields', () => {
  it.each([
    ['readBucketScoped', readBucketScoped],
    ['readDeleteMany', readDeleteMany],
    ['readLifecycleBucket', readLifecycleBucket],
  ])('%s reads absent options as no fields', (_name, read) => {
    expect({ ...read(undefined) }).toStrictEqual({})
  })

  it.each([undefined, null])('readLifecycleRule reads %s as a rule with no fields', (rule) => {
    expect({ ...readLifecycleRule(rule) }).toStrictEqual({})
  })

  it('readLifecycleRule reads the four fields of a rule once and leaves the rest out', () => {
    const rule = { id: 'r', prefix: 'p/', expirationDays: 7, extra: true }

    expect({ ...readLifecycleRule(rule) }).toStrictEqual({
      id: 'r',
      prefix: 'p/',
      expirationDays: 7,
    })
  })
})
