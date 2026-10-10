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

# Leer statt null ohne mcp, wie bei static_web_app_url: lesbar mit terraform output -raw.
output "mcp_url" {
  description = "Adresse des MCP-Endpunkts für Claude, VS Code und andere Clients; mit mcp.customDomain die eigene Domain."
  value       = local.mcp ? coalesce(one(module.sso[*].mcp_resource), "${module.core.function_app_url}/api/mcp") : ""

  precondition {
    condition     = !local.mcp || local.sso
    error_message = "features.mcp setzt features.sso voraus: In project.yaml sso: true setzen."
  }
}

output "mcp_client_id" {
  description = "Client-ID der MCP-Client-Registrierung; in Claude als OAuth Client ID, in Claude Code als --client-id."
  value       = local.mcp ? one(module.sso[*].mcp_client_id) : ""
}
