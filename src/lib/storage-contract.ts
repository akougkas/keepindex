export const KEEPINDEX_STORAGE_KEYS = {
  collections: 'keepindex-collections',
  session: 'keepindex-session',
  chatHistory: 'keepindex-chat-history',
  settings: 'keepindex-settings',
  theme: 'keepindex-theme',
  journey: 'keepindex-journey',
  workspaceRecovery: 'keepindex-workspace-recovery',
} as const

export const CLIENT_STORAGE_KEYS = [
  KEEPINDEX_STORAGE_KEYS.collections,
  KEEPINDEX_STORAGE_KEYS.session,
  KEEPINDEX_STORAGE_KEYS.chatHistory,
  KEEPINDEX_STORAGE_KEYS.settings,
  KEEPINDEX_STORAGE_KEYS.theme,
  KEEPINDEX_STORAGE_KEYS.journey,
  KEEPINDEX_STORAGE_KEYS.workspaceRecovery,
] as const

export type ClientStorageKey = (typeof CLIENT_STORAGE_KEYS)[number]

/** Clear only browser state owned by KeepIndex. */
export function clearKeepIndexClientStorage(storage: Pick<Storage, 'removeItem'>): void {
  let firstFailure: unknown
  for (const key of CLIENT_STORAGE_KEYS) {
    try {
      storage.removeItem(key)
    } catch (error) {
      firstFailure ??= error
    }
  }
  if (firstFailure) throw firstFailure
}
