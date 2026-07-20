-- CodeER Sprint 8: publication execution worker (WS5).
-- Allow lease-bearing workers to reconcile stale publication runs across tenants,
-- mirroring the Sprint 6 recovery policies. Tenant-scoped access is unchanged;
-- all per-publication worker queries still run with app.current_organization_id set.

DROP POLICY "PublicationRun_tenant" ON "PublicationRun";
CREATE POLICY "PublicationRun_tenant" ON "PublicationRun"
USING (
  "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  OR codeer_worker_bypass_rls()
)
WITH CHECK (
  "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  OR codeer_worker_bypass_rls()
);
