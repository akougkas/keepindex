import { test, expect } from '@playwright/test'
import { mockAllApis } from './helpers.js'

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page)
    await page.goto('/')
    // Canonical browser storage initializes before React is imported. Wait for
    // that data boundary and the visible workspace to be ready before
    // sending global keyboard shortcuts.
    await expect(page.getByRole('heading', { name: 'KeepIndex' })).toBeVisible()
  })

  test('app boots into the unified omnibar', async ({ page }) => {
    await expect(page.getByPlaceholder('Ask anything... search web + vault')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'KeepIndex' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Search your world/ })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
  })

  test('command palette opens with Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('Type a command...')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Type a command...')).not.toBeVisible()
  })

  test('keyboard shortcut / focuses omnibar', async ({ page }) => {
    await page.getByRole('heading', { name: 'KeepIndex' }).click()
    await page.keyboard.press('/')
    await expect(page.getByPlaceholder('Ask anything... search web + vault')).toBeFocused()
  })

  test('collections panel opens with Ctrl+B', async ({ page }) => {
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
  })

  test('settings panel opens', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: /KeepIndex settings/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /local-multimodal-model/ })).toBeAttached()
  })

  test('knowledge base panel opens', async ({ page }) => {
    await page.getByRole('button', { name: 'Knowledge vault' }).click()
    await expect(page.getByRole('heading', { name: /Knowledge resources/ })).toBeVisible()
  })

  test('theme toggle works', async ({ page }) => {
    const html = page.locator('html')
    const hadDark = (await html.getAttribute('class'))?.split(/\s+/).includes('dark') ?? false
    await page.getByRole('button', { name: hadDark ? 'Switch to light mode' : 'Switch to dark mode' }).click()
    const hasDarkAfter = (await html.getAttribute('class'))?.split(/\s+/).includes('dark') ?? false
    expect(hasDarkAfter).toBe(!hadDark)
  })
})
