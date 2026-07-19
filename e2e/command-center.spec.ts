import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const incidentId = '10000000-0000-4000-8000-000000000001';
const repositoryId = '20000000-0000-4000-8000-000000000001';
const recoveryId = '30000000-0000-4000-8000-000000000001';
const now = '2026-07-19T12:00:00.000Z';

const incident = {
  id: incidentId,
  organizationId: '00000000-0000-4000-8000-000000000001',
  repositoryId,
  shortCode: 'CER-1042',
  title: 'Deterministic production build failure',
  description: 'The fixture build fails until the verified recovery is applied.',
  severity: 'SEV-2',
  severityScore: 76,
  severityReason: 'Production deployment is blocked.',
  status: 'VERIFIED',
  stage: 'VERIFY',
  source: 'MANUAL',
  version: 8,
  lastActivityAt: now,
  createdAt: now,
  updatedAt: now,
};

const incidentDetail = {
  incident,
  latestSeverityAssessment: {
    score: 76,
    severity: 'SEV-2',
    calculatedSeverity: 'SEV-2',
    overrideApplied: false,
    rationale: 'Production deployment is blocked.',
    factors: {},
    policyVersion: 'severity-v1',
  },
  latestHealthSnapshot: {
    id: '40000000-0000-4000-8000-000000000001',
    organizationId: incident.organizationId,
    repositoryId,
    incidentId,
    overallScore: 92,
    status: 'HEALTHY',
    dimensions: {
      build: 100,
      tests: 100,
      deploymentReadiness: 90,
      dependencies: 90,
      security: 100,
      apiConsistency: 90,
      frontendFunctionality: 90,
    },
    evidenceCount: 2,
    calculationVersion: 'health-v1',
    createdAt: now,
  },
  evidence: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      organizationId: incident.organizationId,
      incidentId,
      sessionId: null,
      kind: 'TEST_RESULT',
      source: 'SANDBOX',
      sensitivity: 'INTERNAL',
      title: 'Original failure resolved',
      summary: 'The previously failing deterministic test now passes.',
      payload: {},
      digest: 'a'.repeat(64),
      byteSize: 128,
      redacted: false,
      redactionCount: 0,
      observedAt: now,
      createdAt: now,
    },
  ],
  timeline: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      incidentId,
      sequence: 1,
      type: 'STATUS_CHANGED',
      payload: {},
      actorType: 'SYSTEM',
      actorId: null,
      requestId: null,
      correlationId: null,
      causationId: null,
      previousHash: null,
      eventHash: 'b'.repeat(64),
      occurredAt: now,
      createdAt: now,
    },
  ],
  timelineIntegrity: { valid: true, checkedEvents: 1, brokenSequence: null, reason: null },
};

const recovery = {
  id: recoveryId,
  organizationId: incident.organizationId,
  incidentId,
  treatmentPlanId: '70000000-0000-4000-8000-000000000001',
  repositoryId,
  status: 'PUBLISHED',
  version: 5,
  policyVersion: 'recovery-v1',
  treatmentPlanVersion: 1,
  baseCommitSha: 'c'.repeat(40),
  branchName: 'codeer/recovery-1042',
  patchVersion: 1,
  leaseOwner: null,
  leaseExpiresAt: null,
  cancellationRequestedAt: null,
  startedAt: now,
  completedAt: now,
  errorCode: null,
  errorMessage: null,
  createdAt: now,
  updatedAt: now,
};
const recoveryDetail = {
  recovery,
  patch: null,
  securityReview: null,
  verification: {
    id: '80000000-0000-4000-8000-000000000001',
    recoveryId,
    patchId: '90000000-0000-4000-8000-000000000001',
    status: 'PASSED',
    originalFailureResolved: true,
    unexpectedChanges: [],
    scopeExpanded: false,
    checks: [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        verificationId: '80000000-0000-4000-8000-000000000001',
        sequence: 1,
        name: 'Original failure',
        mandatory: true,
        status: 'PASSED',
        exitCode: 0,
        evidenceIds: [],
        summary: 'Original failure no longer reproduces.',
        startedAt: now,
        completedAt: now,
      },
    ],
    summary: 'All mandatory verification checks passed.',
    confidence: 0.99,
    contentHash: 'd'.repeat(64),
    createdAt: now,
  },
  pullRequestPackage: {
    id: 'b0000000-0000-4000-8000-000000000001',
    version: 1,
    recoveryId,
    patchId: '90000000-0000-4000-8000-000000000001',
    title: 'Fix deterministic production build',
    body: 'Evidence-backed recovery package for the deterministic production build failure.',
    headBranch: 'codeer/recovery-1042',
    baseBranch: 'main',
    rootCauseSummary: 'An invalid fixture expectation caused the build to fail.',
    changedFiles: ['src/build.ts'],
    riskSummary: 'Low-risk targeted change.',
    verificationSummary: 'Original failure, tests, and build pass.',
    knownLimitations: [],
    rollbackInstructions: 'Revert the recovery commit and rerun the build.',
    packageHash: 'e'.repeat(64),
    createdAt: now,
  },
};

async function mockApi(page: Page, options: { includeIncident?: boolean } = {}) {
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api(?:\/proxy)?/, '');
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/repositories/intakes' && request.method() === 'POST')
      return json({
        intakeId: 'c0000000-0000-4000-8000-000000000001',
        status: 'READY',
        progress: 100,
        result: { repositoryId },
      });
    if (path.startsWith(`/incidents/${incidentId}/recoveries`))
      return json({ items: [recovery], nextCursor: null });
    if (path === `/recoveries/${recoveryId}`) return json(recoveryDetail);
    if (path === `/incidents/${incidentId}`) return json(incidentDetail);
    if (path.startsWith('/incidents') && request.method() === 'POST') return json(incident);
    if (path.startsWith('/incidents'))
      return json({ items: options.includeIncident ? [incident] : [], nextCursor: null });
    if (path.startsWith('/investigations')) return json({ items: [], nextCursor: null });
    if (path.startsWith('/recoveries')) return json({ items: [], nextCursor: null });
    if (path.startsWith('/publications')) return json([]);
    if (path.startsWith('/settings/')) return json(null);
    if (path.startsWith('/repositories')) return json([]);
    return json([]);
  });
}

const shellRoutes = [
  ['/command-center', 'Command Center'],
  ['/repositories', 'Repositories'],
  ['/repositories/connect', 'Connect a repository'],
  ['/incidents', 'Software incident response.'],
  ['/investigations', 'Investigations'],
  ['/recoveries', 'Recoveries'],
  ['/publications', 'Publications'],
  ['/approvals', 'Approvals'],
  ['/audit', 'Audit Trail'],
  ['/integrations/github', 'GitHub App setup'],
  ['/settings/organization', 'Organization settings'],
  ['/settings/ai', 'AI policy'],
  ['/settings/recovery', 'Recovery policy'],
  ['/settings/publication', 'Publication policy'],
  ['/settings/security', 'Security settings'],
] as const;

test.describe('command-center routes', () => {
  for (const [path, heading] of shellRoutes) {
    test(`${path} renders accessibly at desktop and mobile widths`, async ({ page }) => {
      await mockApi(page);
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        const accessibility = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(accessibility.violations).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      }
    });
  }
});

test('repository intake progresses through verified incident closure evidence', async ({
  page,
}) => {
  await mockApi(page, { includeIncident: true });
  await page.goto('/repositories/connect');
  await page.getByRole('button', { name: 'Admit repository' }).click();
  await expect(page.getByText('Status: READY')).toBeVisible();

  await page.goto('/incidents');
  await expect(page.getByText('CER-1042')).toBeVisible();
  await page.goto(`/incidents/${incidentId}/verification`);
  await expect(page.getByRole('heading', { name: 'Verification matrix' })).toBeVisible();
  await expect(page.getByText('Original failure no longer reproduces.')).toBeVisible();
  await page.goto(`/incidents/${incidentId}/publication`);
  await expect(
    page.getByRole('heading', { name: 'Fix deterministic production build' }),
  ).toBeVisible();
  await page.goto(`/incidents/${incidentId}/activity`);
  await expect(page.getByText('Chain verified')).toBeVisible();
});

test('settings save appends a confirmed version', async ({ page }) => {
  await page.route('**/api/proxy/settings/ORGANIZATION', async (route) => {
    const value =
      route.request().method() === 'GET'
        ? null
        : {
            id: 'd0000000-0000-4000-8000-000000000001',
            organizationId: incident.organizationId,
            kind: 'ORGANIZATION',
            version: 1,
            enforcement: 'ENFORCED',
            description: 'Organization identity, membership, retention and operational defaults.',
            configuration: { retentionDays: 365 },
            contentHash: 'f'.repeat(64),
            createdBy: 'e2e-user',
            createdAt: now,
          };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByRole('status')).toContainText('Version 1 saved');
});

test('approval inbox submits an explicit versioned treatment-plan decision', async ({ page }) => {
  const investigationId = 'e0000000-0000-4000-8000-000000000001';
  const planId = 'f0000000-0000-4000-8000-000000000001';
  let decided = false;
  let decisionBody: unknown;
  await page.route('**/api/proxy/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/proxy/', '');
    const json = (value: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (path === 'investigations?limit=100' || path === 'investigations')
      return json({ items: [{ id: investigationId }], nextCursor: null });
    if (path === `investigations/${investigationId}`)
      return json({
        investigation: { id: investigationId, incidentId },
        treatmentPlans: decided
          ? []
          : [
              {
                id: planId,
                version: 3,
                status: 'AWAITING_APPROVAL',
                goal: 'Repair the deterministic production build',
                rollbackStrategy: 'Revert the isolated recovery commit.',
                risk: 'LOW',
                steps: [{ sequence: 1, title: 'Apply the bounded patch' }],
                requiredApprovals: 1,
              },
            ],
      });
    if (path === 'recoveries?limit=100' || path === 'recoveries')
      return json({ items: [], nextCursor: null });
    if (path === `treatment-plans/${planId}/approve` && request.method() === 'POST') {
      decisionBody = request.postDataJSON();
      decided = true;
      return json({ status: 'APPROVED', version: 4 });
    }
    return json([]);
  });

  await page.goto('/approvals');
  await expect(page.getByText('Repair the deterministic production build')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Treatment plan v3 decision recorded');
  expect(decisionBody).toEqual({
    decision: 'APPROVE',
    comment:
      'I reviewed the cited evidence, proposed scope, verification plan, risks, and rollback procedure.',
    expectedVersion: 3,
  });
});
