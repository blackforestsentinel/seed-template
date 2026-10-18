terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "5.9.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "2.13.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "3.10.0"
    }
  }

  # Die Pipeline setzt Storage Account, Container und Key per -backend-config.
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    # Feature keyVault: Mit Purge-Schutz bleibt ein gelöschter Vault bis zum Ende der Frist
    # soft-gelöscht. Der nächste Apply stellt ihn samt Secrets wieder her, statt am Namen zu
    # scheitern; endgültig löschen kann ihn vorher niemand.
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
  storage_use_azuread = true

  # Seit azurerm 5 registriert der Provider keine Ressourcenanbieter mehr von selbst. Die Logic App
  # des Health-Checks (Modul monitoring) braucht Microsoft.Logic, das in neuen Subscriptions oft
  # fehlt. Ist er schon registriert, bleibt es bei einer Abfrage je Lauf.
  resource_providers_to_register = ["Microsoft.Logic"]
}

provider "azapi" {}

# Nur mit Feature sso in Gebrauch (App-Registrierungen).
provider "azuread" {}
