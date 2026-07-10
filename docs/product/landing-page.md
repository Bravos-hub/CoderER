# CodeER Landing Page Specification

## Goal

Explain CodeER's value before asking visitors to understand its architecture. A first-time visitor should understand the problem, the Codex-powered recovery workflow, the safety model, and the primary action without needing to read technical documentation.

## Navigation

```text
CodeER | How It Works | Recovery Workflow | Safety | Demo | GitHub
```

Primary action: **Admit Repository**  
Secondary action: **Watch Recovery**

## Hero section

### Headline

**Emergency response for broken software.**

### Supporting copy

CodeER uses Codex to reproduce repository failures, diagnose root causes, apply controlled repairs, and independently verify recovery before preparing a reviewable pull request.

### Primary actions

- Admit Repository
- Watch Recovery

### Hero incident panel

```text
INCIDENT #ER-2048

Repository    commerce-platform
Severity      SEV-2
Failure       Production build blocked
Status        Root cause identified
Confidence    94%
```

Supporting actions:

- View evidence
- Review treatment plan

## Trust strip

```text
Reproduced failures | Isolated worktrees | Controlled patches |
Independent verification | Human-approved pull requests
```

## Problem section

### Heading

**Finding the error is often harder than fixing it.**

### Current fragmented workflow

```text
CI logs -> local reproduction -> dependency tracing -> code inspection ->
patching -> testing -> pull request
```

### CodeER workflow

```text
One incident -> one evidence trail -> one verified recovery
```

## Recovery workflow section

Use five visible stages:

```text
ADMIT -> TRIAGE -> DIAGNOSE -> RECOVER -> VERIFY
```

### Admit

Connect a repository or select a failing workflow.

### Triage

Classify severity, affected systems, and likely impact.

### Diagnose

Reproduce the failure and collect evidence from code, logs, configuration, and tests.

### Recover

Create and apply the smallest safe patch in isolation.

### Verify

Rerun the original failure, builds, tests, and critical user journeys.

## Response-team section

Present the specialized agents as the **CodeER Response Team**:

- Triage Agent
- Repository Mapper
- Root Cause Investigator
- Repair Agent
- Security Reviewer
- Verification Agent
- Release Agent

The interface should show their activity as an orchestrated timeline rather than hiding all work behind a single chat box.

## Safety section

### Heading

**Autonomous investigation. Controlled recovery.**

### Guarantees

- No direct push to `main`
- Repository secrets are never printed in agent output
- Every changed file is reviewable
- Every fix includes verification evidence
- Every recovery includes rollback guidance
- Pull requests require human review

## Product evidence section

Show a concise before-and-after comparison:

| Check | Before | After |
|---|---:|---:|
| Production build | Failed | Passed |
| Unit tests | 11/14 | 14/14 |
| Authentication journey | Failed | Passed |
| API contracts | 2 mismatches | Aligned |
| Repository health | 46/100 | 91/100 |

## Final call to action

### Heading

**Your repository has an emergency response team.**

Primary button: **Start a Recovery**

## Responsive behavior

### Desktop

- Split hero layout with copy and incident panel
- Horizontal workflow timeline
- Multi-column safety and agent sections

### Tablet

- Two-column hero where space allows
- Scrollable workflow steps
- Two-column cards

### Mobile

- Single-column hero
- Sticky primary action
- Stacked workflow
- Collapsible technical evidence
- Minimum 44px touch targets

## Completion criteria

The landing page is ready when:

- The problem is clear above the fold.
- Codex's role is explicit.
- The recovery workflow is visible without reading documentation.
- The primary action is accessible on desktop and mobile.
- The page contains no placeholder copy.
- Safety and human control are clearly explained.
- The live demo can continue if the marketing backend is unavailable.
