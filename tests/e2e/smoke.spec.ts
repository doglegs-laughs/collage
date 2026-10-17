import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const root = path.resolve(import.meta.dirname, '..', '..');

test('app launches and shows the three mode tabs', async () => {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root, '--no-sandbox'],
    env: { ...process.env, COLLAGE_NO_SANDBOX: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.topbar');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['Collage', 'Story', 'Borders']);
    await page.getByRole('tab', { name: 'Collage' }).click(); // the last-used tab is remembered between launches
    await expect(page.getByTestId('view-collage')).toBeVisible();
    await page.getByRole('tab', { name: 'Story' }).click();
    await expect(page.getByTestId('view-story')).toBeVisible();
    await page.getByRole('tab', { name: 'Borders' }).click();
    await expect(page.getByTestId('view-borders')).toBeVisible();
    expect(await page.evaluate(() => typeof window.api?.readFile)).toBe('function');
  } finally {
    await app.close();
  }
});
