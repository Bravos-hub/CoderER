-- Sprint 7 follow-up: durable GitHub webhook ingestion support.
-- Webhook ingress has no actor tenant context, so tenant resolution for
-- signed GitHub deliveries happens through narrowly scoped SECURITY DEFINER
-- functions instead of weakening row-level security.

CREATE OR REPLACE FUNCTION codeer_resolve_github_installation(p_installation_id BIGINT)
RETURNS TABLE("organizationId" UUID, "installationUuid" UUID, "accountLogin" TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gi."organizationId", gi."id", gi."accountLogin"
  FROM "GithubInstallation" gi
  WHERE gi."installationId" = p_installation_id
    AND gi."suspendedAt" IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION codeer_resolve_github_repository(
  p_organization_id UUID,
  p_provider_repo_id TEXT
)
RETURNS TABLE("repositoryId" UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r."id"
  FROM "Repository" r
  WHERE r."organizationId" = p_organization_id
    AND r."providerRepoId" = p_provider_repo_id
  LIMIT 1;
$$;

-- Runtime roles (codeer_app / codeer_worker) receive EXECUTE through the
-- database provisioning script's ALL FUNCTIONS and default-privilege grants.
REVOKE ALL ON FUNCTION codeer_resolve_github_installation(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION codeer_resolve_github_repository(UUID, TEXT) FROM PUBLIC;
