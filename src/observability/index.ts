/**
 * @fileoverview The optional `observability` subpath: the metrics contributor and the readiness indicator.
 * It needs the optional peers `prom-client` (for the metrics) and, to be discovered, `@bymax-one/nest-core`.
 * @layer observability
 */
export { StorageMetrics, METRICS_CONTRIBUTOR_METADATA } from './storage-metrics'
export {
  StorageHealthIndicator,
  HEALTH_INDICATOR_METADATA,
  STORAGE_HEALTH_INDICATOR_NAME,
  STORAGE_HEALTH_TIMEOUT_MS,
  STORAGE_HEALTH_CACHE_MS,
} from './storage-health'
