variable "environment" {
  description = "Umgebung, setzt die Pipeline je Stage (dev, test, prod)."
  type        = string
}

variable "location" {
  description = "Azure-Region des Projekts."
  type        = string
  default     = "westeurope"
}
