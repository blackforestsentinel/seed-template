locals {
  cfg = yamldecode(file("${path.root}/../project.yaml"))
}

module "core" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//core?ref=v0.1.0"

  name                 = local.cfg.project
  environment          = var.environment
  location             = var.location
  cors_allowed_origins = var.environment == "dev" ? ["http://localhost:5173"] : []
}
