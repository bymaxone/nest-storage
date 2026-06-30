/**
 * @fileoverview Server-side re-export of the curated MIME whitelists from
 * `shared/` so server consumers can import them without crossing the subpath
 * boundary.
 * @layer server/constants
 */
export {
  DEFAULT_IMAGE_MIME_WHITELIST,
  DEFAULT_VIDEO_MIME_WHITELIST,
  DEFAULT_DOC_MIME_WHITELIST,
} from '../../shared/constants/mime-types.constants'
