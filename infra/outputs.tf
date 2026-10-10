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

output "frontend_config" {
  description = "Laufzeitkonfiguration des Frontends; die Pipeline schreibt sie als config.json. Mit sso kommt der Auth-Teil dazu."
  value       = merge({ apiBaseUrl = module.core.function_app_url }, [for m in module.sso : m.frontend_config]...)
}
