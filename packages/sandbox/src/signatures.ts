import { redactSecretsFromText, sha256Hex } from '@codeer/security';
import {
  FailureSignatureComparisonSchema,
  FailureSignatureSchema,
  type FailureSignature,
  type FailureSignatureComparison,
} from '@codeer/contracts';

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const VOLATILE_PATTERNS: readonly [RegExp, string][] = [
  [ANSI_ESCAPE_PATTERN, ''],
  [/\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?\b/g, '<timestamp>'],
  [/\b(?:pid|process)\s*[=:]?\s*\d+\b/gi, 'pid=<n>'],
  [/\b0x[0-9a-f]+\b/gi, '<address>'],
  [/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>'],
  [/\/tmp\/[A-Za-z0-9._/-]+/g, '<tmp-path>'],
  [/\/workspaces?\/[A-Za-z0-9._/-]+/g, '<workspace-path>'],
  [/\/workspace\/[A-Za-z0-9._/-]+/g, '<workspace-path>'],
  [/\\[^\s:]+\\[^\s:]+/g, '<windows-path>'],
  [/\bline\s+\d+\b/gi, 'line <n>'],
  [/:\d+:\d+\b/g, ':<line>:<column>'],
  [/\s+/g, ' '],
];

export function normalizeFailureText(input: string): string {
  let normalized = input.slice(0, 100_000);
  for (const [pattern, replacement] of VOLATILE_PATTERNS)
    normalized = normalized.replace(pattern, replacement);
  return normalized.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[^a-z0-9_.:/@-]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  ]
    .sort()
    .slice(0, 10_000);
}

export function buildFailureSignature(input: string): FailureSignature {
  const redacted = redactSecretsFromText(input).value;
  const normalized = normalizeFailureText(redacted);
  return FailureSignatureSchema.parse({
    normalized,
    digest: sha256Hex(normalized),
    tokens: tokenize(normalized),
  });
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

export function compareFailureSignatures(
  expectedText: string,
  observedText: string,
  minimumSimilarity = 0.85,
): FailureSignatureComparison {
  const expected = buildFailureSignature(expectedText);
  const observed = buildFailureSignature(observedText);
  const similarity =
    expected.digest === observed.digest
      ? 1
      : Number(jaccard(expected.tokens, observed.tokens).toFixed(4));
  const matched = similarity >= minimumSimilarity;
  return FailureSignatureComparisonSchema.parse({
    matched,
    similarity,
    expected,
    observed,
    rationale: matched
      ? `Observed failure matched the expected signature at ${(similarity * 100).toFixed(1)}% similarity.`
      : `Observed failure similarity ${(similarity * 100).toFixed(1)}% is below the ${(minimumSimilarity * 100).toFixed(1)}% threshold.`,
  });
}
