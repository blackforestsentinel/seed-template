locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  sso = try(local.cfg.features.sso, false)
  mcp = try(local.cfg.features.mcp, false)

  # Tarif der Static Web App: Free, Standard oder None (kein Frontend, nur API).
  static_web_app = title(lower(try(local.cfg.hosting.staticWebApp, "Free")))
  frontend       = local.static_web_app != "None"
  custom_domains = try([for domain in local.cfg.hosting.customDomains : lower(domain)], [])

  # App-Rollen aus auth.roles (nur mit sso in Gebrauch); die Capabilities je Rolle liest die API
  # aus derselben Datei. Ohne Abschnitt keine Rollen.
  app_roles = try({
    for name, role in local.cfg.auth.roles : name => {
      description          = try(role.description, null)
      display_name         = try(role.displayName, null)
      allowed_member_types = try(role.memberTypes, ["User"])
    }
  }, {})
  # Vorhandene App-Registrierung für diese Umgebung, sonst legt sso sie an.
  auth_existing = try(local.cfg.auth.existingRegistration[var.environment], null)
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.5.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  static_web_app_sku   = local.static_web_app
  custom_domains       = local.custom_domains
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
  app_settings         = merge({ Seed__Features__Sso = tostring(local.sso), Seed__Features__Mcp = tostring(local.mcp) }, [for m in module.sso : m.app_settings]...)
}

module "sso" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//sso?ref=v0.5.0"
  count  = local.sso ? 1 : 0

  name        = local.cfg.project
  environment = var.environment
  # Ohne Frontend nur die API-Registrierung, keine SPA.
  spa_redirect_uris = local.frontend ? concat(
    [module.core.static_web_app_url],
    [for domain in local.custom_domains : "https://${domain}"],
    var.environment == "dev" ? ["http://localhost:5173"] : [],
  ) : []
  # Bridge-Seite frontend/redirect.html für die stille Anmeldung im iframe.
  spa_redirect_bridge_path = local.frontend ? "/redirect.html" : null

  app_roles           = local.app_roles
  assignment_required = try(local.cfg.auth.assignmentRequired, false)
  existing_registration = local.auth_existing == null ? null : {
    tenant_id     = local.auth_existing.tenantId
    api_client_id = local.auth_existing.apiClientId
    spa_client_id = try(local.auth_existing.spaClientId, null)
    api_scope     = local.auth_existing.apiScope
    audience      = try(local.auth_existing.audience, null)
  }

  # MCP-Server (setzt sso voraus): Scope mcp_access, Client-Registrierung für MCP-Clients und
  # mit eigener Domain deren Adresse als Application ID URI.
  mcp               = local.mcp
  mcp_custom_domain = try(lower(local.cfg.mcp.customDomain), null)
  mcp_redirect_uris = try(local.cfg.mcp.redirectUris, null)
}
