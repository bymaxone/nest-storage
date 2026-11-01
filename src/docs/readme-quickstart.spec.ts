/**
 * @fileoverview Executes the README Quick Start as written. The snippets are read out of
 * `README.md` at test time, compiled with decorator metadata and run against a real Nest testing
 * graph, with the S3 traffic redirected to a local stand-in server, so a reader who copies them
 * gets code that runs and not only code that type-checks.
 * @layer docs
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { compileFunction } from 'node:vm'
import * as nestCommon from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { S3ClientProvider } from '../server/providers/s3-client.provider'
import * as storage from '../server/index'

const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

/** The TypeScript blocks of the Quick Start section, in the order the README shows them. */
function quickStartBlocks(): string[] {
  const start = README.indexOf('## 🚀 Quick Start')
  const end = README.indexOf('## ⚙️ Configuration')
  if (start === -1 || end === -1) {
    throw new Error('README Quick Start section not found')
  }
  return Array.from(
    README.slice(start, end).matchAll(/```typescript\n([\s\S]*?)```/g),
    (m) => m[1] ?? '',
  )
}

/** Compiles one README block with decorator metadata and runs it, resolving imports through `modules`. */
function runBlock(block: string, modules: Record<string, unknown>): Record<string, unknown> {
  const { outputText } = transpileModule(block, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  })
  const exported: Record<string, unknown> = {}
  const load = (specifier: string): unknown => {
    if (specifier in modules) {
      return modules[specifier]
    }
    throw new Error(`The Quick Start imports "${specifier}", which this test does not provide`)
  }
  // `process` and `Reflect` are passed in: the function would otherwise see the outer realm's, which has
  // neither the test's environment nor the metadata API that reflect-metadata installed for the test.
  const run = compileFunction(outputText, ['require', 'exports', 'process', 'Reflect']) as (
    ...args: unknown[]
  ) => void
  run(load, exported, process, Reflect)
  return exported
}

const MODULES = {
  '@nestjs/common': nestCommon as unknown,
  '@bymax-one/nest-storage': storage as unknown,
}

/** The environment variables the Quick Start reads, set to dummy values for the duration of a test. */
const ENVIRONMENT: Record<string, string> = {
  AWS_ACCESS_KEY_ID: 'readme-key',
  AWS_SECRET_ACCESS_KEY: 'readme-secret',
  R2_ACCOUNT_ID: 'readme-account',
  R2_ACCESS_KEY_ID: 'readme-key',
  R2_SECRET_ACCESS_KEY: 'readme-secret',
  DO_ACCESS_KEY_ID: 'readme-key',
  DO_SECRET_ACCESS_KEY: 'readme-secret',
}

describe('README Quick Start', () => {
  const saved = new Map<string, string | undefined>()
  let server: Server
  let port: number
  let requests: { method: string; url: string }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        requests.push({ method: req.method ?? '', url: req.url ?? '' })
        res.setHeader('ETag', '"readme-etag"')
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  beforeEach(() => {
    requests = []
    for (const [name, value] of Object.entries(ENVIRONMENT)) {
      saved.set(name, process.env[name])
      process.env[name] = value
    }
  })

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name)
      } else {
        process.env[name] = value
      }
    }
    saved.clear()
  })

  it('boots the AWS S3 module and the AssetService the README shows, and uploads through them', async () => {
    /**
     * Guards the README section "Quick Start", and changes when that section does: the module and the
     * service are the README text, not a copy. The request is sent to a local stand-in by rewriting
     * the destination after signing; everything before that runs as a reader's application would.
     */
    const [moduleBlock, serviceBlock] = quickStartBlocks()
    const { AppModule } = runBlock(moduleBlock ?? '', MODULES) as { AppModule: new () => unknown }
    const { AssetService } = runBlock(serviceBlock ?? '', MODULES) as {
      AssetService: new (s: never) => {
        uploadFile(key: string, buffer: Buffer, contentType: string): Promise<storage.UploadResult>
      }
    }

    const ref = await Test.createTestingModule({
      imports: [AppModule],
      providers: [AssetService],
    }).compile()
    await ref.init()
    // The provider builds the client in onModuleInit, so it is read after init, from the provider itself.
    ref
      .get(S3ClientProvider)
      .getClient()
      .middlewareStack.add(
        ((next: (args: { request: object }) => Promise<unknown>) => (args: { request: object }) => {
          Object.assign(args.request, { protocol: 'http:', hostname: '127.0.0.1', port })
          return next(args)
        }) as never,
        { step: 'finalizeRequest', name: 'readmeStandIn', priority: 'low' },
      )

    const result = await ref
      .get(AssetService)
      .uploadFile('a.txt', Buffer.from('hello'), 'text/plain')

    expect(result).toMatchObject({
      key: 'a.txt',
      bucket: 'my-bucket',
      etag: '"readme-etag"',
      contentType: 'text/plain',
      publicUrl: 'https://my-bucket.s3.us-east-1.amazonaws.com/a.txt',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'PUT' })
    await ref.close()
  })

  it('runs every provider snippet and applies what its comments promise', () => {
    /**
     * Each provider block is a bare `BymaxStorageModule.forRoot({...})` call. Running it validates the
     * options it builds, and the options are checked against the claims the README makes beside it.
     */
    const [, , r2, spaces, minio] = quickStartBlocks()
    const captured: Record<string, unknown>[] = []
    const spy = {
      ...storage,
      BymaxStorageModule: {
        forRoot: (options: Record<string, unknown>): unknown => {
          captured.push(options)
          return storage.BymaxStorageModule.forRoot(options as never)
        },
      },
    }
    for (const block of [r2, spaces, minio]) {
      runBlock(block ?? '', { ...MODULES, '@bymax-one/nest-storage': spy })
    }

    const [r2Options, spacesOptions, minioOptions] = captured
    expect(r2Options).toMatchObject({
      publicBaseUrl: 'https://cdn.example.com',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(String(spacesOptions?.cdnBaseUrl)).toContain('.cdn.digitaloceanspaces.com')
    expect(minioOptions).toMatchObject({ forcePathStyle: true, endpoint: 'http://localhost:9000' })
  })
})
