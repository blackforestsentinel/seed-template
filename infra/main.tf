locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
  sso = try(local.cfg.features.sso, false)
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.3.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
  app_settings         = merge({}, [for m in module.sso : m.app_settings]...)
}

module "sso" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//sso?ref=v0.3.0"
  count  = local.sso ? 1 : 0

  name              = local.cfg.project
  environment       = var.environment
  spa_redirect_uris = concat([module.core.static_web_app_url], var.environment == "dev" ? ["http://localhost:5173"] : [])
}
