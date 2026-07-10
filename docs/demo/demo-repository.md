# CodeER Demo Repository Specification

## Objective

Create a controlled, believable repository that consistently demonstrates CodeER's complete recovery workflow. The demo must fail predictably, reset quickly, contain no real secrets, and produce meaningful repairs.

## Recommended stack

- Next.js frontend
- NestJS backend
- PostgreSQL
- GitHub Actions
- Docker Compose
- Playwright
- pnpm workspace

## Demo application

The demo application is a small team account-management platform with:

- User registration
- Login
- Profile management
- Team invitation
- Admin dashboard
- Basic audit history

## Repository structure

```text
demo-repository/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── contracts/
│   ├── config/
│   └── test-utils/
├── tests/
│   ├── integration/
│   └── e2e/
├── .github/
│   └── workflows/
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## Intentional incidents

### Incident 1 — Missing build script

The deployment workflow invokes a script that is not available in one workspace.

Expected failure:

```text
npm error Missing script: "build:super"
```

Expected diagnosis:

- The root workflow invokes `build:super`.
- The target workspace does not define the script.
- The production build cannot start.

Verification:

- Workspace build command passes.
- Root build command passes.
- CI workflow reaches the test stage.

### Incident 2 — Authentication callback mismatch

The frontend uses the wrong callback URL or environment-variable name.

Expected symptoms:

- Login begins successfully.
- The provider redirects to an invalid route.
- The application does not establish a session.

Verification:

- Login callback returns to the expected route.
- Session endpoint responds successfully.
- Playwright login journey passes.

### Incident 3 — Frontend/backend API mismatch

Frontend calls:

```text
/api/users/profile
```

Backend exposes:

```text
/api/v1/profile
```

Expected symptoms:

- Profile screen loads.
- Profile request returns 404.
- Save action cannot complete.

Verification:

- Frontend uses the shared contract or correct endpoint.
- API integration test passes.
- Profile update journey passes.

### Incident 4 — Non-functional profile button

The Save button renders but does not invoke the update mutation.

Expected diagnosis:

- The form has valid state.
- The button lacks the intended submit handler or is outside the form.
- No request is sent.

Verification:

- Clicking Save sends one valid request.
- Loading and error states render correctly.
- Updated data persists after reload.

### Incident 5 — Outdated integration test

The login test expects an old response shape.

Expected symptoms:

- API behavior is correct.
- Test fails because the contract has changed.

Verification:

- Shared contract is updated or test expectation is corrected.
- No production behavior is weakened to satisfy the test.
- Full test suite passes.

## Golden recovery records

For every incident, maintain an internal reference containing:

- Known root cause
- Expected files involved
- Acceptable patch shape
- Commands required for verification
- Passing final state
- Rollback strategy

The public demo should not simply replay a fixed response. The golden record exists to make testing and judging rehearsals reliable.

## Branch strategy

```text
main             Stable reference
scenario/broken  Intentionally broken state
scenario/fixed   Verified reference state
```

For repeatable demos, provide a reset script that recreates the broken branch or checks out a known commit.

## Seed data

Use synthetic users and teams only. Suggested data:

- Developer account
- Team administrator account
- Two sample teams
- Sample audit events

No production credentials, personal email addresses, or private organization information may be included.

## Performance target

The complete demonstration should fit comfortably inside a three-minute video. Long operations may be accelerated in the recording, but the underlying workflow must remain functional.

Recommended targets:

- Repository clone: under 15 seconds
- Failure reproduction: under 30 seconds
- Diagnosis: under 45 seconds
- Repair: under 45 seconds
- Verification: under 60 seconds

## Completion criteria

The demo repository is ready when:

- Each incident fails predictably.
- The repository resets in under one minute.
- Setup requires one documented command.
- The project contains no real credentials.
- The repair changes real behavior.
- Verification finishes reliably.
- The final repository state remains deployable.
