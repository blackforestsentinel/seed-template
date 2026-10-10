locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  sso = try(local.cfg.features.sso, false)

  # Tarif der Static Web App: Free, Standard oder None (kein Frontend, nur API).
  static_web_app = title(lower(try(local.cfg.hosting.staticWebApp, "Free")))
  frontend       = local.static_web_app != "None"
  custom_domains = try([for domain in local.cfg.hosting.customDomains : lower(domain)], [])

  # Ohne Empfänger keine Alarme und kein Budget; das Tageslimit für Logs gilt immer. Eine
  # einzelne Adresse statt einer Liste ist auch erlaubt.
  alert_recipients = compact(flatten([try(local.cfg.monitoring.recipients, [])]))
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.5.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  static_web_app_sku   = local.static_web_app
  custom_domains       = local.custom_domains
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
  app_settings         = merge({ Seed__Features__Sso = tostring(local.sso) }, [for m in module.sso : m.app_settings]...)
  log_daily_quota_gb   = try(local.cfg.monitoring.dailyCapGb, null)
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
}

module "monitoring" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//monitoring?ref=v0.5.0"
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
