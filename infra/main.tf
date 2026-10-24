locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  # Abweichungen dieser Umgebung aus environments.<name>; ohne Eintrag gelten die allgemeinen
  # Angaben. Unbekannte Schlüssel (Tippfehler) hält die Prüfung am Output function_app_name auf.
  env = try(local.cfg.environments[var.environment], {})
  env_unknown = setunion(
    setsubtract(try(keys(local.env), []), ["auth", "features", "maxInstances", "settings", "hosting", "mcp", "customConnector"]),
    [for key in setsubtract(try(keys(local.env.auth), []), ["directory", "extraRedirectUris"]) : "auth.${key}"],
  )
  # Wirksame Features: features, einzelne Schalter überschrieben aus environments.<name>.features.
  features = merge(try(local.cfg.features, {}), try(local.env.features, {}))
  sso      = try(local.features.sso, false)
  mcp      = try(local.features.mcp, false)

  # Beispiel in api/Api/Settings mit [RequireCapability]. Ohne Token-Prüfung startet die API mit
  # einer solchen Function nicht (Bfs.Seed.Functions.Core); ohne sso bleibt sie deshalb abgeschaltet.
  # Wer weitere Functions mit [RequireCapability] oder [RequireScope] auch ohne sso ausliefert,
  # nimmt sie hier auf.
  sso_example_functions = ["Settings"]

  # Tarif der Static Web App: Free, Standard oder None (kein Frontend, nur API). Gilt für alle
  # Umgebungen, wie frontend in azure-pipelines.yml.
  static_web_app = title(lower(try(local.cfg.hosting.staticWebApp, "Free")))
  frontend       = local.static_web_app != "None"
  # Eigene Domains und CORS: hosting, einzelne Schlüssel ersetzt aus environments.<name>.hosting,
  # denn eine Domain gehört zu genau einer Static Web App, meist der von prod.
  hosting             = merge(try(local.cfg.hosting, {}), try(local.env.hosting, {}))
  env_hosting_unknown = setsubtract(try(keys(local.env.hosting), []), ["customDomains", "corsAllowedOrigins"])
  custom_domains      = try([for domain in local.hosting.customDomains : lower(domain)], [])
  # Zusätzliche Origins für die CORS-Freigabe der Function, etwa eine Website, die eine öffentliche
  # Route aus dem Browser aufruft, oder eine Browser-Erweiterung (chrome-extension://<id>). Static
  # Web App und eigene Domains sind immer freigegeben, in dev zusätzlich der lokale Vite-Server.
  cors_extra_origins = try([for origin in local.hosting.corsAllowedOrigins : trimsuffix(lower(origin), "/")], [])
  cors_invalid       = [for origin in local.cors_extra_origins : origin if !can(regex("^(https?://[a-z0-9.-]+(:[0-9]+)?|chrome-extension://[a-p]{32})$", origin))]
  cors_allowed_origins = distinct(concat(
    var.environment == "dev" ? ["http://localhost:5173"] : [],
    local.cors_extra_origins,
  ))
  # mcp, einzelne Schlüssel ersetzt aus environments.<name>.mcp, etwa die eigene Domain je Umgebung.
  mcp_cfg = merge(try(local.cfg.mcp, {}), try(local.env.mcp, {}))

  # Custom Connector der Power Platform: customConnector, einzelne Schlüssel ersetzt aus
  # environments.<name>.customConnector, etwa die Power-Platform-Umgebung je Umgebung. Ohne
  # environmentUrl entsteht in dieser Umgebung kein Connector. Den Connector legt die Pipeline an
  # (Output custom_connector), Terraform nur die Client-Registrierung (Modul sso).
  connector_feature = try(local.features.customConnector, false)
  connector_cfg     = merge(try(local.cfg.customConnector, {}), try(local.env.customConnector, {}))
  connector_unknown = setsubtract(keys(local.connector_cfg), ["environmentUrl", "displayName", "shareWith", "iconBrandColor"])
  connector_url     = try(trimsuffix(lower(local.connector_cfg.environmentUrl), "/"), null)
  connector         = local.connector_feature && local.connector_url != null
  # Anzeigename in Power Automate, Power Apps und Copilot Studio; Dataverse nimmt höchstens 30 Zeichen.
  connector_display_name = try(local.connector_cfg.displayName, "${local.cfg.project} ${var.environment}")
  connector_share_with   = lower(try(local.connector_cfg.shareWith, "everyone"))
  # Name in Dataverse nach dem Präfix des Publishers: fest je Projekt und Umgebung, nur Kleinbuchstaben
  # und Ziffern. Er identifiziert den Connector bei jedem Lauf, auch wenn sich der Anzeigename ändert.
  connector_name = "${substr(replace(lower(local.cfg.project), "/[^a-z0-9]/", ""), 0, 16)}${substr(replace(lower(var.environment), "/[^a-z0-9]/", ""), 0, 8)}"

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
  # Personen-Komponenten im Frontend (nur mit sso und Frontend in Gebrauch): auth.directory,
  # einzelne Schalter überschrieben aus environments.<name>.auth.directory, etwa aus in einer
  # Umgebung, deren Tenant noch nicht zugestimmt hat. Kein Objekt oder unbekannte Schlüssel hält
  # die Prüfung am Output frontend_config auf.
  directory         = try(merge(try(local.cfg.auth.directory, {}), try(local.env.auth.directory, {})), null)
  directory_unknown = try(setsubtract(keys(local.directory), ["enabled", "presence", "roleFilter"]), [])
  # Weitere Redirect-URIs der SPA ohne Bridge-Seite, etwa einer Browser-Erweiterung:
  # auth.extraRedirectUris, ersetzt aus environments.<name>.auth.extraRedirectUris, denn entpackte
  # Erweiterung und Store-Version haben verschiedene IDs. Eine einzelne URI statt einer Liste ist
  # auch erlaubt; ohne sso hält die Prüfung am Output frontend_config sie auf.
  auth_extra_redirect_uris = compact(flatten([try(local.env.auth.extraRedirectUris, local.cfg.auth.extraRedirectUris, [])]))
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
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.15.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  static_web_app_sku   = local.static_web_app
  custom_domains       = local.custom_domains
  cors_allowed_origins = local.cors_allowed_origins
  # Eigene Settings zuerst, damit die Seed-eigenen bei gleichem Namen vorgehen; danach je
  # Feature das Flag und die App-Settings des Moduls.
  app_settings = merge(concat(
    [local.project_settings],
    [{ Seed__Features__Sso = tostring(local.sso), Seed__Features__Mcp = tostring(local.mcp) }],
    [local.sso ? {} : { for f in local.sso_example_functions : "AzureWebJobs.${f}.Disabled" => "true" }],
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
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//sso?ref=v0.15.0"
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
  # Weitere Redirect-URIs ohne Bridge-Seite, etwa einer Browser-Erweiterung; damit entsteht die
  # SPA-Registrierung auch ohne Frontend.
  spa_extra_redirect_uris = local.auth_extra_redirect_uris

  app_roles           = local.app_roles
  assignment_required = try(local.cfg.auth.assignmentRequired, false)
  # Delegierte Tokens nimmt die API nur von zugelassenen Clients an; weitere aus project.yaml.
  additional_allowed_client_ids = try(local.cfg.auth.additionalClientIds, [])
  existing_registration = local.auth_existing == null ? null : {
    tenant_id     = local.auth_existing.tenantId
    api_client_id = local.auth_existing.apiClientId
    spa_client_id = try(local.auth_existing.spaClientId, null)
    api_scope     = local.auth_existing.apiScope
    audience      = try(local.auth_existing.audience, null)
  }

  # Personen-Komponenten (seed-web-people): delegierte Graph-Berechtigungen an der SPA und
  # auth.directory in config.json. Die Zustimmung erteilt ein Admin von Hand (README).
  directory = {
    enabled     = try(local.directory.enabled, false)
    presence    = try(local.directory.presence, false)
    role_filter = try(local.directory.roleFilter, false)
  }

  # MCP-Server (setzt sso voraus): Scope mcp_access, Client-Registrierung für MCP-Clients und
  # mit eigener Domain deren Adresse als Application ID URI.
  mcp               = local.mcp
  mcp_custom_domain = try(lower(local.mcp_cfg.customDomain), null)
  mcp_redirect_uris = try(local.mcp_cfg.redirectUris, null)

  # Custom Connector (setzt sso voraus): Client-Registrierung ohne Secret; Connector, Redirect-URI
  # und Federated Credential legt die Pipeline an (Output custom_connector).
  connector = local.connector
}

module "monitoring" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//monitoring?ref=v0.15.0"
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
  # Abstand in Stunden; ohne Angabe der Default des Moduls (4).
  health_check_interval_hours = try(local.cfg.monitoring.healthCheckHours, null)
  # Betrag je Umgebung oder einer für alle; ohne Betrag kein Budget.
  budget_amount = try(tonumber(local.cfg.monitoring.budget), local.cfg.monitoring.budget[var.environment], null)
}

# Secrets aus keyVault.secrets: Platzhalter im Vault, App-Settings Secrets__<Name> als
# Key-Vault-Referenz. Die Werte setzt ein Mensch (README, „Secret setzen“).
module "keyvault" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//keyvault?ref=v0.15.0"
  count  = local.key_vault ? 1 : 0

  name                           = local.cfg.project
  environment                    = var.environment
  resource_group_name            = module.core.resource_group_name
  location                       = module.core.location
  function_identity_principal_id = module.core.function_identity_principal_id
  secrets                        = try(local.cfg.keyVault.secrets, [])
  secret_officers                = try(local.cfg.keyVault.secretOfficers, [])
  # Audit-Log des Vaults (wer hat wann welches Secret gelesen oder gesetzt) im Workspace aus core
  audit_logs = { workspace_id = module.core.log_analytics_workspace_id }
}
