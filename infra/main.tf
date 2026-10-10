locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  # Abweichungen dieser Umgebung aus environments.<name>; ohne Eintrag gelten die allgemeinen
  # Angaben. Unbekannte Schlüssel (Tippfehler) hält die Prüfung am Output function_app_name auf.
  env         = try(local.cfg.environments[var.environment], {})
  env_unknown = setsubtract(try(keys(local.env), []), ["features", "maxInstances", "settings"])
  # Wirksame Features: features, einzelne Schalter überschrieben aus environments.<name>.features.
  features = merge(try(local.cfg.features, {}), try(local.env.features, {}))
  sso      = try(local.features.sso, false)
  mcp      = try(local.features.mcp, false)

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
  # Ohne Empfänger keine Alarme und kein Budget; das Tageslimit für Logs gilt immer. Eine
  # einzelne Adresse statt einer Liste ist auch erlaubt.
  alert_recipients = compact(flatten([try(local.cfg.monitoring.recipients, [])]))
  key_vault        = try(local.features.keyVault, false)

  # Eigene App-Settings: settings, ergänzt und überschrieben aus environments.<name>.settings.
  # Zahlen und Booleans werden Text; leere Werte, Listen und Objekte hält die Prüfung am Output
  # function_app_name mit einer Meldung auf.
  project_settings_raw     = merge(try(local.cfg.settings, {}), try(local.env.settings, {}))
  project_settings_invalid = [for k, v in local.project_settings_raw : k if v == null || !can(tostring(v))]
  project_settings         = { for k, v in local.project_settings_raw : k => tostring(v) if !contains(local.project_settings_invalid, k) }
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.6.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  static_web_app_sku   = local.static_web_app
  custom_domains       = local.custom_domains
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
  # Eigene Settings zuerst, damit die Seed-eigenen bei gleichem Namen vorgehen; danach je
  # Feature das Flag und die App-Settings des Moduls.
  app_settings = merge(concat(
    [local.project_settings],
    [{ Seed__Features__Sso = tostring(local.sso), Seed__Features__Mcp = tostring(local.mcp) }],
    [local.storage_app_settings],
    [for m in module.sso : m.app_settings],
    [{ Seed__Features__KeyVault = tostring(local.key_vault) }],
    [for m in module.keyvault : m.app_settings],
  )...)
  log_daily_quota_gb = try(local.cfg.monitoring.dailyCapGb, null)
  # Höchstens so viele Instanzen der Function; ohne Angabe der Default des Moduls.
  maximum_instance_count = try(local.env.maxInstances, null)
}

module "sso" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//sso?ref=v0.6.0"
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

module "monitoring" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//monitoring?ref=v0.6.0"
  count  = length(local.alert_recipients) > 0 ? 1 : 0

  name                       = local.cfg.project
  environment                = var.environment
  resource_group_name        = module.core.resource_group_name
  resource_group_id          = module.core.resource_group_id
  location                   = module.core.location
  application_insights_id    = module.core.application_insights_id
  log_analytics_workspace_id = module.core.log_analytics_workspace_id
  alert_emails               = local.alert_recipients
  exception_threshold        = try(local.cfg.monitoring.exceptionsPerHour, null)
  health_check_url           = "${module.core.function_app_url}/api/health"
  # Betrag je Umgebung oder einer für alle; ohne Betrag kein Budget.
  budget_amount = try(tonumber(local.cfg.monitoring.budget), local.cfg.monitoring.budget[var.environment], null)
}

# Secrets aus keyVault.secrets: Platzhalter im Vault, App-Settings Secrets__<Name> als
# Key-Vault-Referenz. Die Werte setzt ein Mensch (README, „Secret setzen“).
module "keyvault" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//keyvault?ref=v0.6.0"
  count  = local.key_vault ? 1 : 0

  name                           = local.cfg.project
  environment                    = var.environment
  resource_group_name            = module.core.resource_group_name
  location                       = module.core.location
  function_identity_principal_id = module.core.function_identity_principal_id
  secrets                        = try(local.cfg.keyVault.secrets, [])
  secret_officers                = try(local.cfg.keyVault.secretOfficers, [])
}
