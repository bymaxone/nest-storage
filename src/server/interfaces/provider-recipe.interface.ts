/**
 * @fileoverview Provider-recipe contract — a factory that produces
 * pre-tuned module options for a specific S3-compatible provider.
 * @layer server/interfaces
 */
import type { BymaxStorageModuleOptions } from './storage-module-options.interface'

/**
 * Provider Recipe — a factory function that produces a
 * `BymaxStorageModuleOptions` pre-tuned for a specific S3-compatible provider.
 */
export type ProviderRecipe<TInput> = (input: TInput) => BymaxStorageModuleOptions
