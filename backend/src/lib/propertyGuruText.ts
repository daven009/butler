const PRIMARY_SECTION_ENDINGS = new Set([
  "What's nearby",
  'Track this home value',
  "Track this home's value",
  'More listings in this project',
  'More listings in this HDB',
  'Recommendations',
  'FAQs',
]);

function linesOf(rawText: string): string[] {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractPrimaryPgListingText(rawText: string): string {
  const lines = linesOf(rawText);
  const end = lines.findIndex((line) => PRIMARY_SECTION_ENDINGS.has(line));
  return lines.slice(0, end >= 0 ? end : 250).join('\n').slice(0, 16_000);
}

export function extractPgAgentContactText(rawText: string): string {
  const lines = linesOf(rawText);
  const shareIndex = lines.lastIndexOf('Share');
  if (shareIndex < 0) return '';

  const contactLines = lines.slice(shareIndex + 1, shareIndex + 10);
  const end = contactLines.findIndex((line) =>
    ['WhatsApp Web', 'Other ways to enquire', 'By continuing, you agree'].includes(line),
  );
  return contactLines.slice(0, end >= 0 ? end : contactLines.length).join('\n');
}

export function normalizePgEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-SG')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function textContainsCandidate(text: string, candidate: string): boolean {
  const normalizedCandidate = normalizePgEvidenceText(candidate);
  return Boolean(normalizedCandidate) &&
    normalizePgEvidenceText(text).includes(normalizedCandidate);
}
