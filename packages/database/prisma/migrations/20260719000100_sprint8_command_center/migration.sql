-- Sprint 8 command-center settings: append-only organization-scoped versions.
CREATE TABLE "OrganizationSetting" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('ORGANIZATION','AI','RECOVERY','PUBLICATION','SECURITY')),
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "enforcement" TEXT NOT NULL CHECK ("enforcement" IN ('ENFORCED','MONITOR')),
  "description" TEXT NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "contentHash" CHAR(64) NOT NULL CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "OrganizationSetting_org_kind_version_key" UNIQUE ("organizationId","kind","version")
);
CREATE INDEX "OrganizationSetting_org_kind_created_idx"
  ON "OrganizationSetting" ("organizationId","kind","createdAt" DESC);

CREATE TRIGGER "OrganizationSetting_immutable" BEFORE UPDATE OR DELETE ON "OrganizationSetting"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();

ALTER TABLE "OrganizationSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationSetting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OrganizationSetting_tenant" ON "OrganizationSetting"
USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
