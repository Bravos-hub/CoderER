# CodeER Demo Video Plan

## Objective

Demonstrate one complete repository recovery story clearly and credibly. The video should prove that CodeER reproduces a failure, gathers evidence, uses Codex to implement a controlled repair, independently verifies the result, and prepares a reviewable pull request.

## Recommended duration

Prepare a polished three-minute master version. Adapt the final length when the official Build Week rules are published.

## Storyboard

### 0:00–0:15 — Hook

Show a failing repository and the CodeER incident screen.

Suggested narration:

> A production build has failed, authentication is broken, and the team does not know which change caused it. CodeER gives the repository an AI emergency-response team.

### 0:15–0:35 — Product promise

Show the landing page and the five-stage workflow.

Suggested narration:

> Powered by Codex, CodeER reproduces the failure, gathers evidence, diagnoses the root cause, implements a controlled repair, and independently verifies the result.

### 0:35–1:00 — Admit and triage

Show:

- Repository selection
- Failing workflow import
- Incident severity
- Repository health
- Start Recovery action

Suggested narration:

> We admit the repository, classify the deployment failure as SEV-2, and start an isolated recovery session.

### 1:00–1:35 — Investigation

Show:

- Logs streaming
- Repository map
- Relevant files
- Root-cause evidence
- Agent timeline

Suggested narration:

> The Response Team reproduces the failure, maps the monorepo, traces the build command, and identifies the missing workspace script with evidence from the workflow and package configuration.

### 1:35–2:05 — Controlled repair

Show:

- Treatment plan
- Validation plan
- User approval
- Worktree or sandbox
- Patch generation
- Changed-file review

Suggested narration:

> CodeER proposes the smallest safe repair, explains every affected file, defines the verification commands, and waits for approval before applying the patch in isolation.

### 2:05–2:35 — Independent verification

Show:

```text
Original failure: Resolved
Production build: Passed
Type check: Passed
Tests: 14/14 passed
Authentication journey: Passed
Unexpected changes: None
```

Suggested narration:

> A separate Verification Agent reruns the original failure, production build, tests, and critical user journey. The Repair Agent cannot approve its own work.

### 2:35–2:50 — Pull-request package

Show:

- Pull-request title
- Root-cause summary
- Changed files
- Evidence
- Rollback guidance

Suggested narration:

> CodeER prepares an evidence-backed pull request with the diagnosis, repair, verification results, risks, and rollback instructions.

### 2:50–3:00 — Closing

Show repository health improving from critical to stable.

Suggested narration:

> CodeER turns a broken repository into a verified recovery. From failing build to verified recovery.

## Recording requirements

- Use only synthetic repository and account data.
- Hide personal GitHub information and tokens.
- Increase interface zoom for readability.
- Disable desktop notifications.
- Use a predictable demo reset script.
- Add captions.
- Avoid long periods of waiting on commands.
- Keep the cursor movement deliberate.
- Show real product output instead of static mockups where possible.
- Record a clean backup take.

## Demo reliability plan

Before recording:

1. Reset the demo repository.
2. Confirm the expected workflow failure.
3. Clear prior recovery sessions.
4. Confirm the sandbox image is available.
5. Seed the synthetic database.
6. Run the complete recovery once.
7. Confirm the verification suite passes.
8. Confirm the pull-request preview is generated.

## Visual priorities

The video must clearly show:

- The original failure
- Evidence collection
- Multiple agent activities
- Human approval
- The actual code diff
- Independent verification
- The final pull-request package

Avoid spending too much time on authentication, settings, or repository connection screens.

## Backup plan

Prepare:

- A locally recorded terminal sequence
- Seeded investigation events
- A pre-created recovery session
- A pre-generated pull-request preview
- A second video export

Backup assets must represent a real successful run and should not misrepresent capabilities.
