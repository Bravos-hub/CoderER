# CodeER Build Week Execution Plan

## Event window

OpenAI Build Week: **13–21 July 2026**

The rules and judging criteria should be reviewed as soon as they are published. This plan is intentionally adaptable.

## Launch sequence

```text
Positioning lock
      ↓
Logo and icon system
      ↓
Color and typography system
      ↓
Landing-page design
      ↓
Command-center dashboard
      ↓
Demo repository
      ↓
Recovery workflow
      ↓
Devpost assets
      ↓
Demo video
      ↓
Submission story
```

## 10 July — Positioning and brand lock

Deliver:

- Final product positioning
- Primary target user
- Core problem and solution
- Product principles
- Product vocabulary
- Final tagline
- Logo concept

Exit criteria:

- A new visitor understands CodeER in ten seconds.
- The product is clearly differentiated from a generic coding assistant.
- The role of Codex is explicit.

## 11 July — Identity system

Deliver:

- Final logo and icon
- Compact and monochrome variants
- Favicon and repository avatar
- Color tokens
- Typography rules
- Logo usage guidelines
- Devpost cover direction

Exit criteria:

- The icon remains recognizable at 16x16.
- Dark and light variants are available.
- UI tokens can be used directly in the application.

## 12 July — Product design and preparation

Deliver:

- Landing-page design
- Command-center design
- Incident workspace
- Treatment-plan screen
- Diff-review screen
- Verification report
- Pull-request preview
- Architecture diagram
- Demo repository specification

Exit criteria:

- One complete user journey is designed.
- All critical states have loading, empty, error, and success behavior.
- The demo repository incidents are documented.

## 13 July — Rules review and scope lock

Tasks:

- Review eligibility
- Confirm team-size requirements
- Confirm required OpenAI technologies
- Confirm whether pre-existing work is allowed
- Confirm repository visibility requirements
- Confirm video duration
- Confirm submission deadline and timezone
- Confirm categories and judging criteria
- Adjust the MVP only where required

Exit criteria:

- A rules-compliance checklist is complete.
- The technical scope is frozen.
- Deferred features are explicitly listed.

## 14 July — Repository intake and sandbox

Build:

- GitHub repository connection
- Repository clone
- Branch or worktree creation
- Docker sandbox creation
- Command execution policy
- Log streaming
- Session cleanup

Exit criteria:

- A selected repository can be cloned and inspected safely.
- Commands run in isolation.
- Logs stream to the dashboard.

## 15 July — Triage and diagnosis

Build:

- Incident creation
- Severity classification
- Failure reproduction
- Repository mapping
- Relevant-file discovery
- Root-cause report
- Evidence display

Exit criteria:

- The demo build failure is reproducible.
- The diagnosis references real commands and files.
- Uncertainty is shown honestly.

## 16 July — Recovery workflow

Build:

- Treatment-plan generation
- Risk and blast-radius summary
- Human approval gate
- Controlled patch application
- Changed-file viewer
- Rollback-plan generation

Exit criteria:

- No code changes occur before approval.
- The patch is isolated from `main`.
- Every changed file has an explanation.

## 17 July — Independent verification

Build:

- Original-failure rerun
- Production build check
- Lint and type checking
- Unit and integration tests
- Critical Playwright journey
- Unexpected-file detection
- Verification report

Exit criteria:

- The Repair Agent cannot mark its own work verified.
- Missing checks appear as incomplete.
- The demo recovery reaches a reliable passing state.

## 18 July — Pull-request package

Build:

- Pull-request title and summary
- Root-cause section
- Changed-file section
- Verification evidence
- Risk and limitations
- Rollback guidance
- GitHub pull-request integration or preview
- Case-history record

Exit criteria:

- The result is understandable without reading raw logs.
- The user can review the exact diff.
- The package includes limitations and rollback guidance.

## 19 July — Product polish

Complete:

- Responsive layout
- Empty states
- Error states
- Loading states
- Accessibility checks
- Keyboard navigation
- Stable demo data
- Reset script
- Performance improvements
- Brand consistency

Exit criteria:

- The demo works on the target recording machine.
- The interface is readable at presentation zoom.
- The full run can be repeated reliably.

## 20 July — Submission production

Complete:

- Devpost screenshots
- Architecture image
- Logo exports
- README cleanup
- Repository cleanup
- Secret scan
- Demo-video recording
- Captions
- Video upload
- Submission text
- Technology list

Exit criteria:

- All public links work.
- The video is playable without authentication.
- Screenshots show real output.
- The repository contains no secrets.

## 21 July — Final review and submission

Run:

- Rules-compliance review
- End-to-end demo rehearsal
- Broken-link check
- Public-access check
- Video playback check
- Repository-secret scan
- Submission proofreading
- Final submission

Do not wait until the final minutes to submit. Keep a local copy of every submission field.

## Workstream ownership

### Brand and product

- Positioning
- Logo
- Design system
- UX copy
- Screenshots

### Frontend

- Landing page
- Command Center
- Incident workspace
- Diff and verification views

### Backend

- Incident orchestration
- Evidence storage
- GitHub integration
- Session state

### Agent and sandbox

- Codex integration
- Repository mapping
- Diagnosis
- Repair
- Docker execution
- Safety policies

### Demo and submission

- Demo repository
- Seed data
- Reset scripts
- Video
- Devpost story

## Final launch gates

### Brand gate

- Logo approved
- Icon readable at 16x16
- Color and typography tokens defined
- Tagline fixed
- Positioning understandable in ten seconds

### Product gate

- One complete recovery journey works
- Original failure is visibly reproduced
- Patch is isolated and reviewable
- Verification is independent
- The final pull-request package is generated

### Demo gate

- Demo repository resets reliably
- Full demonstration completes without manual code edits
- No personal data or secrets appear
- A backup recording and recovery session exist

### Submission gate

- Official rules are satisfied
- Project story is complete
- Codex usage is specific
- Video is public and playable
- Screenshots are readable
- Repository is accessible where required
