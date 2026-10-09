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
  }

  # Die Pipeline setzt Storage Account, Container und Key per -backend-config.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  storage_use_azuread = true
}

provider "azapi" {}
