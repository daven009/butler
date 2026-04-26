/**
 * pgLogin — Step 1: Open a persistent browser so the user can log in manually.
 *
 * This script simply opens a Chromium browser with a persistent profile,
 * navigates to PropertyGuru, and keeps the browser open until the user
 * presses Ctrl+C. The session/cookies are saved automatically to the profile
 * directory and will be reused by the scraper.
 *
 * Usage:  npm run pg:login
 *         (then log in manually, then press Ctrl+C to save & close)
 */
import path from 'path';
import { chromium } from 'playwright';

const DEFAULT_PROFILE_DIR = path.resolve(process.cwd(), '.playwright', 'propertyguru-profile');

async function main() {
  const profileDir = process.argv[2] || DEFAULT_PROFILE_DIR;

  console.error(`\n🌐 Opening PropertyGuru browser...`);
  console.error(`   Profile dir: ${profileDir}`);
  console.error(`\n   👉 Please do the following in the browser window:`);
  console.error(`      1. Pass any Cloudflare verification (if it appears)`);
  console.error(`      2. Log in to your PropertyGuru account`);
  console.error(`      3. After login is done, come back here and press Ctrl+C to save & exit\n`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    args: [
      '--window-position=0,0',
      '--window-size=1440,900',
      '--disable-blink-features=AutomationControlled',
    ],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
  });

  const page = context.pages()[0] || (await context.newPage());

  // Anti-detection init script
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    const w = window as any;
    w.chrome = {
      app: { isInstalled: false },
      runtime: {},
      csi: function () { return {}; },
      loadTimes: function () { return {}; },
    };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'zh-CN'] });
    delete (window as any).__playwright;
    delete (window as any).__pw_manual;
  });

  // Navigate to PG homepage (not login page directly — less likely to trigger aggressive CF)
  await page.goto('https://www.propertyguru.com.sg/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.error(`✅ Browser is open! Log in manually, then press Ctrl+C here when done.\n`);

  // Handle graceful shutdown on Ctrl+C
  const cleanup = async () => {
    console.error(`\n🔒 Saving session and closing browser...`);
    try {
      await context.close();
    } catch { /* already closed */ }
    console.error(`✅ Done! Session saved to: ${profileDir}`);
    console.error(`\n   Now run Step 2 to scrape:`);
    console.error(`   npm run scrape:propertyguru -- --url <search_url> --limit 3 --phone\n`);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Also handle browser being closed manually by the user
  context.on('close', () => {
    console.error(`\n🔒 Browser closed. Session saved to: ${profileDir}`);
    console.error(`   Now run Step 2 to scrape:`);
    console.error(`   npm run scrape:propertyguru -- --url <search_url> --limit 3 --phone\n`);
    process.exit(0);
  });

  // Keep the process alive — just wait forever
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
