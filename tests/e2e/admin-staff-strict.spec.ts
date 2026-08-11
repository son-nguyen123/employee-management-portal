import { expect, test, type Page } from '@playwright/test'

type Role = 'admin' | 'employee'

async function enterPreview(page: Page, role: Role) {
  await page.addInitScript((previewRole) => {
    window.sessionStorage.setItem('employee-portal-preview-mode', 'true')
    window.sessionStorage.setItem('employee-portal-preview-role', previewRole)
    window.localStorage.setItem('tricandy-pwa-installed', 'true')
  }, role)
}

async function strictUiAudit(page: Page) {
  await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|This page could not be found/i)
  const report = await page.evaluate(() => {
    const selector = 'button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    const controls = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
    })
    const tooSmall: string[] = []
    const covered: string[] = []
    controls.forEach((element) => {
      const rect = element.getBoundingClientRect()
      const label = (element.getAttribute('aria-label') || element.innerText || element.tagName).trim().slice(0, 60)
      if (rect.width < 40 || rect.height < 40) tooSmall.push(`${label} (${Math.round(rect.width)}x${Math.round(rect.height)})`)
      const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
      const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
      if (rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight) {
        const top = document.elementFromPoint(x, y)
        const topControl = top?.closest(selector)
        if (top && top !== element && !element.contains(top) && topControl !== element) covered.push(label)
      }
    })
    return { overflow: document.documentElement.scrollWidth - innerWidth, tooSmall, covered }
  })
  expect(report.overflow, `Trang tràn ngang ${report.overflow}px`).toBeLessThanOrEqual(1)
  expect(report.tooSmall, `Vùng bấm dưới 40px: ${report.tooSmall.join(', ')}`).toEqual([])
  expect(report.covered, `Vùng bấm bị che: ${report.covered.join(', ')}`).toEqual([])
}

for (const route of ['/', '/schedule', '/penalties', '/salary-advance']) {
  test(`staff: ${route} không lỗi, không tràn và vùng bấm dùng được`, async ({ page }) => {
    await enterPreview(page, 'employee')
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('body')).toBeVisible()
    await strictUiAudit(page)
  })
}

for (const route of ['/admin/dashboard', '/admin/dashboard?view=employees', '/admin/next-week', '/admin/requests', '/admin/archive']) {
  test(`admin: ${route} không lỗi, không tràn và vùng bấm dùng được`, async ({ page }) => {
    await enterPreview(page, 'admin')
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('body')).toBeVisible()
    if (route === '/admin/next-week') {
      await expect(page.getByRole('button', { name: 'Xuất lịch nhân sự tuần tới ra Excel' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Xuất lịch trực tuần tới ra Excel' })).toBeVisible()
    }
    await strictUiAudit(page)
  })
}
