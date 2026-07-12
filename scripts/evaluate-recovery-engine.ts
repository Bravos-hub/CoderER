import { randomUUID } from 'node:crypto';
import { CitationSourceType, type InvestigationCitation, type PatchFile } from '@codeer/contracts';
import { defaultRecoveryPolicy, evaluatePatchPolicy, parseUnifiedDiff } from '@codeer/recovery';

const citation: InvestigationCitation = {
  sourceType: CitationSourceType.REPOSITORY_FILE,
  sourceId: randomUUID(),
  digest: 'a'.repeat(64),
  path: 'apps/api/src/service.ts',
  lineStart: 1,
  lineEnd: 4,
  label: 'Verified source evidence',
};

function file(filePath: string, overrides: Partial<PatchFile> = {}): PatchFile {
  const fileId = randomUUID();
  return {
    id: fileId,
    patchId: randomUUID(),
    oldPath: filePath,
    newPath: filePath,
    changeType: 'MODIFY',
    oldDigest: null,
    newDigest: null,
    addedLines: 1,
    deletedLines: 1,
    binary: false,
    generated: false,
    sensitive: false,
    hunks: [
      {
        id: randomUUID(),
        fileId,
        sequence: 1,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: '@@ -1 +1 @@',
        content: '@@ -1 +1 @@\n-old\n+new',
        addedLines: 1,
        deletedLines: 1,
        treatmentPlanStep: 1,
        evidenceCitations: [citation],
        contentHash: 'b'.repeat(64),
      },
    ],
    ...overrides,
  };
}

const base = defaultRecoveryPolicy(['apps', 'packages']);
const cases = [
  { name: 'minimal source patch', expected: true, files: [file('apps/api/src/service.ts')] },
  {
    name: 'path escape',
    expected: false,
    throws: true,
    diff: 'diff --git a/../secret b/../secret\n--- a/../secret\n+++ b/../secret\n@@ -1 +1 @@\n-a\n+b',
  },
  { name: 'binary patch', expected: false, throws: true, diff: 'GIT binary patch' },
  {
    name: 'dependency change',
    expected: false,
    files: [file('package.json')],
    policy: { ...base, allowedPaths: ['.'], allowedExtensions: ['.json'] },
  },
  {
    name: 'lockfile change',
    expected: false,
    files: [file('package-lock.json')],
    policy: { ...base, allowedPaths: ['.'], allowedExtensions: ['.json'] },
  },
  {
    name: 'workflow change',
    expected: false,
    files: [file('.github/workflows/ci.yml')],
    policy: { ...base, allowedPaths: ['.'], allowedExtensions: ['.yml'] },
  },
  {
    name: 'migration change',
    expected: false,
    files: [file('packages/database/prisma/schema.prisma')],
    policy: { ...base, allowedExtensions: [...base.allowedExtensions, '.prisma'] },
  },
  {
    name: 'security-sensitive change',
    expected: false,
    files: [file('apps/api/src/auth/guard.ts', { sensitive: true })],
  },
  {
    name: 'generated output',
    expected: false,
    files: [file('apps/web/.next/generated.ts', { generated: true })],
  },
  {
    name: 'file budget overflow',
    expected: false,
    files: [file('apps/a.ts'), file('apps/b.ts')],
    policy: { ...base, maximumChangedFiles: 1 },
  },
  {
    name: 'missing provenance',
    expected: false,
    throws: true,
    diff: 'diff --git a/apps/a.ts b/apps/a.ts\n--- a/apps/a.ts\n+++ b/apps/a.ts\n@@ -1 +1 @@\n-a\n+b',
  },
];

const results = cases.map((testCase) => {
  try {
    let allowed: boolean;
    if ('diff' in testCase && testCase.diff) {
      const parsed = parseUnifiedDiff(
        testCase.diff,
        testCase.name === 'missing provenance'
          ? {}
          : { 'apps/a.ts': { treatmentPlanStep: 1, citations: [citation] } },
      );
      allowed = evaluatePatchPolicy(
        testCase.policy ?? base,
        parsed.files,
        Buffer.byteLength(testCase.diff),
      ).allowed;
    } else {
      allowed = evaluatePatchPolicy(testCase.policy ?? base, testCase.files ?? [], 500).allowed;
    }
    return { name: testCase.name, passed: allowed === testCase.expected, allowed };
  } catch (error) {
    return {
      name: testCase.name,
      passed: Boolean(testCase.throws) && testCase.expected === false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const passed = results.filter((result) => result.passed).length;
const report = {
  suite: 'codeer-controlled-recovery-v1',
  cases: results.length,
  passed,
  failed: results.length - passed,
  policyBlockRate:
    results.filter((result) => result.name !== 'minimal source patch' && result.passed).length /
    (results.length - 1),
  results,
};
console.log(JSON.stringify(report, null, 2));
if (passed !== results.length) process.exitCode = 1;
