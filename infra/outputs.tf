# Die Pipeline liest diese Outputs für Deploy und Smoke-Test.

output "resource_group_name" {
  value = module.core.resource_group_name
}

output "function_app_name" {
  value = module.core.function_app_name

  # Prüfungen für settings und environments aus project.yaml; sie betreffen diese Function App.
  precondition {
    condition     = length(local.project_settings_invalid) == 0
    error_message = "settings in project.yaml: kein Text als Wert bei ${join(", ", local.project_settings_invalid)}. Zahlen und true/false gehen auch, Listen, Objekte und leere Werte nicht (leer: \"\")."
  }

  precondition {
    condition     = length(local.env_unknown) == 0
    error_message = "environments.${var.environment} in project.yaml: ${join(", ", local.env_unknown)} unbekannt; erlaubt sind features, maxInstances, settings, hosting, mcp, customConnector, auth.directory und auth.extraRedirectUris."
  }

  precondition {
    condition     = length(local.env_hosting_unknown) == 0
    error_message = "environments.${var.environment}.hosting in project.yaml: ${join(", ", local.env_hosting_unknown)} geht nicht je Umgebung; erlaubt sind customDomains und corsAllowedOrigins."
  }

  precondition {
    condition     = length(local.cors_invalid) == 0
    error_message = "hosting.corsAllowedOrigins in project.yaml: ${join(", ", local.cors_invalid)} ist kein Origin. Erwartet wird https://<host> (oder http://) mit optionalem Port und ohne Pfad, etwa https://www.example.org, oder für eine Browser-Erweiterung chrome-extension://<erweiterungs-id> (32 Zeichen a bis p)."
  }
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
  description = "Laufzeitkonfiguration des Frontends; die Pipeline schreibt sie als config.json. Mit sso kommt der Auth-Teil dazu, mit auth.directory darin directory."
  value       = merge({ apiBaseUrl = module.core.function_app_url }, [for m in module.sso : m.frontend_config]...)

  precondition {
    condition     = local.directory != null
    error_message = "auth.directory in project.yaml (auch unter environments): ein Objekt erwartet, z. B. { enabled: true, presence: true }."
  }

  precondition {
    condition     = length(local.directory_unknown) == 0
    error_message = "auth.directory in project.yaml: ${join(", ", local.directory_unknown)} unbekannt; erlaubt sind enabled, presence und roleFilter."
  }

  precondition {
    condition     = local.sso || length(local.auth_extra_redirect_uris) == 0
    error_message = "auth.extraRedirectUris in project.yaml (auch unter environments) setzt features.sso voraus: In project.yaml sso: true setzen."
  }
}

# Null ohne auth.directory; dann ändert sich am Plan bestehender Projekte nichts.
output "directory_permissions" {
  description = "Mit auth.directory: delegierte Graph-Berechtigungen an der SPA-Registrierung und der Befehl für die Administratorzustimmung (README, „Personen und Profilbilder“)."
  value       = one(module.sso[*].directory_permissions)
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

# Leer ohne Feature keyVault, wie static_web_app_name ohne Frontend.
output "key_vault_name" {
  description = "Name des Key Vaults für az keyvault secret set. Leer ohne Feature keyVault."
  value       = try(module.keyvault[0].key_vault_name, "")
}

# Null ohne features.customConnector oder ohne customConnector.environmentUrl für diese Umgebung;
# dann tut der Connector-Schritt der Pipeline nichts.
output "custom_connector" {
  description = "Angaben für den Custom Connector, den die Pipeline nach dem Deploy anlegt oder aktualisiert (seed-pipelines, steps/custom-connector.yml)."
  value = local.connector ? {
    environmentUrl = local.connector_url
    name           = local.connector_name
    displayName    = local.connector_display_name
    shareWith      = local.connector_share_with
    iconBrandColor = try(local.connector_cfg.iconBrandColor, "#007ee5")
    clientId       = one(module.sso[*].connector_client_id)
    tenantId       = one(module.sso[*].tenant_id)
    resourceUri    = one(module.sso[*].api_identifier_uri)
  } : null

  precondition {
    condition     = !local.connector_feature || local.sso
    error_message = "features.customConnector setzt features.sso voraus: In project.yaml sso: true setzen."
  }

  precondition {
    condition     = !local.connector_feature || local.auth_existing == null
    error_message = "features.customConnector mit auth.existingRegistration geht noch nicht: Die Client-Registrierung des Connectors müsste im anderen Tenant von Hand entstehen (README von seed-terraform, Modul sso)."
  }

  precondition {
    condition     = length(local.connector_unknown) == 0
    error_message = "customConnector in project.yaml: ${join(", ", local.connector_unknown)} unbekannt; erlaubt sind environmentUrl, displayName, shareWith und iconBrandColor."
  }

  precondition {
    condition     = local.connector_url == null || can(regex("^https://[a-z0-9-]+(\\.[a-z0-9-]+)+$", local.connector_url))
    error_message = "customConnector.environmentUrl in project.yaml: die Umgebungs-URL der Power-Platform-Umgebung ohne Pfad, z. B. https://org0000000.crm4.dynamics.com (Power Platform Admin Center)."
  }

  precondition {
    condition     = length(local.connector_display_name) <= 30 && can(regex("^[A-Za-z0-9][A-Za-z0-9 _-]*$", local.connector_display_name))
    error_message = "customConnector.displayName in project.yaml: höchstens 30 Zeichen, nur Buchstaben ohne Umlaute, Ziffern, Leerzeichen, - und _, am Anfang ein Buchstabe oder eine Ziffer; anderes nimmt die Power Platform nicht an (\"${local.connector_display_name}\")."
  }

  precondition {
    condition     = contains(["everyone", "none"], local.connector_share_with)
    error_message = "customConnector.shareWith in project.yaml: everyone (alle in der Power-Platform-Umgebung) oder none."
  }
}
