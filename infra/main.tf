locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  sso = try(local.cfg.features.sso, false)

  # Tarif der Static Web App: Free, Standard oder None (kein Frontend, nur API).
  static_web_app = title(lower(try(local.cfg.hosting.staticWebApp, "Free")))
  frontend       = local.static_web_app != "None"
  custom_domains = try([for domain in local.cfg.hosting.customDomains : lower(domain)], [])

  key_vault = try(local.cfg.features.keyVault, false)
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.5.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  static_web_app_sku   = local.static_web_app
  custom_domains       = local.custom_domains
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
  # Je Feature das Flag und die App-Settings des Moduls.
  app_settings = merge(concat(
    [{ Seed__Features__Sso = tostring(local.sso) }],
    [for m in module.sso : m.app_settings],
    [{ Seed__Features__KeyVault = tostring(local.key_vault) }],
    [for m in module.keyvault : m.app_settings],
  )...)
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

# Secrets aus keyVault.secrets: Platzhalter im Vault, App-Settings Secrets__<Name> als
# Key-Vault-Referenz. Die Werte setzt ein Mensch (README, „Secret setzen“).
module "keyvault" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//keyvault?ref=v0.5.0"
  count  = local.key_vault ? 1 : 0

  name                           = local.cfg.project
  environment                    = var.environment
  resource_group_name            = module.core.resource_group_name
  location                       = module.core.location
  function_identity_principal_id = module.core.function_identity_principal_id
  secrets                        = try(local.cfg.keyVault.secrets, [])
  secret_officers                = try(local.cfg.keyVault.secretOfficers, [])
}
