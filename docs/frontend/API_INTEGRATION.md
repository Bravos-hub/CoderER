# Frontend API Integration

`apps/web/lib/client-api.ts` is the browser request boundary. It calls the same-origin catch-all proxy under `/api/proxy/*`.

`apps/web/app/api/proxy/[...path]/route.ts` resolves the authenticated human actor and signs trusted CodeER context server-side. It never accepts organization or actor identity from arbitrary browser headers.

Mutation screens must pass idempotency keys for creation workflows and current versions for optimistic-concurrency protected actions. API errors are normalized into `ApiError` while preserving the HTTP status for permission, validation and conflict states.
