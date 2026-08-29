/** Canonical KeepIndex environment names used across the server and scripts. */
export const KEEPINDEX_ENVIRONMENT_NAMES = {
  DB_PATH: 'KEEPINDEX_DB_PATH',
  ALLOWED_ORIGINS: 'KEEPINDEX_ALLOWED_ORIGINS',
  BROWSER_HISTORY_PATHS: 'KEEPINDEX_BROWSER_HISTORY_PATHS',
  SEARCH_MAX_RETRIES: 'KEEPINDEX_SEARCH_MAX_RETRIES',
  URL: 'KEEPINDEX_URL',
  CORPUS_MODEL: 'KEEPINDEX_CORPUS_MODEL',
} as const

export type KeepIndexEnvironmentKey = keyof typeof KEEPINDEX_ENVIRONMENT_NAMES
export type Environment = Readonly<Record<string, string | undefined>>

export function readKeepIndexEnvironment(
  key: KeepIndexEnvironmentKey,
  environment: Environment = process.env
): string | undefined {
  return environment[KEEPINDEX_ENVIRONMENT_NAMES[key]]?.trim() || undefined
}
