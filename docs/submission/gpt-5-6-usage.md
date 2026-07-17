# GPT-5.6 Usage

CodeER must visibly use GPT-5.6 inside the product, not only as a development assistant. The final demo should show model-backed product behavior and preserve the configured model identifier in the execution trace.

## Product Role

GPT-5.6 powers the intelligence layer that converts repository evidence into structured recovery decisions:

- triage classification;
- evidence interpretation;
- root-cause hypothesis generation;
- cited diagnosis;
- treatment-plan composition;
- patch and security review;
- verification interpretation;
- pull-request explanation.

## Configuration

The current environment pattern is:

```env
AI_ALLOWED_MODELS=gpt-5.6
AI_DEFAULT_MODEL=gpt-5.6
AI_STORE_PROVIDER_RESPONSES=false
```

The final demo must not depend on hidden provider responses. It should show structured outputs, citations, policy checks, and stored model metadata.

## Demo Evidence To Capture

Capture at least one model invocation trace showing:

- model identifier;
- organization policy version;
- prompt template or workflow stage;
- bounded evidence context;
- structured diagnosis or plan output;
- citations back to repository evidence;
- cost or usage metadata when available.

## Safety Controls

Repository content and model output are treated as untrusted. CodeER validates schemas, requires citations, confines tools, redacts sensitive evidence, enforces tenant authorization, and requires human approval before controlled repair.

## Remaining Work

- Confirm the exact official model slug from the entrant-facing model availability surface before final submission language is frozen.
- Record a fresh GPT-5.6-backed demo trace from the final vertical slice.
- Include screenshots or video frames showing the model output as product functionality.
