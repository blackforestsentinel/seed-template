variable "environment" {
  description = "Umgebung, setzt die Pipeline je Stage (dev, test, prod)."
  type        = string
}

variable "location" {
  description = "Azure-Region des Projekts."
  type        = string
  default     = "westeurope"
}

variable "allow_data_deletion" {
  description = "Nur in einem von Hand gestarteten Lauf mit „Datenlöschung bestätigen“ true (setzt die Pipeline als TF_VAR_allow_data_deletion): hebt die Löschsperre des Storage Accounts für diesen Lauf auf."
  type        = bool
  default     = false
}
