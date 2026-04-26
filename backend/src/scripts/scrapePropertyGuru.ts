import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapePropertyGuruSearch } from '../lib/scrapers/propertyGuru';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const url = getArg('--url') || process.argv[2];
  if (!url) {
    throw new Error(
      'Usage: npm run scrape:propertyguru -- --url <propertyguru-search-url> [--limit 20] [--details] [--phone] [--headless] [--no-auto-verify] [--max-retries 3] [--profile-dir <dir>] [--window-width 1440] [--window-height 900] [--debug] [--output <file>] [--no-save]'
    );
  }

  const limit = Number(getArg('--limit') || '20');
  const headless = process.argv.includes('--headless');
  const debug = process.argv.includes('--debug') || process.env.PG_DEBUG === '1';
  // auto-verify is ON by default; use --no-auto-verify to disable
  const autoVerify = !process.argv.includes('--no-auto-verify');
  const maxRetries = Number(getArg('--max-retries') || '3');
  const userDataDir = getArg('--profile-dir') || process.env.PG_PROFILE_DIR;
  const windowWidth = Number(getArg('--window-width') || process.env.PG_WINDOW_WIDTH || '1440');
  const windowHeight = Number(getArg('--window-height') || process.env.PG_WINDOW_HEIGHT || '900');
  const noSave = process.argv.includes('--no-save');
  const scrapeDetails = process.argv.includes('--details');
  const scrapePhone = process.argv.includes('--phone');

  console.error(`🔍 Scraping PropertyGuru (limit=${limit}, details=${scrapeDetails || scrapePhone}, phone=${scrapePhone})...`);

  const result = await scrapePropertyGuruSearch({
    url,
    limit,
    headless,
    debug,
    autoVerify,
    maxRetries,
    userDataDir,
    windowWidth,
    windowHeight,
    scrapeDetails: scrapeDetails || scrapePhone, // --phone implies --details
    scrapePhone
  });

  // Print to stdout
  console.log(JSON.stringify(result, null, 2));

  // Auto-save to file unless --no-save is specified
  if (!noSave) {
    const dataDir = path.resolve(__dirname, '../../data');
    fs.mkdirSync(dataDir, { recursive: true });

    const customOutput = getArg('--output');
    let outputPath: string;

    if (customOutput) {
      outputPath = path.resolve(customOutput);
    } else {
      // Generate filename with timestamp: pg-results-20260425-223400.json
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
      outputPath = path.join(dataDir, `pg-results-${timestamp}.json`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    console.error(`\n✅ Results saved to: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
