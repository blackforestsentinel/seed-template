# Sentinel Seed – Projekt-Template

Dünnes Template für Web-Apps aus Azure Static Web App (React) und Azure Function (.NET 10, Flex Consumption). Infrastruktur, Pipeline und Basis-Code kommen als versionierte Bausteine aus dem Hub:

| Baustein | Repo | Einbindung |
| --- | --- | --- |
| Terraform-Module | [seed-terraform](https://github.com/blackforestsentinel/seed-terraform) | `infra/main.tf`, Git-Quelle mit `?ref=<version>` |
| Pipeline | [seed-pipelines](https://github.com/blackforestsentinel/seed-pipelines) | `azure-pipelines.yml`, `extends` |
| Code-Pakete | [seed-packages](https://github.com/blackforestsentinel/seed-packages) | NuGet `Bfs.Seed.*`, npm `@blackforestsentinel/seed-*` |

```
├── project.yaml          Feature-Auswahl, einzige Wahrheit
├── frontend/             React, React Router, React Query (Vite)
├── api/                  Azure Function, dotnet-isolated, mit Tests
├── infra/                Terraform, zieht Module aus seed-terraform
└── azure-pipelines.yml   extends auf seed-pipelines
```

## Neues Projekt starten

Bis die Scaffold-Pipeline `seed-scaffold` steht, sind es diese Schritte in Azure DevOps.

**Einmal pro Azure-DevOps-Organisation**

1. GitHub-Service-Connection `github-blackforestsentinel` anlegen (Typ GitHub). Darüber liest die Pipeline die Templates aus `seed-pipelines`.

**Einmal pro Tenant (Onboarding)**

1. Azure-Service-Connection mit Workload Identity Federation anlegen.
2. Ihrer Identität auf der Ziel-Subscription `Contributor` und `Role Based Access Control Administrator` geben. Die zweite Rolle braucht Terraform, um der Function Zugriff auf ihren Storage zu geben.
3. Storage Account für den Terraform-State anlegen und der Identität dort `Storage Blob Data Contributor` geben.

**Je Projekt**

1. Neues Repo anlegen und dieses Template importieren.
2. In `project.yaml` den Projektnamen setzen (3–20 Zeichen, Kleinbuchstaben, Ziffern, Bindestriche).
3. In `azure-pipelines.yml` `project`, `serviceConnection` und `terraformState` eintragen.
4. Environments anlegen: `<project>-dev` mit einer Freigabe (Approval) für Infrastruktur-Änderungen und `<project>-dev-app` für den App-Deploy, ohne Freigabe. In Produktion kann auch am App-Environment eine Freigabe hängen.
5. Pipeline aus `azure-pipelines.yml` anlegen, für beide Environments berechtigen und starten.

Die Pipeline baut und testet und plant die Infrastruktur. Nur wenn sich die Infrastruktur ändert, wartet sie auf die Freigabe und wendet den Plan an. Danach deployt sie Function und Frontend und prüft beides per Smoke-Test.

## Lokal entwickeln

Voraussetzungen: .NET SDK 10, Node 24, Azure Functions Core Tools 4.

```bash
# API auf http://localhost:7071
cd api/Api
cp local.settings.sample.json local.settings.json
func start

# Frontend auf http://localhost:5173, liest die API-URL aus public/config.json
cd frontend
npm install
npm run dev
```

Tests: `dotnet test --solution api/Api.slnx` und `npm test` in `frontend/`.

## Bausteine im Code

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights und die Seed-Optionen ein; der Health-Endpunkt liefert `SeedHealthReport`.
- **Frontend:** `loadRuntimeConfig()` und `createHttpClient()` aus `@blackforestsentinel/seed-web-core` lesen `/config.json` und sprechen mit der API.

Verbesserungen an diesen Bausteinen kommen per Versions-Bump der Pakete ins Projekt.

## Features

`project.yaml` schaltet Features an oder aus. In Phase 1 gibt es nur die Basis; `sso`, `storage` und `customConnector` folgen.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
