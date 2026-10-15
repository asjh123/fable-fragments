import { expect, test } from '@playwright/test'

test('移动端完成一个片段后点亮今日目标，刷新后保留进度', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今天，读一点就很好。' })).toBeVisible()
  await page.getByRole('button', { name: /岛上那些会消失的小门/ }).click()
  await expect(page.getByText('守门人的奇怪规矩')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('金属化薄膜电容的自愈机制')
  await page.getByRole('button', { name: /读完这一段/ }).click()
  await expect(page.getByText('一个缺口为何没有毁掉整座岛')).toBeVisible()
  await page.reload()
  await expect(page.getByText('一个缺口为何没有毁掉整座岛')).toBeVisible()
  await page.getByRole('button', { name: /暂停并返回/ }).click()
  await expect(page.getByText('今日目标已完成')).toBeVisible()
})

test('切换主题并进入本地模式设置', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /设置/ }).click()
  await expect(page.getByText('当前是本地模式')).toBeVisible()
  await page.getByRole('button', { name: '切换为深色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('应用壳和已缓存故事在断网后仍能打开', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /今天，读一点就很好/ })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /今天，读一点就很好/ })).toBeVisible()
  await expect(page.getByText('离线使用中')).toBeVisible()
})
