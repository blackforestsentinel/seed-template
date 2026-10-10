# Die Pipeline liest diese Outputs für Deploy und Smoke-Test.

output "resource_group_name" {
  value = module.core.resource_group_name
}

output "function_app_name" {
  value = module.core.function_app_name
}

output "function_app_url" {
  value = module.core.function_app_url
}

output "static_web_app_name" {
  value = module.core.static_web_app_name
}

output "static_web_app_url" {
  value = module.core.static_web_app_url
}

output "custom_domain_dns_records" {
  description = "DNS-Einträge für hosting.customDomains: TXT-Eintrag zur Validierung, CNAME (Apex: ALIAS) für den Datenverkehr."
  value       = module.core.custom_domain_dns_records
}

output "frontend_config" {
  description = "Laufzeitkonfiguration des Frontends; die Pipeline schreibt sie als config.json. Mit sso kommt der Auth-Teil dazu."
  value       = merge({ apiBaseUrl = module.core.function_app_url }, [for m in module.sso : m.frontend_config]...)
}

# Leer ohne Feature keyVault, wie static_web_app_name ohne Frontend.
output "key_vault_name" {
  description = "Name des Key Vaults für az keyvault secret set. Leer ohne Feature keyVault."
  value       = try(module.keyvault[0].key_vault_name, "")
}
