# CodeER Product Specification

**Version:** 1.0  
**Status:** Build Week implementation baseline  
**Product:** CodeER  
**Primary workflow:** Reproduce → Diagnose → Repair → Verify → Review

---

## 1. Product definition

CodeER is an evidence-driven software recovery platform for developers and small engineering teams. It uses Codex-powered response agents to investigate repository failures, prepare minimal repairs in isolation, independently verify the result and package the work as a reviewable pull request.

CodeER is not a general-purpose coding assistant. Its unit of work is a **software incident**, not an open-ended conversation.

---

## 2. Product goals

### Build Week goal

Demonstrate one credible, complete and repeatable repository recovery journey in which CodeER:

1. connects to a GitHub repository;
2. creates an isolated recovery environment;
3. reproduces a known failure;
4. gathers evidence;
5. identifies the root cause;
6. proposes a treatment plan;
7. waits for human approval;
8. applies a narrowly scoped patch;
9. runs independent verification;
10. prepares a pull-request package.

### Success definition

A judge or developer should be able to see:

- what failed;
- how CodeER reproduced it;
- why CodeER believes a specific root cause is responsible;
- what files changed and why;
- how the repair was verified;
- what risks remain;
- how to review or roll back the work.

### Non-goals for the MVP

The MVP does not attempt to provide:

- support for every Git provider;
- support for every language ecosystem;
- automatic production rollback;
- automatic merging;
- continuous monitoring of all repositories;
- enterprise billing and organisation administration;
- complete vulnerability scanning;
- unrestricted shell access;
- multi-cloud deployment orchestration;
- replacement of human code review.

---

## 3. Target users

### Primary persona: individual developer

A developer owns or contributes to a small React/Node.js repository and encounters a failing build, broken login, API mismatch or non-functional interface. They need help recovering quickly but do not trust a patch that lacks evidence.

Needs:

- fast repository understanding;
- clear diagnosis;
- minimal changes;
- commands and logs;
- transparent confidence;
- pull-request-ready output.

### Secondary persona: small-team technical lead

A technical lead needs a repeatable, auditable recovery process that junior developers can follow without allowing AI to modify protected branches directly.

Needs:

- human approval gates;
- policy enforcement;
- change visibility;
- independent verification;
- rollback instructions;
- historical case records.

---

## 4. Core domain model

### Repository

A GitHub repository connected to CodeER.

Key fields:

- `id`
- `provider`
- `owner`
- `name`
- `defaultBranch`
- `installationId`
- `visibility`
- `languageSummary`
- `packageManager`
- `frameworks`
- `lastIndexedAt`
- `healthScore`
- `connectionStatus`

### Incident

A failure admitted for investigation.

Key fields:

- `id`
- `repositoryId`
- `title`
- `description`
- `source`
- `severity`
- `status`
- `stage`
- `originalError`
- `failingCommand`
- `targetBranch`
- `environmentSummary`
- `confidence`
- `createdBy`
- `createdAt`
- `closedAt`

### Recovery session

The isolated execution of the CodeER workflow for one incident.

Key fields:

- `id`
- `incidentId`
- `worktreePath`
- `sandboxId`
- `branchName`
- `baseCommitSha`
- `status`
- `startedAt`
- `completedAt`
- `terminationReason`

### Evidence item

A fact collected during investigation or verification.

Key fields:

- `id`
- `sessionId`
- `type`
- `source`
- `command`
- `filePath`
- `summary`
- `contentExcerpt`
- `contentHash`
- `redacted`
- `relevance`
- `capturedAt`

### Diagnosis

The root-cause conclusion produced from evidence.

Key fields:

- `id`
- `sessionId`
- `summary`
- `rootCause`
- `causalChain`
- `affectedFiles`
- `alternativeHypotheses`
- `confidence`
- `limitations`

### Treatment plan

A proposed recovery procedure requiring approval.

Key fields:

- `id`
- `diagnosisId`
- `objective`
- `proposedChanges`
- `riskLevel`
- `validationPlan`
- `rollbackPlan`
- `status`
- `approvedBy`
- `approvedAt`

### Patch

The actual code changes produced in isolation.

Key fields:

- `id`
- `sessionId`
- `commitSha`
- `diffSummary`
- `changedFiles`
- `additions`
- `deletions`
- `unexpectedChanges`

### Verification report

Independent assessment of whether the recovery succeeded.

Key fields:

- `id`
- `sessionId`
- `status`
- `originalFailureResolved`
- `checks`
- `unexpectedChanges`
- `knownLimitations`
- `confidence`
- `completedAt`

### Pull-request package

The reviewable output prepared for GitHub.

Key fields:

- `id`
- `sessionId`
- `title`
- `body`
- `headBranch`
- `baseBranch`
- `githubUrl`
- `status`
- `rollbackInstructions`

---

## 5. Incident lifecycle

```text
DRAFT
  ↓
ADMITTED
  ↓
TRIAGING
  ↓
DIAGNOSING
  ↓
AWAITING_APPROVAL
  ↓
RECOVERING
  ↓
VERIFYING
  ↓
VERIFIED | PARTIALLY_VERIFIED | FAILED_VERIFICATION
  ↓
PR_PREPARED
  ↓
CLOSED
```

### Terminal states

- `CANCELLED`
- `UNREPRODUCIBLE`
- `UNSAFE_TO_CONTINUE`
- `FAILED`
- `CLOSED`

### State rules

- A session cannot enter `RECOVERING` without an approved treatment plan.
- A session cannot be marked `VERIFIED` unless the original failure is resolved and all required blocking checks pass.
- A pull-request package cannot be marked ready when unexpected changes remain unreviewed.
- Any secret exposure, unsafe command or sandbox-policy violation stops the session.

---

## 6. Severity model

### SEV-1 — Critical

Production outage, security-sensitive failure or repository-wide blocking condition.

### SEV-2 — High

Production build blocked, authentication broken or major user journey unavailable.

### SEV-3 — Moderate

Feature-level failure, failing integration test or degraded developer workflow.

### SEV-4 — Low

Non-blocking defect, stale test or low-impact configuration problem.

Severity can be suggested automatically but remains editable by the user.

---

## 7. Functional requirements

### FR-01: GitHub repository connection

The system shall allow a user to select an accessible GitHub repository and branch.

Acceptance criteria:

- repository metadata is displayed;
- default branch is identified;
- permissions are checked;
- private repository content is never exposed outside the authorised session;
- connection failure provides an actionable explanation.

### FR-02: Incident creation

The user shall be able to create an incident from manual input, a failing command or imported CI context.

Required input:

- repository;
- branch or commit;
- title;
- failure description;
- optional error log;
- optional failing command;
- optional expected behaviour.

### FR-03: Isolation

The system shall create a dedicated branch/worktree and Docker sandbox for each recovery session.

Acceptance criteria:

- default branch remains unchanged;
- sandbox filesystem is session-scoped;
- execution is time-limited;
- cleanup runs after completion or cancellation;
- base commit SHA is recorded.

### FR-04: Failure reproduction

CodeER shall attempt to reproduce the original failure before proposing a repair.

Outputs:

- command executed;
- exit code;
- relevant logs;
- environment summary;
- reproduction status;
- reason when reproduction is not possible.

### FR-05: Repository mapping

CodeER shall identify relevant repository structure without indiscriminately loading the entire repository into model context.

Mapping should include:

- workspace layout;
- package scripts;
- dependency manifests;
- framework configuration;
- CI configuration;
- entry points;
- affected routes, controllers, services or components;
- related tests;
- recent relevant changes when available.

### FR-06: Diagnosis

CodeER shall produce a root-cause report linked to evidence.

The report must include:

- root-cause summary;
- causal chain;
- affected files;
- evidence references;
- alternative hypotheses considered;
- confidence;
- limitations.

### FR-07: Treatment plan

CodeER shall prepare a proposed repair before modifying code.

The plan must include:

- objective;
- exact files likely to change;
- proposed change per file;
- risk level;
- validation commands;
- rollback strategy;
- expected result.

### FR-08: Human approval

The user shall be able to approve, request revision or reject a treatment plan.

No code modification begins before approval.

### FR-09: Controlled patching

The repair agent shall modify only files justified by the approved plan unless it pauses and requests a plan revision.

### FR-10: Diff review

The user shall be able to inspect all changed files, additions, deletions and reasons for change.

### FR-11: Independent verification

A verifier separate from the repair step shall evaluate the result.

Minimum checks:

- original failure comparison;
- dependency installation when required;
- lint;
- type checking;
- unit tests;
- relevant integration tests;
- production build;
- critical browser journey where available;
- unexpected-file detection.

Checks may be marked required, optional or unavailable.

### FR-12: Pull-request package

CodeER shall generate a pull-request title and body containing:

- incident summary;
- root cause;
- changes made;
- evidence;
- verification results;
- known limitations;
- risk;
- rollback instructions.

### FR-13: Case history

Completed and stopped sessions shall remain available as auditable case records.

### FR-14: Demo resilience

The interface shall support deterministic seeded demo data so the product story remains visible if a remote dependency is temporarily unavailable.

Seeded demo mode must be clearly labelled and must not pretend to be live execution.

---

## 8. Agent roles

### Triage Agent

Responsibilities:

- classify incident;
- suggest severity;
- normalise logs;
- identify initial reproduction command;
- define investigation scope.

Must not modify code.

### Repository Mapper

Responsibilities:

- map workspace and services;
- locate scripts and configuration;
- identify likely dependency paths;
- produce a repository context map.

Must not diagnose beyond evidence.

### Root Cause Investigator

Responsibilities:

- reproduce failure;
- test hypotheses;
- connect logs to code and configuration;
- produce diagnosis and confidence.

Must explicitly list alternative hypotheses.

### Repair Agent

Responsibilities:

- translate approved plan into minimal changes;
- generate or update relevant tests;
- explain every changed file.

Must not broaden scope silently.

### Security Reviewer

Responsibilities:

- inspect patch for secret exposure;
- identify unsafe shell or configuration changes;
- flag permission expansion;
- verify no security-sensitive guard was removed without approval.

### Verification Agent

Responsibilities:

- execute independent checks;
- compare pre- and post-repair evidence;
- detect unexpected changes;
- report verified, partial or failed status.

### Release Agent

Responsibilities:

- prepare branch and PR metadata;
- compile evidence summary;
- add rollback instructions;
- never merge automatically.

---

## 9. User experience specification

### Main navigation

- Command Center
- Active Incidents
- Repositories
- Recovery Sessions
- Verification
- Pull Requests
- Case History
- Settings

### Required screens

1. Landing page
2. Command center
3. Connect repository
4. New incident
5. Investigation workspace
6. Recovery plan
7. Code-diff review
8. Verification report
9. Pull-request preview
10. Case-history detail

### Investigation workspace

Three-column desktop layout:

- left: incident evidence;
- centre: response-team activity;
- right: stage, severity, confidence, affected files and controls.

On smaller screens, columns become ordered tabs without losing information.

### Repository health

Health is a composite score from:

- build health;
- test health;
- deployment readiness;
- dependency health;
- security indicators;
- API consistency;
- frontend functionality.

Every score dimension must expose evidence. Scores are not presented as objective truth when checks are incomplete.

---

## 10. Verification model

### Verification statuses

- `VERIFIED`
- `PARTIALLY_VERIFIED`
- `FAILED`
- `BLOCKED`
- `NOT_RUN`

### Required result contract

```json
{
  "status": "VERIFIED",
  "originalFailureResolved": true,
  "buildPassed": true,
  "testsPassed": true,
  "unexpectedChanges": [],
  "knownLimitations": [],
  "confidence": 0.94
}
```

### Verified criteria

A session is verified only when:

- the original failure is resolved;
- all required checks pass;
- no unreviewed unexpected changes exist;
- no policy violation remains;
- the result is tied to the exact patch commit.

### Partial verification

Use when the original failure is resolved but one or more non-blocking checks are unavailable. The UI must state precisely what was not verified.

---

## 11. Safety requirements

- Never push directly to the default branch.
- Never merge automatically.
- Redact access tokens, private keys, passwords and connection strings.
- Restrict network access by policy.
- Restrict shell commands and enforce timeouts.
- Run containers as non-root where practical.
- Cap CPU, memory and disk usage.
- Record command and exit code.
- Stop on policy violation.
- Require explicit approval for destructive or dependency-wide changes.
- Preserve a rollback path.

---

## 12. Non-functional requirements

### Reliability

- workflow state must survive frontend refresh;
- event ordering must be deterministic;
- cleanup jobs must be idempotent;
- repeated webhook delivery must not duplicate incidents.

### Performance

Hackathon targets:

- initial repository metadata: under 5 seconds after provider response;
- event stream latency: under 1 second under normal conditions;
- UI navigation response: under 200 ms for local interactions;
- demo verification: designed to complete within the video window.

### Observability

Every session should emit:

- structured logs;
- stage transitions;
- agent start/finish events;
- command execution metrics;
- sandbox resource metrics;
- failure reason;
- correlation identifiers.

### Privacy

- store only necessary repository data;
- redact secrets before persistence;
- define retention for logs and sandbox artifacts;
- allow session deletion;
- do not use private repository content for unrelated model training claims.

### Accessibility

Meet WCAG 2.2 AA for core workflows.

---

## 13. Demo repository specification

Recommended stack:

- Next.js frontend;
- NestJS backend;
- PostgreSQL;
- npm or pnpm workspace;
- Docker Compose;
- GitHub Actions;
- Playwright.

Required features:

- registration;
- login;
- profile management;
- team invitation;
- admin dashboard.

Intentional incidents:

1. missing `build:super` script;
2. incorrect authentication callback or environment variable;
3. frontend `/api/users/profile` versus backend `/api/v1/profile` mismatch;
4. profile-save button does not invoke mutation;
5. integration test expects stale login response.

Branches:

- `main` — stable reference;
- `demo/broken` — deterministic broken state;
- `demo/recovered` — expected verified state.

Each incident requires a private golden repair record containing root cause, expected patch, commands, final state and rollback.

---

## 14. Analytics and product signals

Track without storing sensitive code content:

- repositories connected;
- incidents created;
- reproduction success rate;
- diagnosis completion rate;
- plan approval rate;
- verification success rate;
- median session duration;
- unexpected-change frequency;
- pull-request package creation rate;
- session cancellation reasons.

For the hackathon, analytics may be local or mocked; they must not distract from the recovery workflow.

---

## 15. Acceptance test for the MVP

The MVP passes when a clean demo run can:

1. reset the demo repository in under one minute;
2. admit the broken branch;
3. reproduce the selected failure;
4. display evidence and a root cause;
5. generate an approval-ready treatment plan;
6. apply a meaningful code change in isolation;
7. show the complete diff;
8. run required verification;
9. produce no unexpected file changes;
10. prepare a reviewable PR package;
11. complete without manual code editing;
12. expose no credentials or private information.

---

## 16. Post-hackathon roadmap

### Phase 1

- more Node.js frameworks;
- GitHub App automation;
- richer CI log intake;
- reusable recovery policies;
- VS Code extension.

### Phase 2

- Python and Java ecosystems;
- continuous CI incident detection;
- team workspaces;
- policy packs;
- observability integrations.

### Phase 3

- enterprise controls;
- self-hosted runners;
- regional data residency;
- advanced security recovery;
- multi-provider repository support.

Automatic merging and production rollback remain opt-in future capabilities and require stronger governance than the Build Week MVP.
