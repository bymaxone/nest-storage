/**
 * @fileoverview Unit tests asserting the server-side MIME whitelist re-export
 * matches the shared source of truth.
 * @layer server/constants
 */
import {
  DEFAULT_DOC_MIME_WHITELIST as SERVER_DOC,
  DEFAULT_IMAGE_MIME_WHITELIST as SERVER_IMAGE,
  DEFAULT_VIDEO_MIME_WHITELIST as SERVER_VIDEO,
} from './default-mime-whitelist.constants'
import {
  DEFAULT_DOC_MIME_WHITELIST as SHARED_DOC,
  DEFAULT_IMAGE_MIME_WHITELIST as SHARED_IMAGE,
  DEFAULT_VIDEO_MIME_WHITELIST as SHARED_VIDEO,
} from '../../shared/constants/mime-types.constants'

describe('default-mime-whitelist re-export', () => {
  it('should re-export the shared image whitelist', () => {
    // Server consumers import without crossing the subpath boundary.
    expect(SERVER_IMAGE).toBe(SHARED_IMAGE)
    expect(SERVER_IMAGE).toContain('image/png')
  })

  it('should re-export the shared video whitelist', () => {
    // Identity with the shared source of truth.
    expect(SERVER_VIDEO).toBe(SHARED_VIDEO)
    expect(SERVER_VIDEO).toContain('video/mp4')
  })

  it('should re-export the shared document whitelist', () => {
    // Identity with the shared source of truth.
    expect(SERVER_DOC).toBe(SHARED_DOC)
    expect(SERVER_DOC).toContain('application/pdf')
  })
})
