# Changelog

All notable changes to `@bymax-one/nest-storage` are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Versioning is **not** strict [SemVer](https://semver.org/spec/v2.0.0.html) while this API is
pre-stable: breaking changes ship in minor and patch releases by explicit `@bymax-one` policy,
so a version number carries no compatibility information. The **Apply to a derived backend**
note on each entry is the compatibility contract — read it, not the number.

---

## [Unreleased]

### Fixed

- **A download refused after the provider answered now destroys the body it holds.** When the runtime check refused
  `download` or `downloadBuffer` between the answer and the first read, in the method itself or in the operation
  counting and tracing around it, nothing read or closed the stream, so its connection stayed open.
- **Documentation: Cloudflare R2 and `publicRead`.** The text called the ACL a silent no-op there; it was not
  measured. The `getUploadUrl` row also names the `x-amz-acl` header it signs with `publicRead`.

### Changed

- The server bundle ceilings are 34 379 B (ESM) and 34 422 B (CJS).

## [1.1.23] - 2026-11-25

### Fixed

- **A signed PUT URL issued with `publicRead` now signs the `x-amz-acl` header it tells the caller to send.**
  `getUploadUrl` listed `x-amz-acl` in `requiredHeaders`, but the URL moved it into the query and signed
  `content-type;host`, so a PUT that sent exactly the listed headers was refused (measured on MinIO: 400
  `AccessDenied`, "headers present in the request which were not signed") and nothing was stored. The header is now
  signed and kept out of the query, so a PUT that sends every listed header is accepted.

  **Apply to a derived backend:** a client that ignored `requiredHeaders` and sent `Content-Type` alone to a URL issued
  with `publicRead` is now refused, where it used to be accepted. Send every entry of
  `requiredHeaders`. A URL issued without an ACL is unchanged.

- **A stream read now checks the runtime root before it takes the iterator of the source.** The check ran when the
  read ended, so a key planted on `Object.prototype` before the read was refused at once while the source was still
  drained in the background, and a source that opens a resource when its iterator is taken had opened it and not
  released it. A refused read now leaves the source unopened, and so does a refused first-bytes peek, which attached
  its listener to the stream before the check.

### Known limits

- **A key planted on `Object.prototype` in the middle of a read is not caught before the source is drained.** Only a
  key planted before the read starts leaves the source unopened.
- **Public grant: not measured on any provider.** MinIO does not implement object ACLs: a PUT that carries an ACL
  stores an owner-only one, and `PutObjectAcl` is not implemented, so `publicRead` cannot be shown to grant public
  read there. AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and Wasabi were not measured. A browser PUT
  needs `x-amz-acl` in the bucket's CORS `AllowedHeaders` (preflight measured on MinIO; browsers not run).

## [1.1.22] - 2026-11-25

### Fixed

- **A key planted on `Object.prototype` is no longer read as an option or a request field.** An ordinary read of a
  plain object that lacks a key finds that key on `Object.prototype`, so a planted option or request field such as
  `publicRead` or `bucket` was read as if the caller had set it, and a copy could be sent `public-read` and a delete or
  a listing could be sent to another bucket. A value found only on the root prototype is now left out, the copies the
  module and the services read from have no prototype, and a field a class supplies on its own prototype (a getter) is
  still read. The same holds for a custom validator, the `ok` of its result, the `status` of a scan result and the
  fields of a lifecycle rule.

- **An empty or unreadable iterator no longer turns a whitelist into an empty one.** The option arrays
  (`validation.mimeWhitelist`, `validation.customValidators`) were copied by their iterator, so an array of a subclass
  whose iterator yielded nothing copied to `[]`, and an empty whitelist allows every type. They are now copied by
  index, and a custom validator is copied too, so a getter on it is read once.

  **Apply to a derived backend:** the validators the module exposes under `BYMAX_STORAGE_UPLOAD_VALIDATORS` are copies
  that keep the `name` and call the validator's own `validate`; code that compared them by identity with the objects it
  configured compares them by `name` instead.

- **The pairs of `metadata` are read once on upload.** An upload checked the pairs of the caller's `metadata` object and
  sent that same object, reading each pair again for the request, so a value that answered differently on a later read
  was sent as something that had not been checked. The pairs are copied once, as a signed PUT URL already did, and a
  pair, a request field or the kind of the metadata that throws when read fails with `STORAGE_VALIDATION_FAILED` with
  the error as the `cause`.

  **Apply to a derived backend:** nothing to change.

- **A signed PUT URL no longer lists the metadata pairs as required headers.** The presigner puts each
  `x-amz-meta-<key>` in the signed query string, and a client that also sent the pair as a header was refused by the
  provider (HTTP 400). `requiredHeaders` now holds `Content-Type`, and `x-amz-acl` when an ACL is signed.

  **Apply to a derived backend:** a client that copies `requiredHeaders` onto its PUT needs no change; one that read
  `x-amz-meta-*` entries from it reads the pairs from what it passed as `metadata`.

- **A key planted on `Object.prototype` can no longer reach the S3 client.** The AWS SDK reads every optional input
  and configuration name off the object it is handed, so a name planted on the root prototype could become a header,
  a signed query name, a credential or the request host. The library now refuses to build the client, and refuses
  every attempt of every command (a retry included, a presigned URL included), while the root prototype carries a
  string or symbol key outside the standard set, a root property's descriptor has changed since load, or a property
  of the built-ins listed below differs from its value at load when the library checks, whether or not the library
  calls it. The refusal is `STORAGE_VALIDATION_FAILED`, carries counts and a
  fixed reason, names no key or built-in, reaches the caller unchanged (`exists()` rethrows it), and nothing is handed
  to the HTTP handler. A replacement made before the library is imported is not seen.

  A scan verdict, a validation result and a multipart upload id are read with `await` on a promise built from the
  `Promise` constructor captured at load, with no `Promise.race`, `Promise.resolve`, `Promise.all` or `then` on the
  path, so replacing one of them after load does not turn an infected or rejected result into an accepted
  one. These checks are best-effort hardening, not a security boundary: code in the same process is trusted (see
  SECURITY.md, "Threat model: same-process code"). The `constructor` of the promise prototype joins the baseline, and a host that replaces it makes the library
  refuse every call.

  Every `await` on a decision path goes through one hop: the work is followed with the `then` captured at load, the root check runs
  right before the await and again after it on the fulfilment and the rejection path, and the promise the hop hands back carries a `constructor` of its own, so a `constructor` or a `then` a host plants
  while its own code runs is never read by the caller's await. A lint rule keeps a bare `await` out of the sources. The tracer receives a copy of the span's start, never the
  promise the library awaits. Not covered: a scanner or validator dependency that reads
  `Promise` statics itself, a replaced `setTimeout` or `clearTimeout` (the library's timers read the live ones), and a
  `then` planted and erased again between the entry of a call and the moment the work answers. A host that replaces
  the `constructor` slot of `Promise.prototype` before the module loads is refused at load unless the slot still holds
  the engine's own function as a plain value.

  A value an async function hands on (a buffer, a stream, a head a validator read, a span's result) is checked for a
  `then` on itself and on every prototype above it, because the return of an async function reads `then` there; a
  stream is read step by step through the same hop instead of with `for await`, and the readiness check follows the
  bucket probe through the promise's own constructor. A Proxy anywhere above the value is refused, because its
  `get` trap could answer a `then` the walk never saw; the `[[Prototype]]` of each guarded built-in and
  `Promise[Symbol.species]` join the baseline, so a host that re-points one or replaces the species makes the
  library refuse every call. Not covered: a species that replaces itself and then erases itself again while the AWS
  SDK's own `S3Client.send` runs, which can leave that rejection unhandled. The readiness check reads the clock
  captured at load, and a signal whose `removeEventListener` throws still gets the probe's answer.

  The built-ins compared are every own property of `Object`, `Function.prototype`, `Array` and its prototype, `String`
  and its prototype, `RegExp.prototype`, the prototypes of `Map`, `Set`, `WeakMap` and `WeakSet`, `Symbol` and its
  prototype, `Number` and its prototype, `Math`, `JSON`, `ArrayBuffer`, `Buffer.prototype`, `Uint8Array.prototype`, the
  typed-array prototype, `URL.prototype` and the iterator prototypes (the shared one, and the array, string, map and set ones), plus `Buffer.from`,
  `alloc`, `concat`, `byteLength` and `isBuffer`. Measured on this build: a replaced `Math.cbrt`,
  `Number.prototype.toFixed`, `Object.freeze`, `Object.hasOwn` or `Array.prototype.findLast`, a deleted `Math.cbrt` and
  a non-writable `Object.freeze` are each refused; a property **added** to one of them after load (a new key on `Math`,
  `Object`, `Array.prototype`, `Map.prototype`, `Symbol`, `JSON` and others) is **not** refused, except `then` on
  `Array.prototype`, `Function.prototype`, `Buffer.prototype`, `Uint8Array.prototype` and the typed-array prototype, and any key on `Object.prototype`. A function replaced and then
  put back is not refused. Not compared, so replacing them is not refused: `Date`, `Intl`, `Promise.resolve`, `Promise.all`, `Promise.race`, `Promise.prototype.then` and `catch` (`Promise[Symbol.species]` is
  compared and refused), `setTimeout`, `console`, `Atomics`, `structuredClone`, `Error.captureStackTrace`, and the `Buffer` statics
  other than the five above (`Buffer.compare`, `Buffer.isEncoding`, `Buffer.poolSize`).

  The baseline of `Reflect` is the functions the language defines on it and where the object points, not
  every key of it, so a second copy of the `reflect-metadata` polyfill, which defines its own functions on `Reflect`
  again when it is evaluated, does not make the library refuse. A replaced language function still does.

  **Apply to a derived backend:** nothing to change. An application that adds a key to `Object.prototype` (a polyfill
  or a library that extends it) now fails at module start-up and on every storage call with
  `STORAGE_VALIDATION_FAILED`; remove the extension. A polyfill that replaces a listed built-in (a `core-js`-style
  one that overwrites `Array.prototype.findLast` or `Object.hasOwn`) is refused when it loads after the library; load
  it before the library.

### Changed

- **An upload source that is not a `Readable` is adapted when the idle guard is off.** With `uploadIdleTimeoutMs: 0` a
  stream body was handed to the uploader as it was, even one that only has `pipe` and events (an old-style stream) and
  is not a `Readable`; it is now adapted to a `Readable`, and a `Readable` still goes through as it is. A stream body
  that throws when it is examined (a Proxy whose `getPrototypeOf` trap throws) fails with `STORAGE_VALIDATION_FAILED`
  and the error as the `cause`.

  **Apply to a derived backend:** nothing to change; an old-style stream body now reaches the uploader as a
  `Readable`, the type its body option names.

- **`metadata` that is a `Map` or any other value that is not an object of pairs is refused.** A `Map` has no own
  entries, so its pairs were dropped without a word; it now fails with `STORAGE_VALIDATION_FAILED`
  (`details.field: 'metadata'`) before any request, like a string, an array or `null`.

  **Apply to a derived backend:** pass an object of header-safe strings.

- **`STORAGE_MIME_NOT_ALLOWED` shows the media type alone.** `details.contentType` held the whole value the caller sent,
  parameters included; it now holds the `type/subtype` without them, and nothing when the value is not a single
  well-formed type.

  **Apply to a derived backend:** a client that read parameters out of `details.contentType` reads them from the
  request it sent.

### Known limits

- **A signed PUT with an ACL cannot be sent with `x-amz-acl` as a header on MinIO.** `getUploadUrl` with `publicRead`
  lists `x-amz-acl` in `requiredHeaders`, but the presigned URL carries it in the query and signs only
  `content-type;host`. Measured on MinIO (`pgsty/silo:RELEASE.2026-10-26T00-00-00Z`): a PUT that sends `Content-Type`
  and `x-amz-acl` as told is refused with 400 `AccessDenied` ("headers present in the request which were not
  signed") and stores nothing; a PUT that sends `Content-Type` alone returns 200 and the stored object has no
  public grant. AWS S3 was not tested. Send `Content-Type` only, or do not use `publicRead`.

- **A call the runtime guard refuses does not touch the body.** When the runtime differs from what it was at load (a
  property added to `Object.prototype`, say), an `upload()` refused at its start never owns its body: a `Readable`
  passed as `body` is not destroyed, and the caller must close it. A refusal raised after the call began, like any
  other rejection, destroys the stream.

- **A refused buffered read goes on to the end of the body.** With `bodyIdleTimeoutMs: 0` and no `maxBytes`, a runtime
  the guard refuses makes `downloadBuffer()` reject, but the read keeps pulling chunks until the source ends and then
  drops them. The default idle guard and `maxBytes` bound it.

## [1.1.21] - 2026-11-21

### Fixed

- **A signed URL is signed for the values that were checked.** `getUploadUrl`, `getMultipartUploadUrls` and
  `getDownloadUrl` read fields of the request several times, once for the check and again for the signature, so a
  request whose `contentType` getter answered `text/plain` first and `text/html` afterwards passed the whitelist and
  was signed for the second, and a download's `responseContentDisposition` or `responseContentType` could pass the
  header check and be signed as another value. Each field, and the metadata pairs, are now read once and the copy is
  what is checked and signed.

  **Apply to a derived backend:** nothing to change; a request that answered differently on each read is now signed
  for the first answer.

- **An option array that lies about its length can no longer stall the start.** An array of `validation.mimeWhitelist`
  or `validation.customValidators` whose `length` answered a small number and then a very large one kept the copy of
  the options busy for seconds before the refusal. The length is read once, the copy takes at most that many entries,
  and an array over the bound is refused without being walked.

  **Apply to a derived backend:** nothing to change.

### Changed

- **Metadata that is not an object is refused.** A string or an array as `metadata` was spread into index keys that
  were read as header names, and `null` threw a `TypeError`. A `metadata` that is not an object of pairs now fails
  with `STORAGE_VALIDATION_FAILED` (`details.field: 'metadata'`) before any request, on upload and on a signed PUT
  URL.

  **Apply to a derived backend:** a host that passed a string or an array as `metadata` now gets the refusal; pass an
  object of header-safe strings.

- **The README describes the checks on the options.** The configuration section now covers them.

  **Apply to a derived backend:** nothing to change; only the text was missing.

## [1.1.20] - 2026-11-21

### Fixed

- **A throwing `onProgress` no longer fails an upload that stored its object.** On the single-shot path the hook was
  called in the upload's own `try` block, so a hook that threw made `upload()` reject with `STORAGE_PROVIDER_ERROR`
  after `PutObject` had succeeded; on the multipart path a throw reached the uploader. An async hook that rejected was
  an unhandled rejection that ends the Node process. Both paths now ignore what the hook throws or rejects with.

  **Apply to a derived backend:** nothing to change. A hook that threw used to turn a stored upload into an error; it
  now leaves the result alone, so an application that relied on a throwing hook to fail an upload must fail it itself.

- **An option that throws when it is read is refused with `STORAGE_INVALID_CONFIG`.** A getter or a Proxy of the
  host's as the options object, a group or a validator, and a `then` that throws on the object a `useFactory` returns,
  surfaced the host's own error from `forRoot` and `forRootAsync`. They now fail `STORAGE_INVALID_CONFIG`
  (`reason: 'the options could not be read'`), the host's error is kept as the `cause` of the exception and none of
  its text is in the response, and a whitelist or a validator list whose iterator throws is refused the same way instead
  of as "must be an array of strings". `StorageException` takes an optional `cause`.

  **Apply to a derived backend:** a factory that throws is now reported as `STORAGE_INVALID_CONFIG` with the
  factory's error as the `cause`; read `cause` where you matched the raw error.

- **A lone surrogate in a logged value is escaped.** `escapeForLog` left a lone surrogate (`\ud800`) as it was, and a
  logger writes it as an invalid character. It shows as `\ud800` now, like the other characters that cannot be shown;
  a well-formed pair, an emoji, stays readable.

  **Apply to a derived backend:** nothing to change; a log rule that matched the raw character reads the escape.

- **A very large sum of uploaded bytes no longer fails the metrics scrape.** `bymax_storage_bytes_uploaded_total` is
  the sum of every object's size, and two finite sizes can add up past the largest number, to `Infinity`, which a
  counter refuses: the whole `/metrics` answer then failed. The count in the tally now stops at the largest finite
  number.

  **Apply to a derived backend:** nothing to change; a scrape that failed on that sum now answers.

- **The README names what the multipart path does on a failure.** It said the SDK aborts the upload
  (`leavePartsOnError: false`); the library passes `true` and sends `AbortMultipartUpload` itself, so a failing abort
  cannot replace the error that caused it, and the outcome is in `details.abort`.

  **Apply to a derived backend:** nothing to change; only the text was wrong.

### Changed

- **The span attributes are named, and the scan span takes the two scan modes.** `StorageSpanAttributes` was
  `Readonly<Record<string, string>>`; it is now an interface naming the attributes the library sets, so a call site cannot add a key
  that carries a bucket or a payload, and the scan span's `mode` parameter is `'pre-upload' | 'post-upload'` instead of
  `string`.

  **Apply to a derived backend:** code that calls the scan span with a mode the interface does not declare, that builds
  attributes with another key, or that reads an attribute by a key it does not declare does not compile against the
  interface; use the declared modes and names. Nothing changes at run time.

- **`defaultPublicRead` and `forcePathStyle` must be booleans, and so must a per-call `publicRead`.** A string from an
  environment variable, `'false'`, is truthy: it passed the `??` default and made every upload `public-read`. A value
  of another kind for either option is now refused at boot with `STORAGE_INVALID_CONFIG`, and a per-call `publicRead`
  that is set and is not a boolean fails that call with `STORAGE_VALIDATION_FAILED` (`details.field: 'publicRead'`);
  `null` is refused like any other non-boolean, and an absent value still takes the default.

  **Apply to a derived backend:** a host that passes `process.env.X` straight into either option now gets a boot
  refusal; compare it to `'true'` and pass the boolean.

- **`validation.mimeWhitelist` and `validation.customValidators` hold at most 1000 entries.** A longer array, or an
  array whose reported length is not a count, is refused at boot with `STORAGE_INVALID_CONFIG` before any entry is
  read, so a sparse array of billions of holes no longer stalls the start.

  **Apply to a derived backend:** nothing to change unless a list holds more than 1000 entries; a whitelist that long
  can use a wildcard instead.

## [1.1.19] - 2026-11-20

### Added

- **An optional `./observability` subpath and a span seam.** `StorageMetrics` publishes
  `bymax_storage_operations_total`, `bymax_storage_operation_duration_seconds`, `bymax_storage_bytes_uploaded_total`
  and `bymax_storage_scans_total` with labels from closed sets, and `StorageHealthIndicator` reports the bucket as
  `storage` from one `HeadBucket`. The main entry now exports `StorageMetricsTally` and the closed sets
  (`STORAGE_OPERATIONS`, `STORAGE_OUTCOMES`, `SCAN_VERDICTS`), counts every public operation, and starts the
  `storage.upload`, `storage.download_url` and `storage.scan` spans when `@opentelemetry/api` is installed. `bymax_storage_bytes_uploaded_total` counts the bytes an upload sent, including a stream without a declared `size`. The new
  peers `@bymax-one/nest-core >=1.6.15`, `prom-client ^15` and `@opentelemetry/api ^1.9` are optional.

  **Apply to a derived backend:** nothing changes unless you use it. To publish the metrics, add `StorageMetrics` and
  `StorageHealthIndicator` to the providers of a module and install `prom-client`; the README "Observability"
  section has the table of metrics, labels and spans.

### Changed

- **The library's log lines are object events.** Every operational line is now an object with an `event` code
  (`STORAGE_*`), a `message` with the library's own text and named fields, through the Nest `Logger`; the README has
  a "Log events" table. What the provider, the scanner or the host raised goes under `err` as a fresh error (name,
  provider code, masked and cut message), never into the text, and never the SDK's own error. The key you passed is
  no longer logged by the provider-failure and scan events, the client-ready line no longer carries the endpoint or
  the region, and a host logger that throws can no longer fail the call being logged. A host `LoggerService` method that is
  async and rejects is still an unhandled rejection, which ends the Node process unless the application
  handles `unhandledRejection`: Nest's `Logger` drops the value the method returns before the library can see it.

  **Apply to a derived backend:** a log rule or an alert that matched the text of these lines (`Provider call failed`,
  `Scan timed out`, `Scanner failed`, `Infected file detected`, `S3Client initialized`, the exists and delete
  warnings, the TTL clamp) now matches the `event` code and reads the fields; the library text is kept in `message`.
  A sink that stringifies the message sees an object: use a logger that writes object messages as fields. Anything
  that relied on the key, the endpoint or the region in these lines reads them from the call or the configuration.
  A quote or a backslash in a logged value is no longer escaped by the library, since the logger escapes it when it
  serialises the field; control, bidirectional and format characters still show as escapes.
  The `cleanupFailure` field of `STORAGE_SCAN_CLEANUP_FAILED` is the code of a `StorageException`; any other failure is masked, cut and escaped like `err`.

### Fixed

- **An option group of the wrong kind is refused at boot.** `validation`, `signedUrls` or `multipart` given as `false`,
  `0`, a string, `true` or an array booted without error and was ignored, so `validation: enabled && { ... }` with
  `enabled` false left uploads unvalidated. `forRoot` and `forRootAsync` now fail with `STORAGE_INVALID_CONFIG`
  (`options.<group> must be an object`), repeating nothing of the value; `undefined` and `null` still mean "not
  configured". `credentials` given as an array is refused as well; before, `forRoot` copied any array given for a
  group into an empty group.

  **Apply to a derived backend:** a configuration that passed one of those values for a group now fails at boot.
  Pass an object, or leave the group out.

- **`validation.customValidators` entries are checked at boot.** An entry that is not an object with a `validate`
  function (`42`, `null`, `{}`, a bare function) booted and then failed the first upload with a raw `TypeError`
  (500). It now fails `forRoot` with `STORAGE_INVALID_CONFIG`. A `mimeWhitelist` that throws when it is read (a proxy,
  a throwing index getter) is refused as "must be an array of strings" instead of surfacing the thrown error.

  **Apply to a derived backend:** a list that held anything but validator objects now fails at boot; a class
  instance that serves `validate` from its prototype is accepted. The README option table now has the
  `validation.customValidators` row.

- **An error no longer repeats what the host configured.** `details` carried the module's `bucket` (when the call
  named none), the `keyPrefix` (inside the `key` of an upload, head, download, delete, copy and signed-URL
  failure, and the `prefix` of a list failure) and the whole `validation.mimeWhitelist` (in `STORAGE_MIME_NOT_ALLOWED`). The `key` is now the one the
  caller passed, the `bucket` appears only when the caller passed one, and the whitelist is not repeated; a `key`,
  `bucket`, `prefix`, `sourceKey` or `destKey` longer than 1024 characters is left out.

  The same applies to a scan: a `STORAGE_TIMEOUT` for a scan that outlasts its deadline repeated the prefixed key and
  the module bucket, and now carries the `key` the caller passed and a per-call `bucket`. `details.storedKey`,
  which a rejected scan whose cleanup delete failed carried, is removed from the response: the operator gets the key as
  stored in the `STORAGE_SCAN_CLEANUP_FAILED` log entry, in its `storedKey` field.

  **Apply to a derived backend:** a client or a log rule that read `details.bucket` of a call that named no bucket,
  `details.whitelist` of `STORAGE_MIME_NOT_ALLOWED`, `details.storedKey` of a rejected scan whose cleanup failed, or a
  `keyPrefix` in `details.key` finds none, and reads the module configuration instead. A rule on the text of the
  `STORAGE_SCAN_CLEANUP_FAILED` log message now reads the `event` and `storedKey` fields of the entry. A `key` and a
  `bucket` that the caller passed are unchanged.

## [1.1.18] - 2026-11-18

### Fixed

- **A per-call value of the wrong kind no longer reaches the provider call or a log line.** A per-call `bucket` that
  is not a string (a `Symbol`, a function, an array, an object, a number) was repeated in `details.bucket` of the
  error it caused, on every method that takes a bucket, and an `abortSignal` that was not an `AbortSignal` (a string,
  a `Symbol`, a `BigInt`) was handed to the SDK, which named the value in its own error message, and that message is
  logged as `Provider call failed`. Both are now refused before any request with `STORAGE_VALIDATION_FAILED` (400)
  naming `bucket` or `abortSignal`, and nothing of the value. `getMultipartUploadUrls` no longer puts a `parts` that
  is not a number in `details.provided`. A body that has `pipe`, `on` and `once` but no `pause` or `resume` is refused
  with `STORAGE_VALIDATION_FAILED` naming `body`, where it used to be waited on until `STORAGE_TIMEOUT`.

  **Apply to a derived backend:** a call that passed a per-call `bucket` that is not a string, or an `abortSignal` that
  is not an `AbortSignal`, now fails with `STORAGE_VALIDATION_FAILED` (`details.field` is `bucket` or `abortSignal`)
  where it used to reach the provider (`exists` answers `false` and logs a warning, as for any failure that is not a
  missing object). `details.provided` of `STORAGE_INVALID_PART_COUNT` is present only when `parts` is a finite number. A
  stream-like body without `pause` and `resume` is refused with `STORAGE_VALIDATION_FAILED`.

- **A configuration of the wrong kind is refused at boot, and a `null` that means "off" is refused.** `keyPrefix` that is
  an array or an object was accepted and failed later as a raw `TypeError`; `validation.mimeWhitelist` that is a string
  was accepted; `validation.customValidators` that is not an array was accepted; and a `region` with a space, a slash
  or a newline in it was sent on to the SDK, which repeats it in its error messages. `forRoot` now refuses each with
  `STORAGE_INVALID_CONFIG` naming the option and repeating nothing of the value: `keyPrefix` must be a string,
  `mimeWhitelist` an array of strings, `customValidators` an array, and `region` 1 to 63 letters, digits, `.`, `_` or
  `-` starting with a letter or digit. `validation.maxSizeBytes: null`, `validation.mimeWhitelist: null` and
  `validation.customValidators: null` are refused as well: leaving each out means no size limit, every type allowed or
  no custom validator, so a `null` from a config lookup of a missing key must not switch the protection off (1.1.17
  read `maxSizeBytes: null` as "no limit").

  **Apply to a derived backend:** a configuration that booted and is now refused: a `keyPrefix` that is not a string, a
  `validation.mimeWhitelist` or `customValidators` that is not an array (and a `mimeWhitelist` with a non-string
  entry), a `region` outside the shape above, and a `null` for `validation.maxSizeBytes`, `validation.mimeWhitelist` or
  `validation.customValidators`. Omit the option for "none": `null` no longer means it. A `null` for any other option
  inside a group is still the default.

  **`scanner: null` is refused; omit the key for no scanner.** 1.1.17 read a `scanner` of `null` as "no scanner", so a
  config lookup that returned `null` for a missing key booted with scanning off. `forRoot` now fails with
  `STORAGE_INVALID_CONFIG` ("scanner must not be null; omit it for no scanner"); a `scanner` that is `false`, `0`,
  `''` or `[]` was already refused.

  **Apply to a derived backend:** a `scanner` of `null` now fails `forRoot` and `forRootAsync` with
  `STORAGE_INVALID_CONFIG`; omit the key to run no scanner.

- **A value that throws when it is read no longer hangs a source read.** The check that tells an `Error` from any other
  value in the idle-timeout wrapper read its `name` and `message` outside a guard: a rejection value whose property
  getter throws left the wrapped read pending for good, with its timer already cleared. It is now treated as not
  being an error, and the read ends with one.

  **Apply to a derived backend:** nothing to change; a read that used to stay pending in that case now ends with an error.

- **Every option is read once.** Validation and resolution each read the options by property name, so a getter that
  returned a valid value for the check and a hostile one for the use (`scanner.mode` that answers `'pre-upload'`
  first and `'preupload'` after, a size limit that answers a number and then `NaN`) passed the check and was used as
  the hostile value. `forRoot` and `forRootAsync` now copy each known option, and each key of the option groups, into a
  plain object once; the copy is what is validated and what is resolved. The arrays of `validation` are copied once
  as well.

  **Apply to a derived backend:** nothing to change for a plain options object. An options object whose property
  getters answer differently from one read to the next now gets the first answer everywhere; a key that is not an
  option is not read at all.

- **A cut of scanner text never leaves half of a surrogate pair, and a scan that times out is logged.** The engine and
  threat names of a scan result (in the response body and the log), the unrecognised status, the scanner's `details`
  and the message of a scanner that throws were cut at a fixed length, and a cut between the two halves of an
  emoji left a lone surrogate in a JSON body or a log line. The cut now drops the whole pair. A scan that outlasts
  `scanner.timeoutMs` logs one `Scan timed out` warning with the key and the limit; until now only the typed
  `STORAGE_TIMEOUT` carried it.

  **Apply to a derived backend:** an engine or threat name cut at its limit is one character shorter when an
  emoji sits at the cut; alert rules that matched the absence of a timeout line can match `Scan timed out`.

### Changed

- **Behaviour of 1.1.17 that its notes did not name.** Each is a change from 1.1.16; the `Apply` line says what to do.
  - **A WHATWG `ReadableStream` body is refused (breaking).** 1.1.16 accepted it and stored it; 1.1.17 and later fail
    with `STORAGE_VALIDATION_FAILED` (400, `details.field: 'body'`). **Apply:** convert it with
    `Readable.fromWeb(stream)` before the call.
  - **A `scanner` that is not an object is refused at boot.** `false`, `0`, `''` and `[]` booted in 1.1.16 and scanned
    nothing; they fail `forRoot` with `STORAGE_INVALID_CONFIG` (`null` is refused too, see above). **Apply:**
    omit `scanner` for no scanner.
  - **`scanner.impl` must be an object with a `scan` function.** A function with a static `scan` (a class passed
    where an instance belongs) is refused; 1.1.16 accepted it and called the static method. **Apply:** pass an
    instance, or an object that holds the `scan` function.
  - **Keys that are not options are dropped from the resolved `signedUrls`, `multipart`, `validation` and `scanner`.**
    1.1.16 copied them through. **Apply:** keep such values outside the options.
  - **`validation: null` resolves to an empty `validation`**; 1.1.16 kept the `null`. **Apply:** none; read
    `resolved.validation` as an object, never as `null`.
  - **A group that is a class instance is honoured.** A value served from a prototype getter (a config object built
    as a class) is kept; 1.1.16 copied own properties only and dropped it silently.
  - **`validation.maxSizeBytes: null` meant "no limit" in 1.1.17**; it is refused from this release (see above).

## [1.1.17] - 2026-11-17

### Fixed

- **A size limit or a multipart setting of `NaN` or `Infinity` no longer boots.** `validation.maxSizeBytes`,
  `signedUrls.defaultGetTtlSeconds`, `defaultPutTtlSeconds`, `multipart.thresholdBytes` and `multipart.queueSize`
  had no check, and `signedUrls.maxTtlSeconds` and `multipart.partSizeBytes` checked only one side of their range,
  which `NaN` passes. `NaN` for `maxSizeBytes` switched the size limit off: a buffer and a stream declared at
  5 GB were both sent. `NaN` for a TTL put `X-Amz-Expires=NaN` in every signed URL. `Infinity` for `queueSize`
  kept the process busy from the first multipart upload on. A threshold of `NaN` or `Infinity` never chose a
  multipart upload and a part size of `Infinity` buffered the whole stream as one part. Each option is now a
  whole number in a stated range, and `forRoot` fails with `STORAGE_INVALID_CONFIG` naming the option. Per
  call, a `ttlSeconds` that is not a whole number above 0 fails with `STORAGE_SIGNED_URL_TTL_INVALID`, and a
  declared upload `size` or a list `maxKeys` that is not a whole number fails with `STORAGE_VALIDATION_FAILED`,
  before any request, whatever the body is (a buffer, a view, a string or a stream). A key set to `undefined` or
  `null` inside `signedUrls`, `multipart`, `validation` or `scanner` means the default: `maxTtlSeconds: undefined`
  used to resolve to `NaN` and put `X-Amz-Expires=NaN` in every signed URL. `maxAttempts` is refused above the
  safe-integer ceiling. The error for a TTL names no value except a finite number: a string, a `Symbol` or a
  function the caller passed is not echoed.

  **Apply to a derived backend:** a configuration that booted before and is now refused at `forRoot`:
  `validation.maxSizeBytes`, a TTL or `multipart.thresholdBytes` that is `0`, negative, `NaN`, `Infinity`,
  fractional or a string; `signedUrls.maxTtlSeconds: Infinity` (it was lowered to 7 days with a warning; a finite
  value above that still is); `multipart.partSizeBytes` that is a string, `NaN`, `Infinity` or above 5 GiB;
  `multipart.queueSize` that is not a whole number from 1 to 1000. Per call, `ttlSeconds: Infinity` (it was
  clamped to the maximum), a fractional or string TTL, a fractional or negative `size`, and a `maxKeys` of
  `Infinity`, `0`, a fraction or a string are now refused with the codes above. A per-call `ttlSeconds`, `size` or
  `maxKeys` of `null` is refused too (a `ttlSeconds` of `null` no longer reads as absent), while `undefined` or
  `null` on an option inside a group is the default; `maxAttempts` above 9007199254740991 is refused. A
  `getResponse()` of a TTL refusal no longer carries a non-numeric `details.provided`.

- **A scanner that would leave scanning silently off is refused at boot.** `scanner: { impl: undefined }` (an optional
  provider or a factory that returned nothing) and a `scanner.mode` that is a typo (`'preupload'`,
  `'pre_upload'`) made the library skip both the pre-upload and the post-upload scan, so an infected upload was
  stored (measured with an infected stand-in: 9 bytes stored under each). `forRoot` now fails with
  `STORAGE_INVALID_CONFIG` unless `scanner.impl` is an object with a `scan` function and `scanner.mode` is
  `'pre-upload'` or `'post-upload'`; `scanner.rejectOnUnknown` must be a boolean (unset or `null` is the default), and is no longer read as one
  (`'false'` rejected unknown results). A `scanner` of `null` is no scanner, as `undefined` is, and an
  `undefined` or `null` mode is the default `'pre-upload'`.

  **Apply to a derived backend:** a host whose `scanner.impl` could be unset, whose `mode` was misspelt, or
  whose `rejectOnUnknown` was a string now fails at boot instead of running unscanned; fix the configuration.

- **A scan result outside the contract no longer uploads.** `scan()` returned any result that was not
  `'infected'` or an `'unknown'` it was told to reject, so no result, `null`, `'CLEAN'`, `' clean'` or an object
  as the status stored the object. Only the exact string `'clean'` passes now; `'unknown'` keeps following
  `rejectOnUnknown`, and anything else is rejected as `STORAGE_SCAN_INCONCLUSIVE` with
  `details.reason: 'unrecognised scanner status'`, with or without `rejectOnUnknown`, and logged: a string status is
  cut to 40 characters in the log line and any other status is named by its type, so none of the scanner's own
  code runs to print it.

  **Apply to a derived backend:** a scanner that returned a status other than `'clean'`, `'infected'` or
  `'unknown'` (or nothing) on a clean file was uploading; fix the scanner, it is rejected now.

- **What a pre-upload scan approves is what is stored.** A caller that wrote into its own `Buffer` or
  `Uint8Array` while the scan ran had the changed bytes stored (measured: `ZAAA` stored after the scanner
  approved `AAAA`), because the scanner and the upload read the same memory at different times. In pre-upload
  mode a buffer body is now copied once, and the scanner and the upload both use the copy.

  **Apply to a derived backend:** a pre-upload scan holds a second copy of a buffer body while the upload
  runs; the extra memory is the size of the body.

- **A stream whose declared `size` is wrong no longer leaves a truncated object.** A stream below the multipart
  threshold goes as one request with `Content-Length` set to `size`; a provider stores the object once it has
  that many bytes, so a longer body (measured on MinIO: 500 declared, 5000 sent) stored the first 500 bytes as
  if it were the whole. The last byte is now held back until the source has ended: a longer body fails
  `STORAGE_SIZE_EXCEEDED` before the request completes and a shorter one fails `STORAGE_VALIDATION_FAILED`
  (`details.field: 'size'`), each in bounded time with nothing stored. A declared `size` that is not a whole
  number of at least 0 also fails `STORAGE_VALIDATION_FAILED` (see the entry above). With a pre-upload scanner
  the stream is read into memory first, and the same rule is applied to the length that was read.

  **Apply to a derived backend:** a caller that passed a `size` that did not match its stream, and got an object
  of the declared length back, now gets an error; pass the true size, or none (a stream with no size uses
  multipart). The multipart path is unchanged for a shorter stream. A single-shot stream that delivers its
  declared bytes and then never ends now fails `STORAGE_TIMEOUT` after `requestTimeoutMs`, because the last byte
  is held until the source ends; it completed before. End the stream.

- **A body that is not a body now fails as a validation error.** A `Blob`, an array of chunks or any other object
  that is not a `Buffer`, `Uint8Array`, `ArrayBuffer`, string or `Readable` reached the upload as if it were a
  stream and failed as `STORAGE_MULTIPART_ABORTED` (500), which blames the multipart upload. It now fails
  `STORAGE_VALIDATION_FAILED` (400, `details.field: 'body'`) before any request. A WHATWG `ReadableStream` is
  refused the same way, and so is an object that has a `pipe` function but is not a Node readable (it was a raw
  `TypeError`).

  **Apply to a derived backend:** a handler that mapped that 500 to a client error can drop the mapping; pass
  a supported body.

- **The scanner's engine and threat names are capped, and a scanner that throws is logged.** `details.engine`
  and `details.threat` in the body, and the same names in the log line, are cut to 200 characters and left out
  when the scanner gave something that is not a string. A scanner that threw was answered 500 with no log line
  at all; it now logs `Scanner failed` with its message, cut at 300 characters. The error the caller gets is
  unchanged.

  **Apply to a derived backend:** a scanner that names a threat longer than 200 characters is cut in the
  response; keep the names short, or read the full text from your scanner's own log.

### Added

- **`scanner.timeoutMs` bounds a file scan.** A scanner that never settled held the upload until the caller
  aborted. A scan now ends with `STORAGE_TIMEOUT` (503, `details.phase: 'scan'`) after `scanner.timeoutMs`,
  by default 60 s, and the scanner is handed an `AbortSignal` (`signal` on its input) that aborts then. There is
  no setting that waits without limit. A scanner that ignores the signal keeps running after the timeout.

  **Apply to a derived backend:** a scan that took longer than 60 s used to complete and now fails; set
  `scanner.timeoutMs` to what your scanner needs, and have the scanner honour `signal`.

## [1.1.16] - 2026-11-17

### Changed

- **The scanner's free-form `details` no longer reaches a client.** `STORAGE_SCAN_INFECTED` and
  `STORAGE_SCAN_INCONCLUSIVE` copied the `details` an `IFileScanner` returned into the body of the error,
  and that text is the scanner's own: an engine message, a quarantine path, an internal address. The body
  now carries the `engine` and, for an infected object, the `threat` name, and nothing else the scanner
  wrote. The `details` go to the warning log, written as one escaped, truncated token; a
  rejected inconclusive result is now logged too.

  **Apply to a derived backend:** a host that read `details.details` from either error must read the log
  line instead, or put what it needs in `threat` or `engine`. The other fields of the body are unchanged.
  A rejection whose `details` could not be serialised (a circular object, a `BigInt`, a `toJSON` that
  throws) used to fail while the error body was written, and the host answered 500; it is now the typed
  422.

- **The `abortSignal` option documentation states what a body read ends with.** It said a `download()` stream
  errors with the raw `AbortError` when `bodyIdleTimeoutMs` is `0` and left out `downloadBuffer()`. It now says
  that `downloadBuffer()` and a guarded `download()` stream fail `STORAGE_REQUEST_ABORTED`, and that with the
  guard off a `download()` stream is the SDK's own and errors with the SDK's error. The behaviour is unchanged.

  **Apply to a derived backend:** nothing.

## [1.1.15] - 2026-11-17

### Fixed

- **A download body that fails after its headers no longer reaches the caller as the SDK's raw error.** A
  connection reset in the middle of a body (`ECONNRESET`, message `aborted`) passed through unmapped: a
  caller that caught only `StorageException` missed it, and a Nest handler answered 500 for it. With the idle
  guard on (the default), a failure of the body is now mapped as any other failure of the provider
  (`STORAGE_PROVIDER_ERROR`, **503** for a cut connection, with its fixed `reason`), and `downloadBuffer()`
  maps it in both modes, with `STORAGE_REQUEST_ABORTED` when the caller's signal aborted. Nothing a client
  receives carries the driver's text.

  **Apply to a derived backend:** a host that caught the raw `ECONNRESET` from `download()` or
  `downloadBuffer()` must catch `StorageException` instead (the status is 503 for a reset). With
  `bodyIdleTimeoutMs: 0`, the stream `download()` returns is still the SDK's own and still errors with the
  SDK's error, as documented; only `downloadBuffer()` changes there.

## [1.1.14] - 2026-11-16

### Changed

- **The provider-failure log masks more, and says less when nothing failed.** The warning that carries what
  the driver or the provider said now also masks the credential scope and signature of an `Authorization`
  header (`Credential=...`) and a bare access key id (`AKIA...`, `ASIA...`), still before it cuts the
  message. A request the caller cancelled is no longer logged, and a multipart upload that fails opens its
  line with `Multipart upload failed` (it was `Provider call failed`, which a failure of the caller's own
  source stream is not). Nothing a client receives changes.

  **Apply to a derived backend:** nothing, unless a log search matched the old line start for a multipart
  failure or the cancelled-request warning.

## [1.1.13] - 2026-11-16

### Security

- **A failed call no longer tells its client what the driver or the provider said.** The body of a
  `StorageException` carried `details.awsMessage`, and for a failed multipart abort `abortError`, a
  failed post-upload delete `cleanupError`, and `deleteMany` the text of each failure. For a provider
  that could not be reached that text is the driver's own, such as `connect ECONNREFUSED 10.0.3.7:9000`,
  and a host that returns `getResponse()` unchanged (Nest's default) handed a caller the address and
  port of the storage service. The body now holds a fixed `details.reason` beside `awsCode`, `httpStatus`
  and `requestId`, which stay. What the driver and the provider said is logged for a provider failure, as a warning
  that starts `Provider call failed` (or `Multipart abort failed`), from named fields only: the error's
  name, the provider's code, the status, the request id and the message, with a signature or an access
  key id in it masked and its length bounded. The error object is not attached to the exception.
  `deleteMany`'s `failed[].error` is the provider's error code for a key it refused, or the fixed reason
  when the whole request failed.

  **Apply to a derived backend:** a host that read `details.awsMessage`, `abortError` or the text in
  `cleanupError` finds that text in the library's warn log instead; the exception no longer carries it,
  so there is nothing to forward to a client by mistake. A host that matched on that text matches
  `details.reason` (`unreachable`, `timeout`, `provider-error`, `credentials-refused` or `rejected`) or
  `awsCode`.

## [1.1.12] - 2026-11-14

### Added

- **`abortSignal` ends a call.** `upload`, `download`, `downloadBuffer`, `list`, `head`, `exists`,
  `delete` and `checkBucket` take an optional `abortSignal`. When it aborts the call rejects the new
  `STORAGE_REQUEST_ABORTED` (HTTP 499), with `details.reason` set to the name of the signal's
  reason, never its message; a signal that is already aborted makes no request. A multipart upload
  is aborted on the provider, with a deadline of its own and not the caller's signal
  (`details.abort` reports the outcome); a download body being read errors as the same
  code while the idle guard is on, and as the raw `AbortError` with `bodyIdleTimeoutMs: 0`. The
  library adds no listener to the signal that outlives the call, so one signal can be reused.
  `exists` rejects an aborted call instead of answering `false`. An abort during a post-upload scan
  ends the call with `details.stored: true` (the object is stored; the scan carries on and still
  deletes an infected one).

  **Apply to a derived backend:** nothing changes unless you pass a signal. The new code is part of
  the shared `STORAGE_ERROR_CODES` table: a host that maps every code exhaustively needs a case for
  it, and an HTTP layer should not answer 5xx for it, since the caller ended the call.

- **`downloadBuffer({ maxBytes })` bounds what a buffered download holds.** `downloadBuffer` read the
  whole object into memory whatever its size, so one large or hostile object could exhaust the
  process. With `maxBytes`, an object whose `Content-Length` is larger is refused before its body is
  read, and a body that is longer than it said, or has no length, is cut off as it is counted; both
  reject `STORAGE_SIZE_EXCEEDED` (`details.maxSize`, and `details.contentLength` for the first) and
  release the connection. A value that is not an integer of at least `1` rejects
  `STORAGE_VALIDATION_FAILED` before any request. There is no default: without `maxBytes` the call
  behaves as before. The new `DownloadBufferOptions` type is exported.

  **Apply to a derived backend:** nothing changes until you pass `maxBytes`. Set it wherever a
  backend calls `downloadBuffer` on an object it does not control, to what the process can hold.

- **`bodyIdleTimeoutMs` bounds a download body that stops delivering.** `requestTimeoutMs` ends when
  the response headers arrive, so a provider that stalled mid-body left the stream, its connection
  and the caller waiting for as long as the provider chose. After `bodyIdleTimeoutMs` of silence
  while the caller is reading, `download` and `downloadBuffer` now fail with `STORAGE_TIMEOUT`
  (`details.phase: 'body-idle'`) and the connection is released. The clock runs only while a read
  is pending, so a slow consumer never trips it. It defaults to `requestTimeoutMs`; `0` turns it off.

  **Apply to a derived backend:** a download that went quiet for longer than `requestTimeoutMs`
  (30 s by default) used to wait on; it now fails `STORAGE_TIMEOUT`. If you serve very large
  objects through a source that can pause that long, raise `bodyIdleTimeoutMs` or set it to `0`;
  while the guard is on the stream returned by `download` is a wrapper, so code that read SDK-only
  members from it (such as `transformToByteArray`) must read it as a stream instead.

### Changed

- **An unavailable provider answers 503, not 502, 504 or 500.** `STORAGE_TIMEOUT` was HTTP 504 and is
  now **503**. `STORAGE_PROVIDER_ERROR` keeps its code and stays 502 for a request the provider
  rejected, but is **503** when the provider could not be reached (connection refused or reset, DNS
  failure) or answered with a server error (`SlowDown`, 500, 502, 504; not 501), and **500** when it
  refused the credentials (`InvalidAccessKeyId`, `SignatureDoesNotMatch`: a deployment fault a retry
  does not fix; the `HEAD` calls carry no error body, so for them the credentials case is not told
  apart). `STORAGE_MULTIPART_ABORTED` is **503** when the cause is an outage and stays 500 otherwise.
  A client then has one status, 503, to treat as "retry later" whichever library answered.

  **Apply to a derived backend:** the codes are unchanged; only the HTTP status of the cases above
  moves. A host that matches `504` or `502` to retry must match `503`, and one that maps
  `STORAGE_PROVIDER_ERROR` to a fixed status by code must read `error.getStatus()` instead.

- **Development and CI tooling updated; the published code does not change by it.** The release
  workflow follows the organisation's template: the build job installs, runs the gates and packs the
  tarball once without a credential, and the publish job, which holds the token and runs no code
  from the package, publishes only that tarball after checking its digest. `glob` and `minimatch`
  are raised above their advisory floors, so their OSV ignores are gone, the timing assertions of
  the test suite no longer depend on how loaded the machine is, and the pull request check now
  compiles the README snippets against the built package, as the release already did.

  **Apply to a derived backend:** nothing to change.

### Fixed

- **`requestTimeoutMs`, `uploadIdleTimeoutMs` and `bodyIdleTimeoutMs` are refused above 2147483647.**
  Each feeds a timer, and Node clamps a timer above 2**31 - 1 milliseconds to 1 ms, so a larger value
  made every request or read fail at once instead of waiting longer. `validateOptions` now throws
  `STORAGE_INVALID_CONFIG` naming the option for a value above the ceiling (about 24.8 days); the
  ceiling itself is accepted.

  **Apply to a derived backend:** if you set one of these three above `2147483647` (to mean "very
  long"), lower it, or for the two idle guards use `0` to turn the guard off; the module now refuses
  to start with such a value.

- **`publicBaseUrl` and `cdnBaseUrl` are refused when they carry credentials.** Either is returned to
  callers as the base of every `publicUrl`, so a user or password in either, including one given
  through a provider recipe's `customDomain`, reached clients and anything that stores or logs those
  URLs. `validateOptions` now throws `STORAGE_INVALID_CONFIG` naming the option and repeating neither
  the user nor the password, from `forRoot` and `forRootAsync` alike. The same check now applies to
  `endpoint`, `publicBaseUrl` and `cdnBaseUrl`: an `@` in the host part (the text after an optional
  scheme and slashes, up to the first `/`, `?` or `#`) is refused, with or without a password.

  **Apply to a derived backend:** if one of these URLs embeds `user@` or `user:password@`, remove it before upgrading;
  the module now refuses to start with such a value.

- **A key or a provider message in a log line is written as one escaped token.** The scanner warnings
  (`Infected file detected`, `Inconclusive scan result accepted`), the idempotent-delete warning, the
  `exists` warning and the `STORAGE_SCAN_CLEANUP_FAILED` error repeated the object key, the scanner's
  engine and threat names, or the provider's message as they were. S3 accepts a key with a newline, a
  carriage return or an escape sequence, so such a key could end its log line and forge the next, or
  colour or hide what followed. Each of those values is now a quoted token in which control
  characters, and the invisible or bidirectional characters JSON leaves literal, show as `\n`, `\r`,
  `\uNNNN` or `\u{...}`.

  **Apply to a derived backend:** nothing changes in behaviour or in an error response. If a log
  parser matches `key=<value>` in these lines, the value is now enclosed in double quotes.

- **An endpoint that carries credentials is refused, and the boot log no longer prints the endpoint
  whole.** The `S3Client initialized` line repeated `endpoint` as configured, so an endpoint such as
  `https://KEY:SECRET@host` wrote the secret to the log, and the same string is the base of every
  `publicUrl` the library returns when no `publicBaseUrl` is set. `validateOptions` now throws
  `STORAGE_INVALID_CONFIG` for an endpoint with a user or password, without repeating it, and the log
  line shows only protocol, host and port.

  **Apply to a derived backend:** if your `endpoint` embeds `user:password@`, move the keys to
  `credentials` before upgrading; the module now refuses to start with such a value.

- **`requestTimeoutMs` and `maxAttempts` are now checked at boot.** A value of `0`, a negative or
  fractional number, `NaN` or `Infinity`, or a non-number reached the S3 client unchecked, and the
  request handler treats a `0` or `NaN` timeout as no timeout, so a typo could switch the bound off
  without a sign. Both options must now be integers of at least `1`; anything else throws
  `STORAGE_INVALID_CONFIG` naming the option.

  **Apply to a derived backend:** if your configuration passes `0` for either option, or computes
  one that can be fractional, change it to a positive integer before upgrading; a module that booted
  with such a value now refuses to start.

- **`validation.maxSizeBytes` now bounds every upload body, not only a declared `size`.** The limit
  was compared with the `size` option alone, so a stream with no `size`, a stream longer than the
  `size` it declared, and a `Buffer` or `Uint8Array` with no `size` were all stored whatever their
  length. A multipart upload is now counted as it is read: past the limit (or past the declared
  `size`, if that is lower) the multipart upload is aborted, the source is destroyed, and `upload()` rejects `STORAGE_SIZE_EXCEEDED` with `details.maxSize` or
  `details.declaredSize` and the abort outcome. A buffer is checked by its own length. A string or
  `ArrayBuffer` body, which the types forbid but untyped callers can pass, is now sent as its bytes
  (a string as UTF-8) and measured in bytes. A single-shot stream is still sent as `size` bytes, as
  before.

  **Apply to a derived backend:** if you set `validation.maxSizeBytes`, an upload that used to pass
  because it carried no `size` is now refused when it is longer than the limit; expect
  `STORAGE_SIZE_EXCEEDED` from a stream or buffer over it, and pass `size` only when it is true. A
  buffer's declared `size` is ignored in favour of its length, so a small buffer declared as large
  is no longer refused or sent as multipart.

## [1.1.11] - 2026-11-13

### Changed

- **Development and CI tooling updated; the published code does not change.** The AWS SDK
  development dependencies and the pinned GitHub Actions are bumped to newer patch releases.
  No file under `src/` changed.

### Documentation

- **The README is shorter and corrected.** The API table and the export list now match the
  published surface, text that repeated itself or did not belong is removed, and the security
  controls are restored as one compact table with a row per control.

  **Apply to a derived backend:** nothing to change; this release carries no runtime change.

## [1.1.10] - 2026-11-09

### Fixed

- **A caller string bound for an HTTP header is now checked, whether or not a MIME whitelist is set.**
  `contentType`, `cacheControl`, `contentDisposition`, `kmsKeyId`, the keys and values of `metadata`,
  `range`, `ifMatch`, `ifNoneMatch`, and `responseContentDisposition` and `responseContentType` of a
  signed download URL passed through unchecked: with no whitelist, `getUploadUrl` signed a content
  type holding a CR, LF, NUL or DEL, or a non-ASCII character, and the other options reached the
  request or a signed URL the same way. Each of them may now hold only tab, space and printable
  ASCII, and a `metadata` key must be a non-empty header name. Anything else fails with
  `STORAGE_VALIDATION_FAILED` and `details: { field, reason }` before any request, from `upload()`,
  `copy()`, `download()`, `getUploadUrl()`, `getMultipartUploadUrls()` and `getDownloadUrl()`. The
  error never repeats the value. `defaultCacheControl` and `kmsKeyId` in the module options are
  checked at bootstrap and fail with `STORAGE_INVALID_CONFIG`. An idempotent repeat of an `upload()`
  is checked too, so it is not answered from the cache when a header-bound value is bad. With a
  whitelist set, a bad `contentType` is still refused by the whitelist first, as
  `STORAGE_MIME_NOT_ALLOWED`; that error no longer shows a `contentType` that is not a header value,
  only the whitelist.

  **Apply to a derived backend:** a value with a control or non-ASCII character that used to reach the
  provider now fails with `STORAGE_VALIDATION_FAILED`. To send a non-ASCII filename, percent-encode it
  as RFC 6266 `filename*`: `contentDisposition: "attachment; filename*=UTF-8''caf%C3%A9.pdf"`.
  Percent-encode non-ASCII `metadata` values yourself with `encodeURIComponent`. A `metadata` key
  with a colon, a space, a slash or a non-ASCII character is refused; use letters, digits and
  `-`, `_` or `.`.

## [1.1.9] - 2026-11-09

### Fixed

- **The MIME whitelist now refuses control and non-ASCII characters in the parameter part of a
  content type.** The parameters after `;` were accepted if they held no comma and no line break, so
  a value such as `text/plain; charset=café` or one with a NUL passed the whitelist, although
  RFC 9110 field values are tab, space and printable ASCII (obsolete text aside). The parameter part
  may now hold only tab, space and printable ASCII other than the comma.

  **Apply to a derived backend:** with `validation.mimeWhitelist` set, a `contentType` whose
  parameters hold any other character now fails with `STORAGE_MIME_NOT_ALLOWED`. A type with
  ordinary parameters, such as `text/plain; charset=utf-8`, is unaffected. Without a whitelist
  nothing changes: the value is passed on as given.

## [1.1.8] - 2026-11-06

### Fixed

- **The MIME whitelist no longer accepts a value that lists several types.** The check compared only
  the text before the first `;`, while the whole value was signed or stored, so with a whitelist of
  `image/png`, `image/png;,text/html`, `image/png; charset=x, text/html` and, under `image/*`,
  `image/png,text/html` all passed. A browser reads such a header as a list and takes the last valid
  type, so the object could be served as `text/html`. The check now accepts only one `type/subtype`
  (RFC 9110 token characters) with optional parameters, and no comma or line break anywhere in the
  value.

  **Apply to a derived backend:** a `contentType` that is a list, or is not a plain `type/subtype`,
  now fails with `STORAGE_MIME_NOT_ALLOWED` when `validation.mimeWhitelist` is set, including under
  `*/*`. A single type with parameters, such as `text/plain; charset=utf-8`, is unaffected. Without
  a whitelist nothing changes: the value is stored as given.

## [1.1.7] - 2026-11-06

### Fixed

- **A presigned upload URL now fixes the stored `Content-Type`, and the presign applies the MIME whitelist.** `getUploadUrl` signed only the
  `host` header, so whoever held the URL could upload with any `Content-Type` and the object was
  stored with that type, for example `text/html` under a key approved for `image/png`. The
  `Content-Type` is now part of the signature, and the provider refuses a
  PUT that sends another type.

  **Apply to a derived backend:** a client must send the `Content-Type` from `requiredHeaders`
  exactly; a PUT with a different type now fails with HTTP 403.
  The presign also now applies `validation.mimeWhitelist`: when it is set, `getUploadUrl` and
  `getMultipartUploadUrls` throw `STORAGE_MIME_NOT_ALLOWED` for a `contentType` outside it, where
  they used to issue a URL for any type. Code that presigns a type its own whitelist excludes now
  gets that error, and must either add the type to the whitelist or stop requesting it. The
  multipart part URLs are unchanged: the type of a multipart object is set when the upload is
  created, not by the part requests.

### Changed

- **The package is built with tsup 9.** The JavaScript bundles are byte-identical to the previous
  build. The declaration files differ only in how their last export statement is written: values and
  types are exported in two statements, `export { … }` and `export type { … }`, with the same names.
  The public type surface is unchanged.

## [1.1.6] - 2026-11-06

### Fixed

- **A failed scan cleanup now names the provider's cause and the key as stored, and a failed abort no
  longer says the upload was aborted.** The 1.1.5 failure reports were too thin to act on:
  - `details.cleanupError` of a rejected post-upload scan whose delete failed was the generic
    "Storage Exception", which lost the provider's message. It is now the error code and the
    provider's message, for example `STORAGE_PROVIDER_ERROR: Access Denied`.
  - `details.key` and the `STORAGE_SCAN_CLEANUP_FAILED` log line named the key you passed, not the
    key under the `keyPrefix`. The details now also carry `storedKey`, the key as the provider
    holds it, and the log line names it; an operator audits by listing the bucket.
  - `STORAGE_MULTIPART_ABORTED` carried the message "Multipart upload was aborted" even when
    `details.abort` was `'failed'`. In that case the message is now "Multipart upload failed and
    could not be aborted".

  **Apply to a derived backend:** code that matches `details.cleanupError` against the old generic
  text, or the multipart message against "Multipart upload was aborted" when the abort failed, no
  longer matches; read `details.cleanup`, `details.abort` and the error code instead. Log queries for
  `STORAGE_SCAN_CLEANUP_FAILED` now see the key with its `keyPrefix`. `details.storedKey` is new.
  `StorageException` gains an optional fourth constructor parameter, `message`, which replaces the
  default message of the code; existing calls are unchanged.

## [1.1.5] - 2026-11-01

### Fixed

- **With a `keyPrefix`, a post-upload scan never removed the object it rejected.** The cleanup passed
  the already-prefixed key to `delete()`, which prefixes it again, so it deleted `prefix/prefix/key`
  (nothing), succeeded, and the rejected object stayed stored: no error beyond the scan verdict and no
  log line. The cleanup now targets the object's real key.
- **A failed cleanup or abort is no longer reported as a clean outcome.** These paths told the caller
  one thing while the provider held another:
  - A `post-upload` scan that rejected an object deleted it and rejected with the verdict; when that
    delete failed, the caller saw only the verdict (`STORAGE_SCAN_INFECTED`) while the object stayed
    stored, and the failure was a log line. The verdict is still the error, and its `details` now
    carry `cleanup: 'failed'`, the `key` and the delete failure (`cleanupError`); the log line is at
    error level with the code `STORAGE_SCAN_CLEANUP_FAILED`.
  - A multipart upload whose `CompleteMultipartUpload` failed was reported as aborted but was never
    aborted: the upload and its parts stayed open on the provider. The library now sends
    `AbortMultipartUpload` itself.
  - When the abort also failed, the SDK threw the abort failure in place of the failure that caused
    it. The original failure is now the error, and `details.abort` is `'completed'` or `'failed'`
    (with `abortError`). The same holds for the silent-source abort (`STORAGE_TIMEOUT`,
    `details.phase: 'source-idle'`).
  - After `delete()` or `deleteMany()` removed an object, a repeated `upload()` with the same
    `idempotencyKey` was answered from the cache with a success (`fromIdempotencyCache: true`) for an
    object that no longer existed. Both now drop the cache entries of the objects they delete. The
    cache is per instance, so a delete made by another replica or outside the library still does not
    reach it.

  **Apply to a derived backend:** if you use a `keyPrefix` together with a `post-upload` scanner,
  **audit your bucket** for objects that failed a scan in an earlier version: they were never removed
  and nothing was logged, so your logs will not list them. Re-scan the prefix, or delete what your
  scanner flagged. Error shapes also change, not codes. Code that reads `error.details` of
  `STORAGE_SCAN_INFECTED`, `STORAGE_SCAN_INCONCLUSIVE`, `STORAGE_MULTIPART_ABORTED` or the
  source-idle `STORAGE_TIMEOUT` gains the fields above: treat `details.cleanup === 'failed'` as
  "rejected but still stored" and alert on it. A failed multipart upload now costs one more request,
  the `AbortMultipartUpload` the SDK used to send (the credentials already needed
  `s3:AbortMultipartUpload`). A repeated `upload()` after a `delete()` now stores the object again
  instead of returning the earlier result. `exists()` is unchanged and still returns `false` for any
  failure that is not a 404; the README now says so next to the method.

### Changed

- **The Stryker gate is 100.** `stryker.config.json` now fails a mutation run below 100 (`thresholds.break`
  and `low` were 95), and the README states the gate. Equivalent mutants stay documented inline; the gate is
  not lowered. Nothing in the published code changes.

## [1.1.4] - 2026-11-01

### Changed

- **A missing bucket is no longer reported as an absent object, and `delete()` no longer hides it.** When
  the provider answers `NoSuchBucket`, `download()`, `upload()`, `list()`, `copy()` and `delete()` now
  reject with the new `STORAGE_BUCKET_NOT_FOUND` (404) instead of `STORAGE_OBJECT_NOT_FOUND`, and
  `delete()`, which used to resolve successfully against a bucket that does not exist, rejects it.

  **Apply to a derived backend:** a behaviour change for a deployment whose bucket is missing or
  misnamed. Code that treated `STORAGE_OBJECT_NOT_FOUND` after a failed `download()`, `upload()`, `list()`
  or `copy()` as "the bucket or key is not there" must also handle `STORAGE_BUCKET_NOT_FOUND`, and a
  `delete()` that used to succeed silently now fails until the bucket exists. `head()` and `exists()` are
  unchanged: a `HEAD` response has no body, so the provider cannot say which of the bucket and the key is
  missing, and a missing bucket still reads as an absent object there (use `checkBucket()` to tell).

### Added

- **`StorageService.checkBucket()`.** One `HeadBucket` that resolves when the bucket is reachable with these
  credentials and otherwise rejects with a typed code: `STORAGE_BUCKET_NOT_FOUND` (404),
  `STORAGE_BUCKET_ACCESS_DENIED` (403, which a provider also answers for a bucket the caller cannot list),
  `STORAGE_BUCKET_REGION_MISMATCH` (301 or `PermanentRedirect`), `STORAGE_TIMEOUT`, or
  `STORAGE_PROVIDER_ERROR`. Nothing calls it at boot; wire it into a readiness endpoint so a misconfigured
  bucket keeps the instance out of rotation. It needs `s3:ListBucket`.

## [1.1.3] - 2026-11-01

### Fixed

- **A stream that stops delivering no longer holds a multipart upload open forever.** A multipart upload
  waiting for the next bytes of a stream has no request in flight, so `requestTimeoutMs` never fired:
  a client that sent a few MiB and went silent left `upload()` pending and the upload (and its parts)
  open on the provider until a lifecycle rule reaped it. A new `uploadIdleTimeoutMs` bounds the silence.
  Past it the library sends `AbortMultipartUpload`, destroys your stream and rejects `upload()` with
  `STORAGE_TIMEOUT` and `details.phase: 'source-idle'`. The clock restarts on every chunk and runs only
  while the library is waiting for data.

  **Apply to a derived backend:** a behaviour change, on by default. A stream source that delivers no
  bytes for `uploadIdleTimeoutMs` now aborts the multipart upload and rejects `STORAGE_TIMEOUT`; the
  limit defaults to `requestTimeoutMs` (30 s). Set `uploadIdleTimeoutMs: 0` to restore the old
  behaviour, or raise it for a source that legitimately pauses longer. It applies only to a stream that
  takes the multipart path (no `size`, or at or above `multipart.thresholdBytes`); single-shot uploads
  and `Buffer` bodies are unchanged. An invalid value (negative, fractional, not a number) is rejected
  at startup as `STORAGE_INVALID_CONFIG`.
- **Reporting a failure can no longer replace it.** `deleteMany()`, the post-upload cleanup, `exists()` and
  the multipart error mapping built a message with `String(err)` or `err.message`; for a rejection value
  with no usable `toString` (an object with no prototype, one whose `toString` throws) that raised from
  inside the catch and the new error escaped in place of the one being reported. A value is now described
  by its string `message`, else its string form, else `non-printable rejection value`, and never throws.

## [1.1.2] - 2026-10-31

### Changed

- **Keys the library returns are relative to `keyPrefix`, so every one can be passed back.**
  `UploadResult.key` and `ObjectMetadata.key` (from `head`, `download`, `downloadBuffer`) carried
  the `keyPrefix`, while every method prepends it again, so with a prefix set `head(r.key)`,
  `exists`, `download`, `delete` and a signed-URL call addressed `prefix/prefix/key`. `delete`
  was the quiet one: it removed nothing and reported success. `list()` and `deleteMany()` already
  returned relative keys. `UploadResult.publicUrl` is unchanged and still carries the prefix.

  **Apply to a derived backend:** only a deployment with a non-empty `keyPrefix` is affected. In
  1.0.0 to 1.1.1 the returned key is `prefix/name` and cannot be passed back; from this release it is
  `name`. A `.key` value you stored from an earlier version carries the prefix: strip it once (for
  example `stored.slice(prefix.length + 1)`, where `prefix` is the normalized `keyPrefix` without
  surrounding slashes) before passing it to the library, and when you read keys from your database
  stop adding or removing the prefix yourself.
- **`upload()` destroys a `Readable` body it rejects.** A rejected upload (invalid key or content
  type, a validation or scan failure, a provider error) used to leave the caller's stream open, so the
  file handle or the connection behind it stayed held. The library now takes ownership of the stream, as
  `stream.pipeline` does, and destroys it; a cache hit destroys it unread. The stream is destroyed
  without an error, because the AWS SDK (under its default checksum setting) wraps a stream body in its
  own Readable and forwards the source's error to it, and nothing listens to that wrapper once the
  request has failed; the failure is the rejection of `upload()`, and a listener on the stream sees
  `'close'`. Destroying can still emit `'error'` when the stream's own cleanup fails, so the library
  attaches a no-op listener first.

  **Apply to a derived backend:** do not reuse a stream you passed to `upload()`. A caller that
  fixed a validation error and retried with the same, still unread, stream must open a new one.

### Added

- **`STORAGE_NOT_MODIFIED` (304) and `STORAGE_PRECONDITION_FAILED` (412).** `download()` with
  `ifNoneMatch` equal to the current ETag, or `ifMatch` that differs, used to surface as a generic
  `STORAGE_PROVIDER_ERROR` (502); they now have their own codes, so a caller can branch on them.
  A 304 is thrown, not returned.
- **`BucketLifecycleService.upsert` writes multipart-abort rules.** An input with
  `abortIncompleteMultipartDays` instead of `expirationDays` adds or replaces an
  `AbortIncompleteMultipartUpload` rule, so abandoned multipart uploads stop holding storage. The
  read-modify-write, the preservation of other rules and the `keyPrefix` rules are the same; an empty
  prefix is allowed for this rule only (it means the module's whole namespace, and aborting deletes no
  object). Types `AbortMultipartRuleInput` and `LifecycleRuleInput`. MinIO does not accept this rule
  through the S3 API (the end-to-end suite shows the typed `STORAGE_LIFECYCLE_REJECTED`); AWS and R2
  document it.
- **`BucketLifecycleService`: bucket lifecycle rules.** `get()` returns the rules (an empty array when
  the bucket has no configuration), `upsert({ id, prefix, expirationDays })` adds or replaces one
  expiration rule by id, and `remove(id)` deletes one. Both writes read the configuration, change
  only the rule with that id and write the full set back, so every other rule (transitions, tag
  filters, multipart aborts) is sent back as the provider returned it. Removing the last rule calls
  `DeleteBucketLifecycle`, because S3 rejects a put with no rules. The read-modify-write is not
  atomic: S3 has no conditional lifecycle write, so a concurrent writer can be overwritten.
  The service is exported from the package and from the module.
- **Error codes:** `STORAGE_LIFECYCLE_RULE_INVALID` (400), `STORAGE_LIFECYCLE_UNSUPPORTED`
  (501) and `STORAGE_LIFECYCLE_REJECTED` (422).
- Types `BucketLifecycleRule`, `BucketLifecycleRuleView`, `LifecycleBucketOptions` and
  `ExpirationRuleInput`.

  **Apply to a derived backend:** additive; nothing existing changes. A consumer that applies
  lifecycle rules through the raw `S3Client` can switch to this service. Rule prefixes are relative
  to `keyPrefix`; with a `keyPrefix` set, rules outside it are returned flagged and are not changed.
  Providers other than MinIO (tested) and Cloudflare R2 (documented) are unverified; see the README.

### Fixed

- **`requestTimeoutMs` now takes effect.** It was resolved and defaulted to 30 000 ms but never
  passed to the S3 client, so a request to an endpoint that stopped answering waited forever. It is
  now the client's `requestTimeout` with `throwOnRequestTimeout`, and an attempt that gets no
  response headers in time fails as `STORAGE_TIMEOUT` (504). A failure inside a multipart upload
  still surfaces as `STORAGE_MULTIPART_ABORTED`.

  **Apply to a derived backend:** a behaviour change. The 30 s default now applies to every
  attempt, and an upload body counts toward it: a single-shot upload that needs longer than 30 s
  (a slow link, a body near `multipart.thresholdBytes`) now fails. Raise `requestTimeoutMs` for
  such workloads before upgrading. It does not limit reading a download stream.
- **A stream body under a pre-upload scanner no longer hangs the upload.** The scanner and the upload
  were handed the same stream object; a scanner that read it left the upload with nothing to send, and
  `upload()` never returned (nothing was stored). In `pre-upload` mode a stream is now read into one
  buffer, bounded by `validation.maxSizeBytes`, and the scanner and the upload share that buffer. A
  stream longer than the limit, or any stream when `maxSizeBytes` is unset, is refused with
  `STORAGE_VALIDATION_FAILED`.

  **Apply to a derived backend:** if you scan streams before upload, set `validation.maxSizeBytes`
  (or switch the scanner to `post-upload`), and expect the stream to be held in memory up to that size.
  With `requestTimeoutMs` an upload whose stream was consumed fails as `STORAGE_TIMEOUT` instead of
  hanging.
- **`getMultipartUploadUrls` validates `parts`.** Only `parts <= 0` was refused, so a fraction, `NaN`
  or a count above S3's 10 000 part numbers was accepted. `parts` must now be an integer from 1 to
  10 000, or the call throws `STORAGE_INVALID_PART_COUNT`. The README documents the 5 MiB minimum for
  every part but the last, the absence of an abort URL, and the `AbortIncompleteMultipartUpload`
  lifecycle rule recommended against orphaned uploads.
- **`signedUrls.maxTtlSeconds` above 604 800 is reduced at init.** The SigV4 signer rejects any
  expiry over 7 days, so a larger configured ceiling made every request above 7 days fail with a
  provider error while shorter requests worked. The ceiling is now capped at 604 800 s when the
  module starts, with one warning naming both values. A boot that worked before still boots.
- **`STORAGE_PART_TOO_SMALL` is documented as reserved.** Nothing throws it: a part size under the
  S3 minimum is rejected at init as `STORAGE_INVALID_CONFIG`. The code stays in the contract.
- **The published-surface gate now fails on a wrong option, method or field in a README snippet.**
  `check:published` ran `tsc` on the snippets, which stops after syntax errors and so never reported
  the semantic ones once any snippet had a parse error; it compiled only snippets that import the
  package; and it ignored every undeclared name, so a call through one resolved to `any`. Every
  snippet is now compiled with the syntactic and semantic diagnostics together, public names are
  imported for it, and the names a snippet takes from the surrounding prose are typed in
  `scripts/readme-prelude.ts`. A diagnostic about a missing property is excused as an abbreviated
  example only when the type is a plain identifier the snippet declares itself, searched outside its
  imports, so a wrong method on an imported or union type fails.
  The prelude is compiled as a `.ts` file, so a type in it that stops resolving is an error rather than
  an `any`, and any syntax error in a snippet fails the gate.
- **README option defaults and examples now match the code.** The configuration table listed
  `signedUrls.defaultTtlSeconds` (no such option; the options are `defaultGetTtlSeconds` and
  `defaultPutTtlSeconds`, both 300 s, not 3600), a 10 MiB multipart threshold and an 8 MiB part size
  (both are 5 MiB), a `'NONE'` module-level encryption value (accepted per upload only) and a "sensible
  default" MIME whitelist (there is none). The validator, scanner-mode and multipart-URL examples used
  names that do not exist (`validators`, `'both'`, `partCount`, `valid`). The error-code table now
  matches the key guard (it rejects an empty key and a null byte, not "empty after normalization"),
  and the `STORAGE_PART_TOO_SMALL` note says what the code does.
  A new spec parses the README option-default table and the error-code table and fails when either
  drifts from the code.

  **Apply to a derived backend:** documentation only; no behaviour changed.

## [1.1.1] - 2026-10-30

Apart from the removal below, nothing here changes the published bundle: the remaining entries are
development, test and CI tooling.

### Removed

- **`BYMAX_STORAGE_LOGGER` and `BYMAX_STORAGE_IDEMPOTENCY_CACHE` are no longer exported.**
  Both were re-exported from the package barrel while being absent from the module's
  `exports`: no provider ever registered `BYMAX_STORAGE_LOGGER`, and the idempotency cache is
  registered but deliberately not exported. Injecting either raised
  `UnknownDependenciesException` and the application failed to boot, so neither has ever been
  usable as an injectable token from this library.

  **Apply to a derived backend:** delete every *import* of these two names, not only the
  injections. The reliable signal is the TypeScript error `TS2305: Module … has no exported
  member '…'`, which fires in both module systems. At runtime the two differ, and only one is
  loud: an ESM consumer fails at module-link time with `SyntaxError: The requested module does
  not provide an export named '…'` before Nest bootstraps, while a CommonJS consumer — the
  common case for a compiled NestJS application — silently receives `undefined` and fails later
  with a confusing resolution error. Do not wait for a crash to find these; grep for the names.

  One shape did work and is the one to migrate deliberately: registering the exported symbol as
  **your own** provider (`{ provide: BYMAX_STORAGE_LOGGER, useValue: myLogger }`) and injecting
  it in your own service. That never involved this library's DI container. Replace the symbol
  with a token you own — `Symbol('MY_STORAGE_LOGGER')` — and nothing else changes.

  For logging specifically: services here use `new Logger(ClassName)` from `@nestjs/common`, so
  `app.useLogger(...)` redirects them all, which is what this token pretended to offer.

### Security

- Raised the floors of vulnerable transitive dev dependencies through `pnpm.overrides` in
  `pnpm-workspace.yaml`: `browserslist`, `fast-uri`, `qs`, `undici`, `multer`, `brace-expansion`,
  `handlebars`, `js-yaml`, `@grpc/grpc-js`, `body-parser`, `proxy-addr` and `zod`. Every one is
  reached only through test, lint or mutation tooling; `dependencies` is empty, so none ships.
- `osv-scanner.toml` ignores `GHSA-gcqx-w48m-w2h4` (`deepmerge`, reached only through
  `jest-config`) until 2027-01-27, because no patched release exists.

### Changed

- Moved the development toolchain to ESLint 10 and bumped the `dev-dependencies` groups.
- The E2E suite starts its S3 server from one image, pinned by digest, held in
  `test/e2e/fixtures/minio-container.ts`; the CI workflow pre-pulls the reference it reads from
  that file.
- Bumped the pinned CI actions (`actions/setup-node`, `actions/upload-artifact`,
  `step-security/harden-runner`, `pnpm/action-setup`, `github/codeql-action/upload-sarif`) and moved
  the OSV scan and the shared review-rules sync to their shared workflows.

### Tests

- `mapAwsError` is now asserted never to attach the caught error, on every branch.

## [1.1.0] - 2026-08-11

Coordinated ecosystem release aligning every `@bymax-one/*` package after the ioredis 6 /
bullmq 6 migration. **No source, runtime, or public-API change in this package** — the
published `dist/` is byte-identical to `1.0.6`; the changes below are development
and CI tooling only.

### Changed

- Bumped the `dev-dependencies` group with 6 updates. None of these reaches the published bundle.
- Bumped the pinned `google/osv-scanner-action` CI action from 2.3.8 to 2.5.0.
- Bumped the pinned `step-security/harden-runner` CI action from 2.20.0 to 2.20.1.
- Bumped the pinned `pnpm/action-setup` CI action from 6.0.9 to 6.0.10.
- Bumped the pinned `github/codeql-action/upload-sarif` CI action from 4.37.4 to 4.37.6 in the
  codeql group.
- Reworked the mutation workflow to run incrementally on each push and to measure cold once a week.

## [1.0.6] - 2026-08-06

**Documentation and tooling, not behaviour.** `dist/` differs from `1.0.5` only in the text
of five comments; no runtime code changed.

### Fixed

- **Five of the six suppression reasons never reached the mutation report.** Stryker captures
  a directive's reason only after the colon and only to the end of that comment line. Five
  directives wrapped their reason onto following `//` lines, so the report kept a truncated
  half-sentence — and for the one on `storage.service.ts` it kept nothing, falling back to
  `Ignored using a comment`. `docs/mutation_testing_results.md` had specified the right shape
  (`<Mutator>: <reason>`) all along; the source did not follow it. Each reason is now on its
  directive line.
- The README counted **five** `// Stryker disable` comments where the source carries six.

### Security

- **`js-yaml` is patched to the fixed release** (GHSA-5p4m-2wfm-xmqj, CVSS 7.5). It reaches
  this repo only through `jest` -> `babel-plugin-istanbul` -> `@istanbuljs/load-nyc-config`,
  and `dependencies` is empty, so nothing here ships it and no consumer was exposed. Fixed
  with a `pnpm-workspace.yaml` override to `3.15.1` / `4.3.1` — a patch bump within each
  major — rather than by telling the scanner to ignore dev dependencies, which would leave it
  blind after this advisory is gone. `dist/` is unaffected.

### Added

- `check:mutants` gate (`scripts/check-mutation-directives.mjs`) — validates every
  `// Stryker` comment against the parser's own regular expression, rejecting a reason
  wrapped onto a second line, a reason written after `--` instead of a colon, and a mutator
  name Stryker does not know, which would silence nothing. Wired into CI and
  `prepublishOnly`.

## [1.0.5] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.4` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

### Tests

- `configurable: false` on the withheld credentials accessor had nothing asserting it. That flag
  is the guarantee behind every serialization assertion already in the suite: a configurable
  accessor can be redefined back into a plain enumerable value by anything holding the object.
  It is load-bearing in this package specifically — the sibling cache and queue packages freeze
  their resolved options, which makes every property non-configurable anyway; this one does not.

## [1.0.4] - 2026-08-04

### Security

- The AWS credentials are no longer disclosed when a service that holds the resolved
  options is serialized. `credentials` moves from a plain field on the resolved options
  object to a non-enumerable accessor, so `JSON.stringify`, object spread, `util.inspect`
  and `util.inspect` with `showHidden` all omit it. The resolved options are injected into
  `StorageService`, `SignedUrlService`, `ValidationService` and `FileScannerService`, so
  the long-lived `accessKeyId`, `secretAccessKey` and `sessionToken` were previously
  emitted in plaintext by anything that rendered one of them incidentally — a structured
  logger formatting its arguments, an error reporter capturing the scope of a throw.
  Plain `JSON.stringify` happened not to disclose them only because it throws on the S3
  client's circular graph, which is an accident rather than a defence: the circular-safe
  stringifier that pino and winston use disclosed them, as did `util.inspect`.

Reading on purpose is unchanged. `options.credentials.accessKeyId` and its siblings
resolve exactly as before, and no public type changed.

## [1.0.3] - 2026-08-04

Documentation only. `dist/` is byte-identical to the one 1.0.2 published — verified by
unpacking `@bymax-one/nest-storage@1.0.2` from the registry and diffing it against a
fresh build (`diff -r`, no output), not asserted. 1.0.0 and 1.0.1 shipped the same
`dist/`, so the artifact has not changed since the first release.

### Changed

- **The architecture diagram is drawn rather than listed.** Every published
  `@bymax-one` library draws this section with box-drawing characters, laid out so the
  picture shows what flows into what. This one had an indented tree of bullets with a
  description beside each entry, which says what exists but not how a request moves
  through it, which step feeds which, or where the decision is made. The redrawn
  diagram carries what the prose underneath was saying alone: the single chokepoint
  every caller-supplied key passes before it reaches S3, and the escape hatch beside
  the two services rather than buried under them.

## [1.0.2] - 2026-08-04

Documentation only, again — and for the same reason 1.0.1 existed: the README ships
inside the package, so a correction that stays on `main` leaves the npm page wrong.
`dist/` is byte-identical to 1.0.0 and 1.0.1, verified by unpacking the published
tarball and diffing it against a fresh build rather than asserting it.

### Fixed

- **The vulnerability contact pointed at a mailbox that does not exist.** The README's
  Security Policy and `SECURITY.md` both named `security@bymax.one`. A researcher
  following those instructions sent a private disclosure into nothing — and from their
  side, an unread inbox and a maintainer ignoring them look identical, so a report that
  gets no acknowledgement is usually published anyway. Everything now names
  `support@bymax.one`, the single inbox that routes.

### Changed

- **The README follows the layout of the published `@bymax-one` libraries, not just
  their section names.** The previous release standardized which sections exist and
  left the inside of each as it was. Features is now grouped under subheadings with
  one entry per capability, Overview carries a `Why nest-storage?` block, Architecture
  carries the design-principles table that follows its diagram everywhere else,
  Security Model is one subheading per property, and Testing & Quality states what the
  suite is held to before listing the commands. The tail gained the family's license
  line and footer, and Subpath Exports gained the dependency diagram and peer matrix.
- **Four statements corrected against the source.** `KeyResolverService` was listed as
  public API and is not exported; the module was described as refusing an unusable
  configuration at bootstrap, where `validate-options` deliberately tolerates empty
  credentials so a development workflow boots; `STORAGE_INVALID_PART_COUNT` was missing
  from the error table; and the suppression claim said the production source carries no
  mutation directives, where it carries five, each naming why its mutant is provably
  equivalent.

## [1.0.1] - 2026-08-03

Documentation only. `dist/` is byte-identical to the one published in 1.0.0 —
verified by unpacking `@bymax-one/nest-storage@1.0.0` from the registry and
diffing it against a fresh build, not asserted. The README ships inside the
package, so a README that is wrong on npm stays wrong until a release replaces
it; that is the whole reason this version exists.

### Fixed

- **Four statements in the README that the code does not support.**
  `KeyResolverService` was documented as public API — it is not exported from the
  barrel, so `import { KeyResolverService } from '@bymax-one/nest-storage'` does
  not resolve. The module was described as refusing an unusable configuration at
  bootstrap; `validate-options` deliberately tolerates empty credentials so a
  development workflow boots without storage, and operations then fail with
  `STORAGE_NOT_CONFIGURED`. `STORAGE_INVALID_PART_COUNT` was missing from the
  error table although `getMultipartUploadUrls()` throws it for `parts <= 0`.
- **The error-payload claim, in both places it was made.** The error table and
  the security table said `details` carries the provider code, HTTP status and
  request id _only_. `mapAwsError` also includes `awsMessage` and spreads the
  call site's context — `op`, `bucket`, and the resolved `key` or `prefix` — so an
  object key does reach whatever consumes the exception. Both now list what is
  actually there, and the security model says the consequence plainly.
- **The supply-chain row named tools this repository does not run.** It claimed
  OSV-Scanner _and_ TruffleHog; only OSV-Scanner is wired up here, alongside
  CodeQL and OpenSSF Scorecard. It also called the Actions SHA-pinned without
  qualification, where the org-internal reusables are referenced by tag.

### Changed

- **The README follows the `@bymax-one` family layout.** Header rebuilt to the
  shared shape — wordmark, package name, claim and feature line, one badge row,
  one navigation row — and the section spine completed with API Reference,
  Architecture, Security Model, Security Table, Tech Stack, Testing & Quality and
  Security Policy, which every published library in the family carries and this
  one did not.

## [1.0.0] - 2026-08-03

First published release. Everything below ships in it.

The `Fixed` and `Security` entries record defects found and corrected before
publication, not regressions any consumer saw — there is no earlier release to
have regressed from. They are kept because the reasoning is worth having.

### Added

- **Initial release** of `@bymax-one/nest-storage` — provider-agnostic S3-compatible object storage for NestJS.
- **Single `@aws-sdk/client-s3` engine** — works with AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO, and Wasabi.
- **`StorageService`** — full object lifecycle:
  - `upload()` — single-shot PutObject or automatic multipart via `@aws-sdk/lib-storage` (with `leavePartsOnError: false` for automatic abort on failure), `onProgress` events, `idempotencyKey` cache
  - `download()` — streaming `Readable` with metadata
  - `downloadBuffer()` — buffered download (for files < 10 MiB)
  - `head()` — object metadata without downloading
  - `exists()` — non-throwing existence check
  - `delete()` — idempotent (no error on 404)
  - `deleteMany()` — batched (chunked ≤ 1 000 keys per S3 API call); returns `{ deleted, failed }`
  - `list()` — paginated listing via `ContinuationToken`
  - `copy()` — server-side copy (same or cross-bucket)
  - `getPublicUrl()` — unsigned public URL (does not validate ACL or existence)
- **`SignedUrlService`** — presigned URL generation:
  - `getDownloadUrl()` — presigned GET with optional response headers
  - `getUploadUrl()` — presigned PUT with Content-Length-Range policy
  - `getMultipartUploadUrls()` — presigned multipart (InitiateMultipartUpload + per-part URLs)
  - TTL clamped to `signedUrls.maxTtlSeconds`; `maxTtlSeconds` clamped to 604 800 s (7-day SigV4 ceiling) at init
- **`IUploadValidator` hook** — pluggable pre-upload validator (MIME whitelist with wildcards, size limit, custom `readBytes` magic-byte checks); `NoOpUploadValidator` included
- **`IFileScanner` hook** — pluggable virus-scan integration (`pre-upload` / `post-upload` / `both`; `rejectOnUnknown` policy); `NoOpFileScanner` included
- **Six provider recipes** (`providerRecipes`):
  - `awsS3` — AWS S3 with SSE-AES256; SDK default checksum mode
  - `cloudflareR2` — region `'auto'`; `customDomain` required; checksums `'WHEN_REQUIRED'`
  - `backblazeB2` — virtual-hosted; checksums `'WHEN_REQUIRED'`
  - `digitalOceanSpaces` — with CDN base URL; checksums `'WHEN_REQUIRED'`
  - `minio` — `forcePathStyle: true`; checksums `'WHEN_REQUIRED'`
  - `wasabi` — virtual-hosted; checksums `'WHEN_REQUIRED'`
- **17-code `StorageException` catalog** — typed errors extending `HttpException` with `{ error: { code, message, details? } }` response body; `STORAGE_ERROR_CODES` exported from the `./shared` subpath
- **`keyPrefix` multi-tenant isolation** — prepended to every resolved key; enforced by `KeyResolverService`
- **Mandatory path-traversal guard** — `KeyResolverService` blocks `..`, leading `/`, and empty-after-normalize keys (`STORAGE_KEY_INVALID` / HTTP 400)
- **In-memory LRU idempotency cache** — default 1 000 entries / 24 h; `idempotencyKey` per-upload
- **Server-side encryption** — `serverSideEncryption: 'AES256'` or `'aws:kms'` globally or per-upload; `'NONE'` sentinel omits the header
- **Subpath exports**:
  - `.` — server runtime (NestJS module, services, provider recipes, DI tokens, interfaces)
  - `./shared` — framework-free types and `STORAGE_ERROR_CODES`
- **`forRoot` / `forRootAsync`** dynamic module API (`@Global()`; `Symbol()` DI tokens)
- **`BYMAX_STORAGE_S3_CLIENT` DI token** — raw `S3Client` injection for provider-specific advanced operations (spec §11.2)
- **Non-AWS checksum opt-out** — the five non-AWS recipes set `requestChecksumCalculation` / `responseChecksumValidation` to `'WHEN_REQUIRED'` to prevent the SDK's default CRC32 `x-amz-checksum-*` headers from being sent to providers that reject them

- **`pnpm check:exports`** runs `attw --pack . --profile strict` against the packed
  tarball. Its absence is why both defects above went unnoticed: a source-level
  typecheck compiles `src` and never resolves through the `exports` map.
- **`pnpm check:runtime`** packs the tarball, lays it out the way npm would, and
  loads every subpath from it in ESM _and_ CommonJS, asserting the expected values
  are really exported. `attw` proves the declarations resolve; it never runs the
  JavaScript. Both gates run in CI.

### Fixed

- **CommonJS consumers resolved ESM type declarations.** The `exports` map
  declared a single `types` condition, so `require()` landed on `.d.ts` instead of
  `.d.cts` — `attw --profile strict` reports it as _Masquerading as ESM_ on every
  subpath. Types are now declared per condition.

- **`node10` type resolution failed outright**: the manifest carried no complete
  set of `main`, `module`, `types` and `typesVersions`. All four are now present.

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. A floor
  below a published advisory tells a consumer that a vulnerable install is a
  supported one, and nothing in their tooling contradicts it — the install resolves
  cleanly and silently. Corrected before the first publish, so no released version
  ever carried the permissive range. No runtime behaviour changed.

---

[1.0.0]: https://github.com/bymaxone/nest-storage/releases/tag/v1.0.0
[1.0.1]: https://github.com/bymaxone/nest-storage/compare/v1.0.0...v1.0.1
[1.0.2]: https://github.com/bymaxone/nest-storage/compare/v1.0.1...v1.0.2
[1.0.3]: https://github.com/bymaxone/nest-storage/compare/v1.0.2...v1.0.3
[1.0.4]: https://github.com/bymaxone/nest-storage/compare/v1.0.3...v1.0.4
[1.0.5]: https://github.com/bymaxone/nest-storage/compare/v1.0.4...v1.0.5
[1.0.6]: https://github.com/bymaxone/nest-storage/compare/v1.0.5...v1.0.6
[1.1.0]: https://github.com/bymaxone/nest-storage/compare/v1.0.6...v1.1.0
[1.1.1]: https://github.com/bymaxone/nest-storage/compare/v1.1.0...v1.1.1
[1.1.2]: https://github.com/bymaxone/nest-storage/compare/v1.1.1...v1.1.2
[1.1.3]: https://github.com/bymaxone/nest-storage/compare/v1.1.2...v1.1.3
[1.1.4]: https://github.com/bymaxone/nest-storage/compare/v1.1.3...v1.1.4
[1.1.5]: https://github.com/bymaxone/nest-storage/compare/v1.1.4...v1.1.5
[1.1.6]: https://github.com/bymaxone/nest-storage/compare/v1.1.5...v1.1.6
[1.1.7]: https://github.com/bymaxone/nest-storage/compare/v1.1.6...v1.1.7
[1.1.8]: https://github.com/bymaxone/nest-storage/compare/v1.1.7...v1.1.8
[1.1.9]: https://github.com/bymaxone/nest-storage/compare/v1.1.8...v1.1.9
[1.1.10]: https://github.com/bymaxone/nest-storage/compare/v1.1.9...v1.1.10
[1.1.11]: https://github.com/bymaxone/nest-storage/compare/v1.1.10...v1.1.11
[1.1.12]: https://github.com/bymaxone/nest-storage/compare/v1.1.11...v1.1.12
[1.1.13]: https://github.com/bymaxone/nest-storage/compare/v1.1.12...v1.1.13
[1.1.14]: https://github.com/bymaxone/nest-storage/compare/v1.1.13...v1.1.14
[1.1.15]: https://github.com/bymaxone/nest-storage/compare/v1.1.14...v1.1.15
[1.1.16]: https://github.com/bymaxone/nest-storage/compare/v1.1.15...v1.1.16
[1.1.17]: https://github.com/bymaxone/nest-storage/compare/v1.1.16...v1.1.17
[1.1.18]: https://github.com/bymaxone/nest-storage/compare/v1.1.17...v1.1.18
[1.1.19]: https://github.com/bymaxone/nest-storage/compare/v1.1.18...v1.1.19
[1.1.20]: https://github.com/bymaxone/nest-storage/compare/v1.1.19...v1.1.20
[1.1.21]: https://github.com/bymaxone/nest-storage/compare/v1.1.20...v1.1.21
[1.1.22]: https://github.com/bymaxone/nest-storage/compare/v1.1.21...v1.1.22
[1.1.23]: https://github.com/bymaxone/nest-storage/compare/v1.1.22...v1.1.23
[Unreleased]: https://github.com/bymaxone/nest-storage/compare/v1.1.23...HEAD
