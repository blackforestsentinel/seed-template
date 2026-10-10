# Feature storage: eigener Storage Account mit Tabellen, Queues und Containern aus project.yaml.

locals {
  storage     = try(local.cfg.features.storage, false)
  storage_cfg = try(local.cfg.storage, {})

  # Beispiel in api/Api/Jobs; wer es löscht oder umbenennt, passt die Liste an.
  storage_example_functions = ["CreateJob", "GetJob", "ProcessJob"]

  # Ohne Feature storage bleibt das Beispiel abgeschaltet. Der Host indiziert einen
  # abgeschalteten Queue-Trigger trotzdem und meldet ohne auflösbare Verbindung bei jedem
  # Start einen Fehler; deshalb ein Platzhalter, den nie jemand aufruft (.invalid löst nie auf).
  storage_disabled_settings = merge(
    { for f in local.storage_example_functions : "AzureWebJobs.${f}.Disabled" => "true" },
    {
      SeedStorage__queueServiceUri = "https://seed-storage-disabled.invalid/"
      SeedStorage__credential      = "managedidentity"
    },
  )

  storage_app_settings = merge(
    { Seed__Features__Storage = tostring(local.storage) },
    local.storage ? {} : local.storage_disabled_settings,
    [for m in module.storage : m.app_settings]...
  )
}

module "storage" {
  source = "git::https://github.com/blackforestsentinel/seed-terraform.git//storage?ref=v0.5.0"
  count  = local.storage ? 1 : 0

  name                           = local.cfg.project
  environment                    = var.environment
  resource_group_name            = module.core.resource_group_name
  location                       = module.core.location
  function_identity_principal_id = module.core.function_identity_principal_id
  function_identity_client_id    = module.core.function_identity_client_id

  tables     = try(local.storage_cfg.tables, [])
  queues     = try(local.storage_cfg.queues, [])
  containers = try(local.storage_cfg.containers, [])

  # Löschsperre, außer im bestätigten Lauf der Pipeline (Datenlöschung bestätigen).
  deletion_lock       = try(local.storage_cfg.deletionLock, true)
  allow_data_deletion = var.allow_data_deletion

  blob_versioning_enabled     = try(local.storage_cfg.retention.versioning, true)
  blob_version_retention_days = try(local.storage_cfg.retention.versionDays, 7)
  blob_soft_delete_days       = try(local.storage_cfg.retention.softDeleteDays, 7)
  container_soft_delete_days  = try(local.storage_cfg.retention.containerSoftDeleteDays, 7)

  lifecycle_rules = [
    for rule in try(local.storage_cfg.lifecycle, []) : {
      name              = rule.name
      prefixes          = try(rule.prefixes, [])
      cool_after_days   = try(rule.coolAfterDays, null)
      delete_after_days = try(rule.deleteAfterDays, null)
    }
  ]
}
