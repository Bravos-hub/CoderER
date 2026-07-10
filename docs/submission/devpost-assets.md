# CodeER Devpost Submission Assets

## Project identity

### Project title

**CodeER — AI Emergency Response for Broken Software**

### Tagline

**From failing build to verified recovery.**

### Short description

CodeER uses Codex to reproduce repository failures, diagnose root causes, implement controlled repairs, and independently verify recovery before preparing a reviewable pull request.

## Required asset package

```text
submission/
├── project-title.txt
├── tagline.txt
├── short-description.md
├── full-project-story.md
├── technologies.md
├── challenges.md
├── accomplishments.md
├── lessons-learned.md
├── whats-next.md
├── repository-link.txt
├── live-demo-link.txt
├── screenshots/
├── architecture/
├── logo/
└── video/
```

## Gallery cover

Recommended content:

```text
CodeER
Emergency response for broken software
Repository health: 46 -> 91
Powered by Codex
```

Design requirements:

- 16:9 composition
- Dark navy background
- CodeER icon and wordmark
- Clear red-orange `ER`
- One visible recovery metric
- Keep important content centered for platform cropping
- Avoid small body copy

## Screenshot set

Prepare at least six polished screenshots.

### 1. Landing-page hero

Show the product promise and an active incident panel.

### 2. Critical repository incident

Show severity, original failure, and repository health.

### 3. Agent investigation timeline

Show multiple Codex-powered agents working across the repository.

### 4. Root-cause evidence

Show the failing command, relevant logs, file references, and diagnosis confidence.

### 5. Controlled repair

Show the treatment plan and code-diff review.

### 6. Verification report

Show the original failure resolved, builds and tests passing, and no unexpected changes.

### 7. Pull-request preview

Optional but recommended. Show the evidence-backed pull-request package.

## Architecture asset

The architecture diagram should show:

- GitHub repository
- Repository service
- Isolated Docker sandbox
- Incident orchestrator
- Codex Response Team
- Evidence store
- Independent verification engine
- Pull-request generator
- Human approval

## Technology list

Expected technologies for the MVP:

- OpenAI Codex
- OpenAI API, where required by final implementation
- Next.js
- TypeScript
- NestJS or a Node.js API service
- PostgreSQL
- Docker
- Git and Git worktrees
- GitHub API or GitHub App
- Playwright
- pnpm
- Mermaid

The final list must contain only technologies actually used.

## Submission quality checklist

- Project title matches the CodeER brand.
- Codex usage is described specifically.
- Every screenshot contains real product output.
- Architecture is readable at gallery size.
- Repository and demo links are publicly accessible where required.
- No credentials or private repository details appear.
- The submission explains independent verification.
- The story identifies limitations honestly.
- All official rules are checked when published.

## Rules-adaptation checklist

When the Build Week rules become available, verify:

- Eligibility and country restrictions
- Team-size limits
- Required OpenAI technology
- New-work or pre-existing-work requirements
- Public repository requirements
- Video duration and hosting requirements
- Submission deadline and timezone
- Category selection
- Intellectual-property terms
- Judging criteria
- Required disclosures

Do not finalize the asset package until these requirements have been reviewed.
