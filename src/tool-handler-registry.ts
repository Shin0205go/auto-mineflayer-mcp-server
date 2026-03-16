/**
 * Mutable handler registry for hot-reload support.
 *
 * ESM modules are cached once loaded. But this registry object is a shared
 * mutable singleton — when a module is re-imported with cache busting
 * (?v=timestamp), it gets the SAME registry object from the cached import
 * and overwrites entries with new function references.
 *
 * Flow:
 * 1. Module loaded → registers functions into registry
 * 2. mc_reload → re-imports module with ?v=timestamp
 * 3. New module instance writes new functions to SAME registry object
 * 4. Callers reading from registry get updated functions
 */
export const registry: Record<string, Record<string, Function>> = {};
