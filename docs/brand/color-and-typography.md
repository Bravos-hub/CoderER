# CodeER Color and Typography System

## Visual direction

CodeER combines a developer operations center with clinical precision and controlled emergency response. The interface should feel calm, technical, and trustworthy. Urgency is communicated through incident status rather than an aggressively red interface.

## Core color tokens

```css
:root {
  --background-primary: #071018;
  --background-secondary: #0C1722;
  --surface-primary: #101E2A;
  --surface-elevated: #152735;
  --surface-hover: #1A3040;

  --border-subtle: #203544;
  --border-strong: #315064;

  --text-primary: #F5F7FA;
  --text-secondary: #A2B2BF;
  --text-muted: #708593;

  --brand-primary: #FF4D35;
  --brand-hover: #FF654F;
  --brand-active: #D93624;

  --status-critical: #FF4D35;
  --status-warning: #FFB547;
  --status-investigating: #4BA8FF;
  --status-recovering: #9A87FF;
  --status-stable: #2BD584;

  --terminal-background: #050A0F;
  --code-highlight: #173144;
}
```

## Color behavior

### Emergency red-orange

Use for:

- SEV-1 incidents
- Active build failures
- Destructive actions
- The `ER` wordmark
- Critical status indicators

Do not use red-orange on every button, card, border, or navigation element.

### Investigation blue

Use for:

- Repository mapping
- Log collection
- Investigation progress
- Neutral active processes

### Codex violet

Use sparingly for:

- Codex agent activity
- Agent orchestration
- Generated treatment plans

### Recovery green

Use for:

- Passing checks
- Stabilized repositories
- Successful tests
- Verified recovery

### Warning amber

Use for:

- Degraded states
- Approval-required actions
- Partial verification
- Non-blocking risk

## Accessibility requirements

- Maintain WCAG AA contrast for body text and controls.
- Never rely on color alone to communicate state.
- Pair each status color with an icon, label, or pattern.
- Preserve visible focus outlines for keyboard users.
- Keep terminal text readable at 125% and 200% zoom.

## Typography families

### Headings — Space Grotesk

Use for:

- Hero titles
- Dashboard page titles
- Health-score numbers
- Major section headings

### Interface — Inter

Use for:

- Navigation
- Buttons
- Forms
- Cards
- Descriptions
- Tables

### Code and telemetry — JetBrains Mono

Use for:

- Terminal output
- Commands
- Filenames
- Code differences
- Agent events
- Build logs

## Typography scale

```css
:root {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;
  --text-3xl: 2.25rem;
  --text-4xl: 3rem;
  --text-display: 4rem;
}
```

## Font weights

- 400 — body copy and descriptions
- 500 — labels, tabs, and controls
- 600 — card headings and navigation emphasis
- 700 — page titles and hero copy

Avoid using heavy weight for large blocks of technical text.

## Spacing and radius tokens

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
}
```

## Interface tone

CodeER should use:

- Dark navy foundations
- Thin, high-clarity borders
- Moderate radius
- Minimal glow
- Compact technical tables
- Spacious major sections
- Strong status hierarchy

Avoid:

- Excessive gradients
- Glassmorphism on every surface
- Oversized rounded cards
- Decorative animations that delay actions
- Dense red backgrounds
- Low-contrast gray text
