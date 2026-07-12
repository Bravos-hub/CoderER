# CodeER Product Positioning

## Product name

**CodeER** — pronounced **Code E-R**.

The name combines software engineering with the emergency-room model: a controlled response system for unhealthy repositories.

## Primary descriptor

**AI Software Emergency Response**

## Primary tagline

**Emergency response for broken software.**

## Supporting tagline

**From failing build to verified recovery.**

## One-sentence positioning

CodeER is an AI software emergency-response platform that uses Codex to reproduce repository failures, diagnose root causes, implement controlled repairs, independently verify recovery, and prepare reviewable pull requests.

## Target user

The first release targets software developers and small engineering teams working with:

- Broken builds and deployments
- CI/CD workflow failures
- Authentication and environment configuration problems
- Frontend/backend contract mismatches
- Non-functional user-interface features
- Failing tests and dependency regressions

## Core problem

Software failures are rarely isolated to one file. A failed deployment may involve package scripts, environment variables, authentication callbacks, API contracts, dependencies, infrastructure, and tests. Developers spend significant time reproducing the problem before they can safely fix it.

## Core solution

CodeER coordinates specialized Codex-powered agents that:

1. Reproduce or clearly identify the failure.
2. Map the affected repository area.
3. Gather evidence and determine the root cause.
4. Propose the smallest safe repair.
5. Apply the repair in an isolated environment.
6. Independently verify the result.
7. Prepare an evidence-backed pull request.

## Product principles

### Evidence before action

CodeER must reproduce or identify the incident before proposing a patch.

### Isolation before modification

Code changes happen in an isolated branch, worktree, or container.

### Verification before approval

The repair agent does not approve its own work. A separate verification process reruns the relevant checks.

### Human control before merge

CodeER prepares reviewable changes. It does not silently merge into protected branches.

## Product language

| Conventional term     | CodeER term       |
| --------------------- | ----------------- |
| Repository onboarding | Admit repository  |
| Error or outage       | Incident          |
| Priority              | Triage level      |
| Analysis              | Diagnosis         |
| Proposed fix          | Treatment plan    |
| Applied patch         | Procedure         |
| Verification run      | Recovery checks   |
| Successful repair     | Stabilized        |
| Pull request package  | Discharge package |
| Previous run          | Case history      |

Technical logs, filenames, commands, and test output must remain precise and should not be replaced with metaphorical language.

## Brand personality

CodeER should feel:

- Calm under pressure
- Precise
- Intelligent
- Urgent without being alarmist
- Transparent
- Trustworthy
- Technically advanced

CodeER should not feel:

- Like a generic chatbot
- Cartoonish or playful
- Like a hospital-management platform
- Like an uncontrolled autonomous code generator

## Positioning test

A new visitor should understand within ten seconds:

1. CodeER repairs unhealthy repositories.
2. Codex performs the investigation and engineering work.
3. Repairs happen in isolation.
4. Verification is independent.
5. The user receives a reviewable pull request.
