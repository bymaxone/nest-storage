/**
 * @fileoverview The names a README snippet uses without declaring them, typed
 * against the published package. `check-published-surface.mjs` copies this file into
 * the throwaway consumer it compiles the snippets in, so a call made through one of
 * these names is checked against the real types instead of resolving to `any`.
 * Only names the surrounding prose introduces belong here; a wrong option, method or
 * field on a package type is a real error and must stay one.
 */
import type {
  BucketLifecycleService,
  IFileScanner,
  IUploadValidator,
  SignedUrlService,
  StorageService,
} from '@bymax-one/nest-storage'

declare global {
  /** What `this` holds in a snippet that shows service calls without a class around them. */
  interface SnippetContext {
    storage: StorageService
    signedUrls: SignedUrlService
    lifecycle: BucketLifecycleService
  }

  const storage: StorageService
  const signedUrls: SignedUrlService
  const lifecycle: BucketLifecycleService

  const buf: Buffer
  const fileBuffer: Buffer
  const file: Blob
  const folder: string
  const contentType: string
  const body: { folder: string; contentType: string }
  function randomUUID(): string
  /** NestJS decorators a snippet uses without importing them. */
  function Injectable(): ClassDecorator
  function Post(path?: string): MethodDecorator
  function Body(): ParameterDecorator
  function fetchJson(url: string, payload: unknown): Promise<{ uploadUrl: string; key: string }>

  /** Defined by an earlier README snippet. */
  class PdfValidator implements IUploadValidator {
    readonly name: string
    validate: IUploadValidator['validate']
  }
  /** Defined by an earlier README snippet. */
  class ClamAvScanner implements IFileScanner {
    scan: IFileScanner['scan']
  }
}
