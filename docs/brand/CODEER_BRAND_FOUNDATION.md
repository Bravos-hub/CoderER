# CodeER Brand Foundation

**Version:** 1.0  
**Status:** Locked for Build Week implementation  
**Owner:** CodeER product team  
**Applies to:** Product UI, website, documentation, Devpost assets, GitHub, demo video, presentations and future extensions

---

## 1. Purpose

This document is the master source of truth for how CodeER is positioned, named, presented, written and visually implemented. Every product surface must derive from this foundation. Focused documents may expand individual topics, but they must not contradict this file.

CodeER must always feel like a calm, evidence-driven software emergency-response system. It must never look or sound like an unconstrained AI coding toy, a generic chatbot or an automatic code-merging service.

---

## 2. Brand core

### Product name

**CodeER**

Pronunciation: **Code E-R**.

The capitalised `ER` is intentional. It connects software recovery with emergency response while preserving the word `Code` as the product domain.

### Primary tagline

> **Emergency response for broken software.**

### Brand promise

> **From failing build to verified recovery.**

### One-sentence description

> CodeER is an AI software emergency-response platform that uses Codex to reproduce repository failures, diagnose root causes, implement controlled repairs, independently verify recovery and prepare reviewable pull requests.

### Category

**Evidence-driven software recovery system**

### Primary audience

Software developers and small engineering teams dealing with:

- broken builds;
- failed CI pipelines;
- deployment-blocking configuration errors;
- frontend/backend contract mismatches;
- authentication failures;
- non-functional user-interface actions;
- stale tests;
- risky or unverified AI-generated patches.

### Initial market boundary

The Build Week MVP is not positioned for every language, every incident type or every enterprise workflow. It focuses on GitHub-hosted React/Next.js and Node.js repositories using npm or pnpm and Docker-based isolation.

---

## 3. Problem and solution

### Problem statement

Software recovery is fragmented. Developers inspect logs, reproduce failures, map dependencies, compare contracts, inspect code, apply changes, rerun checks and prepare pull requests across multiple tools. The process is repetitive, difficult to audit and often poorly verified.

AI coding tools can accelerate patch creation, but code generation alone does not prove that the original failure was reproduced, the root cause was correctly identified, the repair was narrowly scoped or the final repository is safe.

### Solution statement

CodeER coordinates specialised Codex-powered agents inside a constrained recovery workflow. It gathers evidence, reproduces the incident, maps relevant repository context, proposes the smallest safe repair, applies the patch in isolation, runs independent verification and prepares a reviewable pull-request package for human approval.

### Outcome delivered to the user

A CodeER recovery session should end with:

1. the original failure and reproduction evidence;
2. a root-cause report;
3. a treatment plan;
4. an isolated, reviewable patch;
5. a verification report;
6. known risks and limitations;
7. rollback instructions;
8. a pull-request-ready summary.

---

## 4. Operating principles

### Evidence before action

No repair should be proposed until CodeER has either reproduced the failure or clearly documented why reproduction is impossible and what evidence supports the diagnosis.

### Isolation before modification

All changes occur in an isolated branch, worktree or sandbox. CodeER never modifies the protected default branch directly.

### Verification before approval

The original failure, relevant checks and expected user behaviour must be evaluated after the repair.

### Human control before merge

CodeER may prepare a pull request, but the developer remains responsible for approval and merge.

### Minimal safe repair

Prefer the smallest change that resolves the proven root cause. Avoid unrelated refactoring, broad dependency upgrades and style-only changes during incident recovery.

### Security by default

Secrets must be redacted, shell access constrained, commands allow-listed or policy-checked, sandboxes time-limited and logs filtered before display.

### Transparent uncertainty

Confidence must be communicated honestly. Unsupported certainty is prohibited.

---

## 5. Brand personality

CodeER should feel:

- calm under pressure;
- technically precise;
- clinical without feeling cold;
- transparent;
- competent;
- controlled;
- trustworthy;
- evidence-led;
- developer-respectful.

CodeER must never feel:

- chaotic;
- playful during critical incidents;
- aggressively red;
- magical or unexplained;
- overconfident;
- surveillance-oriented;
- like a replacement for engineers;
- like a chat interface disguised as a platform.

---

## 6. Messaging hierarchy

### Level 1: Immediate value

**Emergency response for broken software.**

### Level 2: Product promise

**From failing build to verified recovery.**

### Level 3: Functional explanation

CodeER reproduces failures, diagnoses root causes, applies controlled repairs and independently verifies recovery before preparing a reviewable pull request.

### Level 4: Technical proof

- GitHub repository intake;
- isolated worktrees and Docker sandboxes;
- Codex-powered repository investigation;
- specialised agent orchestration;
- evidence capture;
- verification engine;
- pull-request package generation.

---

## 7. Vocabulary

### Preferred words

- incident
- admit repository
- triage
- evidence
- reproduce
- diagnose
- root cause
- treatment plan
- controlled repair
- isolated recovery
- verification
- recovery session
- repository health
- confidence
- reviewable patch
- rollback
- approval
- case history
- response team

### Words to avoid

- magic
- instant fix
- perfect
- guaranteed
- autonomous merge
- replace developers
- one-click production repair
- self-healing everything
- AI wizard
- bot
- chatbot
- generate code for you

### Naming rules

- Use **incident**, not task, for a repository failure under investigation.
- Use **recovery session**, not chat session.
- Use **treatment plan**, not generic suggestion.
- Use **verification report**, not success message.
- Use **response agent**, not bot.
- Use **approve procedure**, not run AI.

---

## 8. Voice and tone

### General voice

Direct, calm, concise and evidence-based. Explain what happened, what is known, what remains uncertain and what action is available.

### During investigation

Use neutral active language:

- “Reproducing the production build failure.”
- “Mapping workspace scripts and deployment configuration.”
- “Three candidate causes remain.”

Avoid dramatic language:

- “Critical disaster detected!”
- “AI is fixing everything.”

### During failure

State facts first:

> Verification stopped because the integration test environment could not reach PostgreSQL. The patch has not been marked as verified.

### During success

Success must describe evidence:

> Recovery verified. The original build failure is resolved, the production build passes and no unexpected files changed.

### Confidence language

- 90–100%: High confidence
- 70–89%: Moderate confidence
- 50–69%: Limited confidence
- below 50%: Insufficient confidence

Confidence must always be paired with evidence and limitations.

---

## 9. Logo system

### Approved symbol

A geometric `C` forms a protective enclosure. A pulse line crosses the centre and terminates in a code cursor.

### Symbol meanings

- `C`: CodeER and codebase;
- enclosure: controlled isolation;
- pulse: active diagnosis and health;
- cursor: executable engineering action;
- open edge: movement from incident to recovery;
- red-orange: urgency without panic.

### Wordmark

- `Code`: neutral white on dark surfaces, dark navy on light surfaces;
- `ER`: emergency red-orange;
- descriptor: `AI SOFTWARE EMERGENCY RESPONSE` in uppercase with generous tracking.

### Required variants

1. Primary horizontal lockup with descriptor
2. Compact horizontal lockup
3. Icon-only
4. Monochrome
5. Dark-background version
6. Light-background version
7. Simplified favicon

### Minimum-size behaviour

At 16 px and 32 px:

- remove descriptor;
- remove glow and shadows;
- use one clear pulse peak;
- increase stroke thickness;
- preserve the open edge of the `C`;
- preserve cursor visibility;
- remove tiny internal gaps.

### Clear space

Use clear space equal to at least one pulse-stroke thickness around icon-only assets and one cap-height of the `C` around horizontal lockups.

### Prohibited usage

Do not:

- recolour `ER` with green or blue;
- stretch or skew the logo;
- place the full descriptor below 160 px width;
- add uncontrolled glow;
- place the mark on low-contrast photography;
- close the open edge of the `C`;
- replace the cursor with a generic arrow.

---

## 10. Colour system

### Core dark surfaces

| Token | Value | Purpose |
|---|---:|---|
| `background.primary` | `#071018` | Application and website base |
| `background.secondary` | `#0C1722` | Secondary page regions |
| `surface.primary` | `#101E2A` | Cards and panels |
| `surface.elevated` | `#152735` | Modals, floating panels |
| `surface.hover` | `#1A3040` | Hover and selected surfaces |
| `terminal.background` | `#050A0F` | Logs and terminal output |

### Borders

| Token | Value |
|---|---:|
| `border.subtle` | `#203544` |
| `border.strong` | `#315064` |
| `border.focus` | `#4BA8FF` |

### Text

| Token | Value |
|---|---:|
| `text.primary` | `#F5F7FA` |
| `text.secondary` | `#A2B2BF` |
| `text.muted` | `#708593` |
| `text.inverse` | `#071018` |

### Brand and status

| Token | Value | Meaning |
|---|---:|---|
| `brand.primary` | `#FF4D35` | CodeER ER mark, primary critical emphasis |
| `brand.hover` | `#FF654F` | Hover |
| `brand.active` | `#D93624` | Pressed/active |
| `status.critical` | `#FF4D35` | SEV-1 and active blocking failures |
| `status.warning` | `#FFB547` | Degraded or incomplete |
| `status.investigating` | `#4BA8FF` | Mapping, evidence collection |
| `status.recovering` | `#9A87FF` | Codex orchestration and repair activity |
| `status.stable` | `#2BD584` | Passing verification and recovered state |

### Colour behaviour

Red-orange is reserved for critical states, destructive actions and the `ER` wordmark. It is not the default card, border or button colour.

Blue communicates investigation and active evidence gathering. Violet is used sparingly for Codex orchestration. Green communicates verified outcomes only.

---

## 11. Typography

### Families

- **Space Grotesk** — display headings, major page titles, health scores
- **Inter** — interface, body, forms, tables and navigation
- **JetBrains Mono** — logs, code, commands, filenames, diffs and agent events

### Scale

| Token | Size | Suggested line height |
|---|---:|---:|
| `text.xs` | 12 px | 16 px |
| `text.sm` | 14 px | 20 px |
| `text.base` | 16 px | 24 px |
| `text.lg` | 18 px | 28 px |
| `text.xl` | 22 px | 30 px |
| `text.2xl` | 28 px | 36 px |
| `text.3xl` | 36 px | 44 px |
| `text.4xl` | 48 px | 56 px |
| `text.display` | 64 px | 68 px |

### Weight rules

- 400: body and descriptions
- 500: labels and controls
- 600: card titles and section headings
- 700: hero and major metrics

Avoid excessive bold text in logs and evidence-heavy screens.

---

## 12. Spacing, radius and elevation

Use a 4 px base grid.

### Spacing scale

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`

### Radius

- small: 6 px
- medium: 10 px
- large: 14 px
- extra large: 20 px

### Elevation

Prefer borders and surface contrast over heavy shadows. Elevated overlays may use a restrained shadow with low opacity. Terminal, evidence and diff panels should appear precise and flat.

---

## 13. Interface design principles

1. Evidence must be visible, not hidden behind decorative summaries.
2. Every health score must link to supporting checks.
3. Every agent event must include actor, timestamp, action and result.
4. Every repair must show affected files and risk.
5. Every verification outcome must show command, duration and result.
6. Critical actions require explicit confirmation.
7. No direct push to `main` may be presented as normal behaviour.
8. Empty, loading, degraded and failure states are first-class designs.
9. The application must remain usable without animation.
10. The dashboard must not resemble a generic chat application.

---

## 14. Core components

### Severity badge

Displays `SEV-1` through `SEV-4`, label and semantic colour. Never rely on colour alone.

### Confidence indicator

Displays percentage, label, evidence count and explanation tooltip.

### Evidence card

Contains source, timestamp, command or file, observed result, relevance and optional redaction notice.

### Agent timeline

Shows ordered events with agent name, stage, timestamp, status and expandable evidence.

### Recovery-stage tracker

`ADMIT → TRIAGE → DIAGNOSE → RECOVER → VERIFY`

The current stage is visually distinct, completed stages show evidence counts and blocked stages explain why.

### Verification check

Contains check name, command, status, duration, output excerpt and linked logs.

### Diff viewer

Must show file path, additions, deletions, syntax-aware diff and reason for change.

### Approval panel

Includes treatment summary, risk, affected files, verification plan and explicit actions: approve, request revision or reject.

---

## 15. Motion

Motion communicates state, never decoration.

- hover: 120–160 ms
- panel transition: 180–220 ms
- progress change: 220–300 ms
- incident pulse: subtle, no faster than 1.5 seconds
- success transition: one restrained confirmation animation

Respect `prefers-reduced-motion`. No critical information may exist only in animation.

---

## 16. Accessibility

- Meet WCAG 2.2 AA for text and controls.
- Provide visible keyboard focus.
- Use text labels with status colours.
- Ensure terminal and diff views support screen-reader summaries.
- Provide reduced-motion alternatives.
- Use minimum 44 px touch targets on mobile.
- Do not expose secrets in accessible names or copied text.
- Preserve logical heading structure.

---

## 17. Asset specification

The canonical export package must include:

```text
brand/
└── logo/
    ├── svg/
    ├── png/
    └── favicon/
```

Required outputs include primary and compact SVGs, icon, monochrome mark, 2048 and 1024 px wordmarks, 512 px Devpost and GitHub assets, 256 px application icon, 64/32 px sidebar icons, 16/32 px favicons, Apple touch icon and web manifest.

All exported assets must be tested at 512, 64, 32 and 16 px.

---

## 18. Governance

### Source-of-truth order

1. This master foundation
2. Focused brand documents
3. Machine-readable design tokens
4. Product implementation
5. Marketing and submission assets

### Change policy

A brand change must include:

- reason;
- affected surfaces;
- migration requirement;
- token or asset updates;
- approval by the product owner.

### Versioning

- Patch: wording or clarification
- Minor: additive tokens or component guidance
- Major: positioning, logo, colour or typography change

---

## 19. Brand acceptance checklist

A new CodeER surface is acceptable when:

- the product can be understood within ten seconds;
- the tagline and promise are used consistently;
- the interface feels calm rather than alarming;
- status colour is semantic;
- evidence is visible;
- Codex activity is transparent;
- the user remains in control;
- the logo is legible at the final size;
- typography and spacing use shared tokens;
- accessibility requirements pass;
- no wording implies automatic or guaranteed repair.
