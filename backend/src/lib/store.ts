import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function ensureJsonFile<T>(filename: string, seed: T) {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`);
  }
  return filePath;
}

export function readJsonFile<T>(filename: string, seed: T): T {
  const filePath = ensureJsonFile(filename, seed);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function writeJsonFile<T>(filename: string, value: T) {
  const filePath = ensureJsonFile(filename, value);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
