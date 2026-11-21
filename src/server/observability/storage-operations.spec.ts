/**
 * @fileoverview The closed sets the metrics are keyed by, and how a failure is told into an outcome or a verdict
 * from its library code and never from its text.
 * @layer server/observability
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import {
  SCAN_VERDICTS,
  STORAGE_OPERATIONS,
  STORAGE_OUTCOMES,
  outcomeOf,
  scanVerdictOfError,
} from './storage-operations'

describe('the closed sets', () => {
  it('hold the operations, outcomes and verdicts the metrics are keyed by, without a duplicate', () => {
    expect(STORAGE_OPERATIONS).toEqual([
      'upload',
      'download',
      'head',
      'delete',
      'delete_many',
      'list',
      'copy',
      'get_download_url',
      'get_upload_url',
      'get_multipart_upload_urls',
      'check_bucket',
      'lifecycle_get',
      'lifecycle_upsert',
      'lifecycle_remove',
    ])
    expect(STORAGE_OUTCOMES).toEqual(['success', 'not_found', 'aborted', 'error'])
    expect(SCAN_VERDICTS).toEqual(['clean', 'infected', 'unknown', 'timeout', 'error'])
    for (const set of [STORAGE_OPERATIONS, STORAGE_OUTCOMES, SCAN_VERDICTS]) {
      expect(new Set(set).size).toBe(set.length)
    }
  })
})

describe('outcomeOf', () => {
  it.each([
    [STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, 'not_found'],
    [STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED, 'aborted'],
    [STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED, 'aborted'],
    [STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR, 'error'],
    [STORAGE_ERROR_CODES.STORAGE_BUCKET_NOT_FOUND, 'error'],
    [STORAGE_ERROR_CODES.STORAGE_TIMEOUT, 'error'],
  ] as const)('tells %s as %s', (code, outcome) => {
    expect(outcomeOf(new StorageException(code))).toBe(outcome)
  })

  it('tells anything that is not a library error as an error, whatever its text says', () => {
    expect(outcomeOf(new Error('STORAGE_OBJECT_NOT_FOUND'))).toBe('error')
    expect(outcomeOf({ code: 'STORAGE_OBJECT_NOT_FOUND' })).toBe('error')
    expect(outcomeOf(undefined)).toBe('error')
  })
})

describe('scanVerdictOfError', () => {
  it.each([
    [STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, 'infected'],
    [STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE, 'unknown'],
    [STORAGE_ERROR_CODES.STORAGE_TIMEOUT, 'timeout'],
    [STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR, 'error'],
  ] as const)('tells %s as %s', (code, verdict) => {
    expect(scanVerdictOfError(new StorageException(code))).toBe(verdict)
  })

  it('tells a scanner that threw as an error, whatever its text says', () => {
    expect(scanVerdictOfError(new Error('STORAGE_SCAN_INFECTED'))).toBe('error')
  })
})
