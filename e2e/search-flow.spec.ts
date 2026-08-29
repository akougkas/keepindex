import { test, expect } from '@playwright/test'
import { mockAllApis, waitForText } from './helpers.js'

test.describe('unified search flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page)
    await page.goto('/')
  })

  test('the default omnibar streams a grounded answer', async ({ page }) => {
    const omnibar = page.getByPlaceholder('Ask anything... search web + vault')
    await omnibar.fill('what is typescript')
    await omnibar.press('Enter')
    await waitForText(page, 'Mock AI answer')
    await expect(page.getByText('Follow-up 1?')).toBeVisible()
    await expect(page.getByText('Grounded answer')).toBeVisible()
  })

  test('raw search remains available as an inline power route', async ({ page }) => {
    const omnibar = page.getByPlaceholder('Ask anything... search web + vault')
    await omnibar.fill('/search test query')
    await omnibar.press('Enter')
    await expect(page.getByText('Mock Result')).toBeVisible()
    await expect(page.getByText('Direct results')).toBeVisible()
  })

  test('chat is a continuous route in the same workspace', async ({ page }) => {
    const omnibar = page.getByPlaceholder('Ask anything... search web + vault')
    await omnibar.fill('/chat hello')
    await omnibar.press('Enter')
    await expect(page.getByRole('paragraph').filter({ hasText: 'hello' }).first()).toBeVisible()
    await waitForText(page, 'Chat reply')
    await expect(page.getByText('Follow-up thread')).toBeVisible()
  })

  test('Shift+Enter starts research and renders streaming markdown', async ({ page }) => {
    const omnibar = page.getByPlaceholder('Ask anything... search web + vault')
    await omnibar.fill('resilient local retrieval')
    await omnibar.press('Shift+Enter')
    await waitForText(page, 'Mock research report')
    await expect(page.getByText('What is verified?').first()).toBeVisible()
    await expect(page.getByText('Research Source')).toBeVisible()
  })

  test('math evaluates instantly without waiting for an API', async ({ page }) => {
    const omnibar = page.getByPlaceholder('Ask anything... search web + vault')
    await omnibar.fill('24 * 1024')
    await expect(page.getByText('24,576')).toBeVisible()
  })
})
