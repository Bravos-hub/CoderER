# Codex Collaboration

CodeER uses Codex in two ways: as the engineering environment used to build and validate the repository, and as a product concept for controlled agentic recovery workflows.

## How Codex Accelerated Development

Codex helped inspect the existing repository, apply Sprint archives, identify regressions, restore cross-platform test behavior, wire database migrations, run gate suites, debug local Docker/PostgreSQL configuration, validate GitHub App configuration, publish a draft pull request, and create this submission evidence package.

Codex was especially useful where the task required moving across many files at once:

- comparing archive changes against existing repository behavior;
- finding removed `dotenv/config` imports that broke local scripts;
- restoring run-unique smoke-test fixtures;
- validating migration registration and forced RLS;
- diagnosing Windows symlink and `npm` executable differences;
- preparing PR #23 with a validation summary.

## Human Decisions

Human decisions remained explicit:

- the product positioning and Developer Tools track;
- the Build Week scope and internal deadline;
- the decision to keep publication human-approved and draft-only;
- the decision not to close Issue #22 until real GitHub App and webhook gates pass;
- GitHub App settings, private key handling, and webhook proxy selection;
- final submission content, demo story, and judging priorities.

## Review And Verification

Codex-generated changes were not accepted as sufficient by themselves. They were checked with:

- linting, type checking, unit tests, and production build;
- Prisma generation and validation;
- database migration and role-boundary verification;
- incident, investigation, sandbox, and recovery integration smoke tests;
- secret scanning, dependency audit threshold, and SBOM generation;
- manual inspection of PR scope before pushing.

## Primary Session Requirement

The Devpost submission requires a `/feedback` Codex Session ID for the project thread where the majority of core functionality was built.

Submission-only value:

```text
TODO: record primary /feedback Codex Session ID in the private Devpost draft.
```

Do not rely on scattered support sessions as the main evidence trail.
