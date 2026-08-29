import { describe, expect, it } from 'bun:test'
import { readKeepIndexEnvironment } from './environment'

describe('canonical KeepIndex environment contract', () => {
  it('reads the canonical database setting', () => {
    expect(readKeepIndexEnvironment('DB_PATH', {
      KEEPINDEX_DB_PATH: '/data/keepindex.sqlite',
    })).toBe('/data/keepindex.sqlite')
  })

  it('ignores unrelated database variables when the canonical setting is absent', () => {
    expect(readKeepIndexEnvironment('DB_PATH', {
      APP_DB_PATH: '/data/app.sqlite',
      DATABASE_PATH: '/data/database.sqlite',
    })).toBeUndefined()
  })

  it('treats a blank canonical value as unset', () => {
    expect(readKeepIndexEnvironment('URL', { KEEPINDEX_URL: '   ' })).toBeUndefined()
  })

  it('trims the canonical value', () => {
    expect(readKeepIndexEnvironment('URL', {
      KEEPINDEX_URL: '  http://127.0.0.1:4173/  ',
    })).toBe('http://127.0.0.1:4173/')
  })

  it('reads every supported canonical setting', () => {
    expect(readKeepIndexEnvironment('ALLOWED_ORIGINS', {
      KEEPINDEX_ALLOWED_ORIGINS: 'https://current.example',
    })).toBe('https://current.example')
    expect(readKeepIndexEnvironment('BROWSER_HISTORY_PATHS', {
      KEEPINDEX_BROWSER_HISTORY_PATHS: '/profiles/current/History',
    })).toBe('/profiles/current/History')
    expect(readKeepIndexEnvironment('SEARCH_MAX_RETRIES', {
      KEEPINDEX_SEARCH_MAX_RETRIES: '4',
    })).toBe('4')
    expect(readKeepIndexEnvironment('CORPUS_MODEL', {
      KEEPINDEX_CORPUS_MODEL: 'current-model',
    })).toBe('current-model')
  })
})
