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

**Einmal pro Kunde (Tenant und Azure-DevOps-Projekt):** Das Onboarding-Skript aus [seed-pipelines](https://github.com/blackforestsentinel/seed-pipelines) richtet Deployment-Identität, Rechte, Terraform-State, Service Connections und die Pipeline `seed-scaffold` ein. Danach einmalig einen PAT als geheime Variable `SeedScaffoldPat` an `seed-scaffold` hinterlegen (siehe dortige README).

**Je Projekt:** Pipeline `seed-scaffold` starten und Name, Features, Frontend (ja oder nur API), Umgebungen und Freigebende angeben. Sie legt das Repo aus diesem Template an, schreibt `project.yaml` und `azure-pipelines.yml`, legt Environments mit Freigaben und die Pipeline an und startet den ersten Lauf. Darin gibt eine Administratorin oder ein Administrator einmal die Azure-Service-Connection frei („Permit“) und danach die Infrastruktur („Approve“).

Die Pipeline baut und testet und plant die Infrastruktur. Nur wenn sich die Infrastruktur ändert, wartet sie auf die Freigabe und wendet den Plan an. Danach deployt sie Function und Frontend und prüft beides per Smoke-Test.

Änderungen an `main` laufen per Pull Request: `seed-scaffold` legt dafür eine Branch-Policy an, nach der der PR-Lauf derselben Pipeline grün sein muss. Er baut, testet, prüft `infra/` per `terraform validate` und sucht mit gitleaks nach Secrets in den Commits des PRs; er deployt nichts. Meldet der Secret-Scan einen falschen Alarm, kommt der Fingerprint aus dem Log in `.gitleaksignore`.

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

**Lokal mit Anmeldung (Feature sso):** In `local.settings.json` `Seed__Features__Sso` auf `true` setzen und `AzureWebJobs.Settings.Disabled` entfernen. `Auth__Mode` ist dort `Local`: Die API verlangt dann kein Token, jede Anfrage läuft als Entwicklungsnutzer mit den Rollen aus `Auth__LocalUser__Roles__0`, `__1` … (Default `Admin`) und den Capabilities, die `auth.roles` in `project.yaml` dafür vorsieht. `public/config.json` enthält passend `"auth": { "mode": "local" }`; das Frontend startet ohne MSAL und lädt die Person von `GET /api/me`. Unter `auth.directory.people` stehen erfundene Personen und eine Anwendung (`"kind": "servicePrincipal"`) für die Personen-Komponenten; ohne Graph zeigen Avatare Initialen, und die Personenauswahl sucht in dieser Liste. Um andere Rechte auszuprobieren, die Rollen in `local.settings.json` ändern und `func start` neu starten. In Azure startet die API mit `Auth__Mode=Local` nicht.

Wer lokal gegen Entra ID testen will, entfernt `Auth__Mode`, trägt die Werte aus dem Terraform-Output der Umgebung `dev` ein (`Auth__TenantId`, `Auth__ClientId`, `Auth__Audience` in `local.settings.json`, `frontend_config` in `public/config.json`); `http://localhost:5173/` ist in `dev` als Redirect-URI eingetragen.

Mit dem Feature `storage` braucht die API lokal [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) als Ersatz für den Storage Account, siehe [storage](#storage-datenhaltung-mit-table-blob-und-queue).

## Bausteine im Code

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights, die Seed-Optionen und `SeedSecrets` ein; der Health-Endpunkt liefert `SeedHealthReport`. `Bfs.Seed.Auth` und `Bfs.Seed.Mcp` schalten sich über die Features `sso` und `mcp` zu, `Bfs.Seed.OpenApi` exportiert beim Build das OpenAPI-Dokument für den Custom Connector, mit dem Feature `storage` kommen `builder.AddSeedStorage()` aus `Bfs.Seed.Storage` und das Beispiel in `api/Api/Jobs` dazu. Telemetrie geht per Managed Identity an Application Insights, ohne Schlüssel im Code.
- **Frontend:** `loadRuntimeConfig()` und `createHttpClient()` aus `@blackforestsentinel/seed-web-core` lesen `/config.json` und sprechen mit der API. `@blackforestsentinel/seed-web-people` liefert Anmeldeseite, Benutzermenü in der Kopfzeile, die Seite „Kein Zugriff“ und Personen-Komponenten; `frontend/src/pages/PeoplePage.tsx` zeigt Personenauswahl und `PersonLabel`. Farben und Schrift kommen als CSS-Variablen (`--seed-…`) aus deren Stylesheet, hell und dunkel.
- **Rechte:** `api/Api/Me/MeFunction.cs` (`GET /api/me`) liefert die Person mit Rollen und Capabilities, `api/Api/Settings/SettingsFunction.cs` zeigt `[RequireCapability]`, `frontend/src/pages/HomePage.tsx` `<IfCapability>` (siehe sso).

Verbesserungen an diesen Bausteinen kommen per Versions-Bump der Pakete ins Projekt.

## Terraform

`infra/` bindet die Module aus seed-terraform mit fester Version ein (`?ref=<version>`), `infra/providers.tf` pinnt die Provider azurerm, azapi und azuread auf exakte Versionen. Die Lock-Datei `infra/.terraform.lock.hcl` hält dazu die Prüfsummen der Provider-Pakete fest, für Linux und Windows (x64) und macOS (Intel und Apple Silicon). `terraform init` nimmt dann nur Pakete mit genau diesen Prüfsummen; ein ausgetauschtes Paket fällt auf, statt in Plan und Apply zu laufen. Die Datei gehört ins Repo.

Nach einem Bump der Provider in `providers.tf` die Lock-Datei neu erzeugen und mit committen, sonst bricht `terraform init` ab, weil die Version nicht mehr zur Lock-Datei passt:

```bash
cd infra
terraform init -backend=false -upgrade
terraform providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64 -platform=darwin_amd64
```

Dasselbe gilt, wenn eine neue Version der Module einen weiteren Provider verlangt. Ein `terraform init` auf einer anderen Plattform ergänzt deren Prüfsummen in der Datei; solche Änderungen nicht committen oder die Plattform im Befehl oben ergänzen.

## Features

`project.yaml` schaltet Features an oder aus, beim Start oder nachträglich. Der nächste Pipeline-Lauf ergänzt nur die neuen Ressourcen. Einzelne Umgebungen können abweichen, siehe [Einstellungen je Umgebung](#einstellungen-je-umgebung).

### sso: Login mit Entra ID

In `project.yaml` `sso: true` setzen und pushen. Mehr braucht es nicht:

- **Infrastruktur:** Terraform legt die App-Registrierungen für API und Frontend an und setzt die App-Settings der Function (`Seed__Features__Sso`, `Auth__*`).
- **API:** `Program.cs` schaltet `builder.UseSeedAuth()` über `Seed__Features__Sso` ein. Dann verlangt jede HTTP-Function ein gültiges Token; Ausnahmen markiert `[AllowAnonymous]` wie beim Health-Endpunkt. Die angemeldete Person steht in `request.HttpContext.User`. Fehlen bei eingeschaltetem sso die Auth-Settings, startet die App nicht.
- **Ohne sso:** `[RequireCapability]` und `[RequireScope]` prüft nur die Token-Prüfung. Ist eine Function mit einem der Attribute ohne sso aufrufbar, startet die API deshalb nicht; die Meldung nennt die Function. Das Beispiel `Settings` schaltet `infra/main.tf` ohne sso per `AzureWebJobs.Settings.Disabled` ab (Liste `sso_example_functions`), lokal `local.settings.json`.
- **Zugelassene Clients:** Delegierte Tokens nimmt die API nur von Anwendungen an, die das Projekt kennt: Frontend (auch eine Browser-Erweiterung mit derselben Registrierung), Custom Connector und MCP-Clients. Eine fremde App, der jemand zugestimmt hat, bekommt 401. Weitere Anwendungen stehen mit ihrer Client-ID unter `auth.additionalClientIds` in `project.yaml`. Tokens von Diensten mit App-Rolle betrifft das nicht.
- **Frontend:** Steht ein Auth-Teil in `config.json`, meldet es per MSAL an und hängt an jeden API-Aufruf ein Token. Wer nicht angemeldet ist, sieht die Anmeldeseite (`SignInPage`); wer schon einmal angemeldet war, kommt meist still über die Sitzung bei Entra ID herein. Läuft das Refresh-Token ab (nach 24 Stunden), erneuert es die Sitzung still: erst im unsichtbaren iframe über die Bridge-Seite `frontend/redirect.html`, sonst per Umleitung ohne Dialog. Die Redirect-URI der Bridge-Seite trägt Terraform ein.

Voraussetzung im Tenant: Die Deployment-Identität hat die Graph-Berechtigung `Application.ReadWrite.OwnedBy` mit Admin-Consent (Tenant-Onboarding).

#### Rollen und Capabilities

Rechte hängen an Capabilities wie `settings.manage`. Welche App-Rolle welche Capabilities bringt, steht nur in `project.yaml`:

```yaml
auth:
  roles:
    Admin:
      description: Verwaltet die Anwendung
      memberTypes: [User]                  # User, Application oder beide
      capabilities: [settings.manage]
  assignmentRequired: false
```

- **Infrastruktur:** Terraform legt je Rolle eine App-Rolle an der API-Registrierung an. Personen und Gruppen weist ein Admin in Entra zu (Enterprise App `<projekt>-<umgebung>-api`, „Benutzer und Gruppen“); die Pipeline darf das nicht. `assignmentRequired: true` lässt nur Personen und Anwendungen mit einer Rolle überhaupt ein Token holen.
- **API:** `api/Api/Api.csproj` verlinkt `project.yaml` in die Build-Ausgabe; `Bfs.Seed.Auth` liest daraus die Zuordnung, lokal wie in Azure. `[RequireCapability("settings.manage")]` an Function oder Klasse verlangt eine Capability (sonst 403), `User.HasCapability(...)` prüft im Code. Eine Capability, die keine Rolle vergibt, lässt die App nicht starten; `AuthTests` findet solche Tippfehler schon im Build. Eine geänderte Zuordnung braucht nur einen Deploy, eine neue Rolle die Infrastruktur-Freigabe.
- **Frontend:** `SeedUserProvider` lädt `GET /api/me`; `<IfCapability capability="settings.manage">` und `useCapabilities()` aus `@blackforestsentinel/seed-web-auth/react` blenden Elemente ein oder aus. Das Frontend kennt die Zuordnung nicht, und die Prüfung macht immer die API. Das Benutzermenü zeigt den Anzeigenamen der Rolle; wer angemeldet ist, aber keine Capability hat, sieht statt der Inhalte `AccessDenied` mit der Erklärung, wen man fragen muss (`frontend/src/App.tsx`).
- **Dienste ohne angemeldete Person:** Eine Rolle mit `memberTypes: [Application]` erlaubt App-only-Tokens (Client-Credentials-Flow); die aufrufende Anwendung bekommt die Rolle als Anwendungsberechtigung. Tokens ohne passende Rolle lehnt die API ab.

Ohne `auth`-Abschnitt gibt es keine Rollen, und alles läuft wie bisher.

#### Vorhandene App-Registrierung, auch aus einem anderen Tenant

Läuft die Anmeldung in einer Umgebung über eine Registrierung, die der Kunde selbst verwaltet, steht sie je Umgebung in `project.yaml`:

```yaml
auth:
  existingRegistration:
    prod:
      tenantId: <tenant-id des Kunden>
      apiClientId: <client-id der API>
      spaClientId: <client-id der SPA>
      apiScope: api://<client-id der API>/access_as_user
```

Terraform legt dann für diese Umgebung keine Registrierungen an; API und Frontend melden sich im angegebenen Tenant an. Was der Admin dort einrichten muss (Redirect-URIs samt Bridge-Seite, Vorautorisierung der SPA, App-Rollen gemäß `auth.roles`, Zuweisungen), steht in der README von [seed-terraform](https://github.com/blackforestsentinel/seed-terraform) beim Modul `sso`.

#### Personen und Profilbilder

Für die Personen-Komponenten aus [`@blackforestsentinel/seed-web-people`](https://github.com/blackforestsentinel/seed-packages) (Profilbild, Benutzermenü, Personenauswahl, Teams-Status, auf Wunsch auch Anwendungen und verwaltete Identitäten): Das Frontend lädt Fotos, Profile und Suchergebnisse mit dem Token der angemeldeten Person direkt aus Microsoft Graph. Die API ist nicht beteiligt, Fotos und Profildaten gehen nie an sie. In `project.yaml`:

```yaml
auth:
  directory:
    enabled: true       # Fotos, Profile, Suche
    presence: true      # Teams-Status
    roleFilter: false   # Personenauswahl nur mit App-Rolle (Administratorzustimmung nötig)
    servicePrincipals: false   # auch Anwendungen und verwaltete Identitäten (Administratorzustimmung nötig)
```

- **Infrastruktur:** Terraform trägt an der App-Registrierung des Frontends (`<projekt>-<umgebung>-web`) delegierte Berechtigungen für Microsoft Graph ein; der Plan zeigt dafür eine Änderung an der Registrierung und wartet auf die Infrastruktur-Freigabe. `config.json` bekommt unter `auth` den Teil `directory` mit den Scopes und der Client-ID der API.
- **CSP:** `connect-src` in `frontend/public/staticwebapp.config.json` erlaubt `https://graph.microsoft.com`. Profilbilder kommen als `data:`-URL, die `img-src` schon zulässt; sonst ist an der CSP nichts gelockert.
- **Rolle im Menü:** `GET /api/me` liefert neben `roles` auch `roleDetails` mit dem Anzeigenamen aus `auth.roles.<Rolle>.displayName` („Administrator“ statt `Admin`), ab der nächsten Version von `Bfs.Seed.Auth`.

| Schalter | Berechtigung (delegiert) | Wofür | Zustimmung |
| --- | --- | --- | --- |
| `enabled` | `User.Read`, `User.ReadBasic.All`, `People.Read` | eigenes Profil, andere Personen und ihre Fotos, Suche, relevante Personen | Personen selbst, soweit der Tenant es zulässt, sonst Admin |
| `presence` | `Presence.Read.All` | Teams-Status | wie oben |
| `roleFilter` | `Application.Read.All`, `GroupMember.Read.All` | wer der API über eine App-Rolle zugewiesen ist, auch über Gruppen | immer Admin |
| `servicePrincipals` | `Application.Read.All` | Anwendungen und verwaltete Identitäten in der Personenauswahl (`principalTypes`) und in Labels und Karten | immer Admin |

Delegiert heißt: Das Frontend sieht nur, was die angemeldete Person auch in Outlook und Teams sieht, und Einstellungen des Tenants wie ausgeblendete Fotos gelten weiter.

**Einmal je Umgebung von Hand zustimmen.** Die Pipeline darf keine Einwilligung erteilen. Nach dem Apply im Entra Admin Center → App-Registrierungen → `<projekt>-<umgebung>-web` → **API-Berechtigungen** → **Administratorzustimmung für „&lt;Tenant&gt;“ erteilen**, oder als Admin `az ad app permission admin-consent --id <spa-client-id>`. Der Terraform-Output `directory_permissions` am Ende des Apply-Logs nennt Client-ID, Berechtigungen und den Befehl.

- Ohne Administratorzustimmung bekommt das Frontend nur dann ein Token für Graph, wenn die Personen selbst zustimmen dürfen. Viele Tenants erlauben das nur für Berechtigungen mit „geringem Risiko“, oft nur `User.Read`; dann ist die Administratorzustimmung nötig, oder ein Admin stuft `User.ReadBasic.All`, `People.Read` und `Presence.Read.All` unter Unternehmensanwendungen → Einwilligung und Berechtigungen → **Berechtigungsklassifizierungen** als geringes Risiko ein (gilt für alle Apps im Tenant).
- Kommen `presence`, `roleFilter` oder `servicePrincipals` später dazu, erneut zustimmen; eine Zustimmung deckt nur die Berechtigungen ab, die beim Klick eingetragen waren.
- Abschalten entfernt die Berechtigungen aus der Registrierung und `directory` aus `config.json`. Eine erteilte Zustimmung bleibt, bis ein Admin sie an der Enterprise App unter **Berechtigungen** widerruft.

**Je Umgebung:** `environments.<name>.auth.directory` überschreibt einzelne Schalter, etwa aus in `prod`, solange dort noch niemand zugestimmt hat. `enabled` ist der Hauptschalter; `enabled: false` schaltet auch `presence`, `roleFilter` und `servicePrincipals` ab:

```yaml
environments:
  prod:
    auth:
      directory: { enabled: false }
```

**Vorhandene App-Registrierung:** Mit `auth.existingRegistration` legt Terraform nichts an, `config.json` bekommt `directory` trotzdem. Der Admin des anderen Tenants trägt die Berechtigungen an seiner Registrierung des Frontends ein und stimmt zu; welche mit welcher ID, steht im Output `directory_permissions` und in der README von [seed-terraform](https://github.com/blackforestsentinel/seed-terraform) beim Modul `sso`.

### mcp: MCP-Server für KI-Werkzeuge

Stellt unter `/api/mcp` einen MCP-Server bereit, über den Claude, VS Code und andere KI-Werkzeuge im Namen der angemeldeten Person Werkzeuge der API aufrufen. Setzt `sso` voraus; ohne `sso` scheitert schon der Plan.

In `project.yaml` `mcp: true` setzen und pushen:

- **Infrastruktur:** Das Modul `sso` legt den Scope `mcp_access` an der API an, eine öffentliche Client-Registrierung `<projekt>-<umgebung>-mcp` für Claude und Claude Code und autorisiert beide sowie VS Code für `mcp_access` vor. `mcp_access` gilt nur für den MCP-Endpunkt: Ein Token, das ein KI-Werkzeug bekommt, erreicht die übrige API nicht.
- **API:** `Program.cs` schaltet `builder.AddSeedMcp()` über `Seed__Features__Mcp` ein. Der Endpunkt arbeitet zustandslos (Streamable HTTP), passt also zu Flex Consumption mit beliebig vielen Instanzen. Die Metadaten nach RFC 9728 liegen unter `/api/.well-known/oauth-protected-resource`; jede 401-Antwort verweist darauf, so finden Clients Entra als Anmeldeserver.
- **Werkzeuge:** Klassen mit `[McpServerToolType]` in `api/Api/Mcp/`, Methoden mit `[McpServerTool]` und `[Description]` (Beispiel: `BeispielTools.cs`). Argumente prüft der Endpunkt gegen das Schema, das aus den Parametern entsteht; unbekannte Argumente lehnt er ab, statt sie zu ignorieren. Ein Parameter `ClaimsPrincipal` liefert die angemeldete Person, weitere Parameter und der Konstruktor bekommen Dienste aus der Dependency Injection.
- **Berechtigungen:** `[RequireCapability("…")]` an Methode oder Klasse. Ein Werkzeug erscheint in `tools/list` nur, wenn die Person alle verlangten Capabilities hat; ein Aufruf ohne sie liefert eine Fehlermeldung mit der fehlenden Berechtigung. Capabilities folgen aus App-Rollen (siehe `sso`).

Nach dem ersten Apply einmal je Umgebung im Entra Admin Center an der Registrierung `<projekt>-<umgebung>-mcp` unter **API-Berechtigungen** die **Administratorzustimmung erteilen**. Sie deckt `offline_access` ab, also das Refresh-Token; ohne sie sehen Personen einen Einwilligungsdialog oder „Administratorgenehmigung erforderlich“. Die Terraform-Outputs `mcp_url` und `mcp_client_id` stehen am Ende des Apply-Logs.

#### Eigene Domain für Claude

Claude und Claude Code senden die MCP-Adresse bei der Anmeldung als `resource` (RFC 8707). Entra stellt nur dann ein Token aus, wenn diese Adresse als Application ID URI an der API-Registrierung steht, und lässt dort nur Domains zu, die im Tenant verifiziert sind. Über den Standardnamen `func-….azurewebsites.net` scheitert die Anmeldung deshalb nach dem Login mit `AADSTS9010010`. VS Code meldet sich ohne `resource` an und braucht keine eigene Domain.

1. Die Domain (oder eine übergeordnete, etwa `example.org` für `mcp.example.org`) muss im Tenant verifiziert sein: Entra Admin Center → Einstellungen → Domänennamen.
2. In `project.yaml` eintragen und pushen; der Plan zeigt eine neue Application ID URI und das App-Setting `Mcp__Resource`:

   ```yaml
   mcp:
     customDomain: mcp.example.org
   ```

   Mit mehreren Umgebungen braucht jede ihre eigene Domain; dann `environments.<name>.mcp.customDomain` statt `mcp.customDomain` (siehe [Einstellungen je Umgebung](#einstellungen-je-umgebung)).

3. DNS beim Anbieter der Zone: CNAME `mcp.example.org` auf den Host aus `function_app_url`, TXT `asuid.mcp.example.org` mit der Prüfkennung aus `az functionapp show -g <resource_group_name> -n <function_app_name> --query customDomainVerificationId -o tsv`.
4. Domain an die Function binden und ein verwaltetes Zertifikat ausstellen:

   ```bash
   az functionapp config hostname add -g <resource_group_name> -n <function_app_name> --hostname mcp.example.org
   az functionapp config ssl create -g <resource_group_name> -n <function_app_name> --hostname mcp.example.org
   ```

   Danach muss die Domain im Portal unter **Benutzerdefinierte Domänen** als gesichert (SNI SSL) erscheinen. Prüfen: `curl -i -X POST https://mcp.example.org/api/mcp` liefert `401` ohne TLS-Fehler.

DNS, Bindung und Zertifikat liegen bewusst nicht in Terraform: Die Bindung verlangt die DNS-Einträge schon beim Apply, und die Zone liegt meist nicht in Azure. Wird die Function App neu angelegt, die Schritte 3 und 4 wiederholen.

#### Verbinden mit Claude und VS Code

Werte aus den Terraform-Outputs: `mcp_url` (mit eigener Domain deren Adresse, sonst die der Function) und `mcp_client_id`. Die Adresse genau so eintragen: Kleinbuchstaben, mit `/api/mcp`, ohne Schrägstrich am Ende.

**VS Code** (funktioniert auch ohne eigene Domain): in `.vscode/mcp.json`

```json
{
  "servers": {
    "my-app": { "type": "http", "url": "https://func-my-app-dev-abc123.azurewebsites.net/api/mcp" }
  }
}
```

Dann **MCP: List Servers** → Server starten → mit Microsoft anmelden. VS Code nutzt seine eigene Entra-Registrierung, die vorautorisiert ist; eine Client-ID braucht es nicht. Lokal geht das genauso gegen `http://localhost:7071/api/mcp`, wenn `local.settings.json` `Seed__Features__Sso`, `Seed__Features__Mcp` und die `Auth__*`-Werte der dev-Umgebung setzt.

**Claude** (claude.ai, Desktop, Mobil; braucht die eigene Domain): In Team- und Enterprise-Organisationen legt ein Owner den Connector einmal an (**Organization settings → Connectors → Add → Custom**), Mitglieder verbinden sich danach unter **Customize → Connectors** selbst; mit Pro oder Max **Customize → Connectors → Add custom connector**. Name frei, URL = `mcp_url`, unter **Advanced settings** OAuth Client ID = `mcp_client_id`, OAuth Client Secret **leer** lassen; Claude meldet sich dann als öffentlicher Client mit PKCE an. Die Anmeldedaten lassen sich später nicht ändern; für eine andere Client-ID den Connector entfernen und neu anlegen.

**Claude Code** (braucht die eigene Domain):

```bash
claude mcp add --transport http --client-id <mcp_client_id> --callback-port 8080 my-app https://mcp.example.org/api/mcp
```

Danach in Claude Code `/mcp` → Server wählen → **Authenticate**. Der Port ist frei wählbar, Entra ignoriert ihn bei `http://localhost/callback`.

**Andere Clients:** Die API nimmt delegierte Tokens nur von zugelassenen Clients an: Frontend, Custom Connector, die MCP-Client-Registrierung und die vorautorisierten Clients (Standard VS Code). Ein anderer Client mit eigener Entra-Registrierung kommt mit seiner Client-ID in `auth.additionalClientIds` in `project.yaml` dazu, sonst antwortet die API mit 401. Braucht er eine eigene Redirect-URI an der Registrierung, kommt sie über `mcp.redirectUris` in `project.yaml` dazu (die Liste ersetzt die Standardwerte, also Claude und Claude Code mit aufführen). Clients, die ein Client-Secret verlangen, etwa Copilot Studio, unterstützt das Feature nicht; dafür ist der Custom Connector vorgesehen.

**Fehlerbilder:** `AADSTS9010010` nach der Anmeldung: eigene Domain fehlt oder die URL im Client weicht von `mcp_url` ab. Einwilligungsdialog oder `AADSTS65001`: Administratorzustimmung fehlt. Werkzeug fehlt in der Liste: Der Person fehlt die Capability (Werkzeug `ueberblick_abrufen` zeigt Rollen und Berechtigungen). Conditional Access mit Standortbedingung: Claude holt und erneuert Tokens von Anthropics Adressen (`160.79.104.0/21`), nicht vom Rechner der Person.

### keyVault: Secrets von Drittanbietern

Für API-Keys und Passwörter, die keine Managed Identity ersetzen kann (Stripe, SMTP, OpenAI usw.). Je Projekt und Umgebung entsteht ein eigener Key Vault.

1. In `project.yaml` `keyVault: true` setzen und die Namen eintragen, dann pushen:

   ```yaml
   features:
     keyVault: true
   keyVault:
     secrets: [stripe-key, smtp-password]
     secretOfficers: [00000000-0000-0000-0000-000000000000]   # optional, Object-IDs
   ```

2. Die Pipeline plant neue Ressourcen und wartet auf die Infrastruktur-Freigabe. Terraform legt den Vault an (nur RBAC, Purge-Schutz, 90 Tage Soft Delete), je Secret einen Platzhalter und die App-Settings `Secrets__StripeKey` und `Secrets__SmtpPassword` als Key-Vault-Referenz. Die Function bekommt `Key Vault Secrets User`, die Personen oder Gruppen aus `secretOfficers` `Key Vault Secrets Officer`. Jeder Zugriff auf ein Secret und jede Änderung am Vault landet als Audit-Log im Log Analytics Workspace der Umgebung (`AzureDiagnostics`, Kategorie `AuditEvent`, Spalten `OperationName`, `identity_claim_upn_s`, `id_s`).
3. Werte setzen (siehe unten). Bis dahin startet die API trotzdem; der Health-Endpunkt meldet `status: "degraded"` mit den Namen der fehlenden Secrets, und `Get()` wirft beim Gebrauch eine Meldung mit dem Namen.

Namen: Kleinbuchstaben und Ziffern, Wörter durch Bindestriche getrennt. Im App-Setting beginnt jedes Wort groß und die Bindestriche entfallen: `stripe-key` wird `Secrets__StripeKey`, im Code `Secrets:StripeKey`.

**Secret lesen:** `SeedSecrets` aus `Bfs.Seed.Functions.Core` ist über `AddSeedCore()` registriert. Erst beim Gebrauch lesen, nicht in `Program.cs`, damit die App auch ohne gesetzte Werte startet:

```csharp
public sealed class PaymentFunction(SeedSecrets secrets)
{
    [Function("Pay")]
    public IActionResult Run([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "pay")] HttpRequest request)
    {
        var apiKey = secrets.Get("stripe-key");
        // ...
    }
}
```

Lokal stehen die Werte in `api/Api/local.settings.json` unter `Values`, z. B. `"Secrets__StripeKey": "sk_test_..."` (die Datei ist nicht eingecheckt).

#### Secret setzen

Werte setzt ein Mensch per CLI oder Portal, nie die Pipeline. Nötig ist die Rolle **Key Vault Secrets Officer** auf dem Vault; Owner und Contributor reichen bei einem RBAC-Vault nicht. Entweder steht die eigene Object-ID unter `keyVault.secretOfficers`, oder jemand mit Owner auf der Subscription vergibt die Rolle einmalig:

```bash
RG=rg-my-app-dev
KV=$(az keyvault list --resource-group $RG --query "[0].name" -o tsv)
FUNC=$(az functionapp list --resource-group $RG --query "[0].name" -o tsv)

# Nur falls die Rolle fehlt (wirkt nach einigen Minuten)
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)"   --role "Key Vault Secrets Officer" --scope "$(az keyvault show --name $KV --query id -o tsv)"

# Wert verdeckt eingeben: nicht in der Shell-History, nicht in der Ausgabe
read -rs VALUE && az keyvault secret set --vault-name $KV --name stripe-key --value "$VALUE" --output none; unset VALUE

# Neuen Wert sofort übernehmen (braucht Contributor oder Website Contributor auf der Function App)
az rest --method post --url "https://management.azure.com$(az functionapp show --name $FUNC --resource-group $RG   --query id -o tsv)/config/configreferences/appsettings/refresh?api-version=2022-03-01"
```

Nach rund 15 Sekunden meldet `/api/health` wieder `status: "ok"`. Direkt nach dem Setzen greift der Refresh manchmal noch nicht (in seed-demo beim ersten Versuch); steht nach einer Minute noch der Platzhalter da, den letzten Befehl wiederholen. Ohne den letzten Befehl übernimmt die Function den Wert beim nächsten Deploy, also beim nächsten Pipeline-Lauf, spätestens aber nach 24 Stunden. `az functionapp restart` reicht auf Flex Consumption nicht. Terraform überschreibt gesetzte Werte nicht wieder mit dem Platzhalter.

Ein Name, der aus `keyVault.secrets` verschwindet, verliert nur sein App-Setting; das Secret bleibt im Vault, bis jemand es mit `az keyvault secret delete` löscht. Details zu Rechten, Soft Delete und Wiederherstellung stehen in der README des Moduls [`keyvault`](https://github.com/blackforestsentinel/seed-terraform/tree/main/keyvault).

### storage: Datenhaltung mit Table, Blob und Queue

In `project.yaml` `storage: true` setzen, unter `storage:` Tabellen, Queues und Container eintragen und pushen:

```yaml
features:
  storage: true

storage:
  tables: [jobs]
  queues: [jobs]
  containers: [uploads]
  lifecycle:                  # optional, z. B. Löschfristen
    - name: uploads-90-tage
      prefixes: [uploads/]
      deleteAfterDays: 90
```

- **Infrastruktur:** Terraform (`infra/storage.tf`, Modul `storage` aus seed-terraform) legt einen eigenen Storage Account an, getrennt vom Host-Storage der Function: ohne Shared Key, TLS 1.2, ohne öffentlichen Blob-Zugriff. Die Managed Identity der Function bekommt Blob, Queue und Table Data Contributor. Versionierung und Soft Delete sind an; `retention:` und `lifecycle:` in `project.yaml` steuern Aufbewahrung und Löschfristen (kommentiertes Beispiel dort). Die App-Settings `Seed__Features__Storage` und `SeedStorage__*` beschreiben die Verbindung `SeedStorage` per Managed Identity.
- **API:** `Program.cs` schaltet `builder.AddSeedStorage()` über `Seed__Features__Storage` ein. Dann gibt es Clients für Table, Blob und Queue, `ISeedTableRepository<T>` mit ETag und `ISeedQueueSender`; Queue-Trigger nutzen `Connection = "SeedStorage"`. Details in der README von [`Bfs.Seed.Storage`](https://github.com/blackforestsentinel/seed-packages/tree/main/dotnet/src/Bfs.Seed.Storage).
- **Beispiel `api/Api/Jobs`:** `POST /api/jobs` legt einen Job-Status in der Tabelle `jobs` an und stellt eine Nachricht in die Queue `jobs`; die Queue-Function `ProcessJob` verarbeitet ihn und schreibt Status und Ergebnis zurück; `GET /api/jobs/{id}` liest den Status. Mit `sso` gehört jeder Job der angemeldeten Person (PartitionKey = `oid`), andere finden ihn nicht. Ohne `storage` schaltet `infra/storage.tf` die drei Functions per `AzureWebJobs.<Name>.Disabled` ab und setzt einen Platzhalter für die Verbindung, weil der Host einen Queue-Trigger auch abgeschaltet indiziert und ohne Verbindung bei jedem Start einen Fehler meldet. Wer das Beispiel löscht oder umbenennt, passt die Liste `storage_example_functions` dort an.

**Fehler und Poison-Queue:** Wirft eine Queue-Function, stellt die Queue die Nachricht nach 30 Sekunden erneut zu (`host.json`: `visibilityTimeout`), höchstens fünfmal (`maxDequeueCount`). Danach verschiebt der Host sie in `<queue>-poison` (hier `jobs-poison`), die er selbst anlegt. Dort verarbeitet sie niemand; nach 7 Tagen verfällt sie. Nachrichten kommen mindestens einmal an, die Verarbeitung muss also wiederholbar sein; das Beispiel prüft dafür den Status in der Tabelle.

**Schutz vor dem Löschen:** Fällt eine Tabelle, Queue oder ein Container aus `project.yaml` heraus oder wird `storage` wieder `false`, würde der nächste Apply sie samt Inhalt löschen; Tabellen und Queues lassen sich nicht wiederherstellen, Container 7 Tage lang. Davor stehen zwei Schichten:

- Der Storage Account hat eine Löschsperre (`storage.deletionLock: true`, Standard). Sie verhindert das Löschen im Portal, per CLI und mit der Resource Group, und auch ein Apply, der eine Tabelle, Queue oder einen Container entfernt, scheitert an ihr.
- Die Pipeline bricht einen Plan, der Daten löscht oder ersetzt, vor der Freigabe ab. Ist das Löschen gewollt: Pipeline von Hand starten, „Datenlöschung bestätigen“ ankreuzen, Plan prüfen, freigeben. In diesem Lauf hebt Terraform die Sperre auf; der nächste normale Lauf setzt sie wieder und braucht dafür eine Freigabe.

Ein Backup gehört noch nicht zum Baustein.

**Lokal mit Azurite:** `local.settings.sample.json` enthält `SeedStorage = UseDevelopmentStorage=true`; lokal legt das Paket Tabellen, Queues und Container beim ersten Zugriff an.

```bash
npm install -g azurite
azurite --inMemoryPersistence --skipApiVersionCheck   # eigenes Terminal
```

In `api/Api/local.settings.json` dann `Seed__Features__Storage` auf `true` setzen und die drei Zeilen `AzureWebJobs.<Name>.Disabled` entfernen. `--skipApiVersionCheck` braucht es, wenn die Azure-SDKs neuer sind als Azurite. Zum Ansehen der Daten eignet sich der Azure Storage Explorer (Emulator-Verbindung).

### customConnector: Power Automate, Power Apps und Copilot Studio

Macht die API zu einem Custom Connector der Power Platform: Ihre Functions erscheinen in Power Automate und Power Apps als Aktionen und in Copilot Studio als Tools. Die Pipeline legt den Connector nach jedem Deploy an oder aktualisiert ihn, aus dem OpenAPI-Dokument, das `Bfs.Seed.OpenApi` beim Build erzeugt. Setzt `sso` voraus.

**Einrichten:**

1. Einmal je Power-Platform-Umgebung: das Tenant-Onboarding von seed-pipelines mit `-PowerPlatformEnvironmentUrl <umgebungs-url>` ausführen. Die Pipeline-Identität wird dort Anwendungsbenutzer mit der Rolle Environment Maker. Die Umgebung braucht Dataverse; die Umgebungs-URL steht im Power Platform Admin Center.
2. In `project.yaml` `customConnector: true` und `customConnector.environmentUrl` setzen, meist je Umgebung unter `environments.<name>.customConnector`. Ohne `environmentUrl` entsteht in einer Umgebung kein Connector.
3. Pushen. Terraform legt die Client-Registrierung `<projekt>-<umgebung>-connector` an (Freigabe), danach legt der Deploy den Connector an.

**Verbinden:** In Power Automate eine Verbindung zum Connector anlegen und mit dem eigenen Konto anmelden. Der Connector ruft die API im Namen der Person auf; es gelten dieselben App-Rollen und Capabilities wie im Browser, Functions ohne passende Capability antworten mit 403. Ein Secret gibt es nicht: Der Connector meldet sich über seine Managed Identity bei Entra an (Option der Power Platform, derzeit Preview). Die Redirect-URI und den Federated Credential dafür trägt die Pipeline an der Registrierung ein.

**Operationen beschreiben:** Was im Connector erscheint, beschreiben Attribute an den Functions; Pfade, Methoden und Routenparameter kommen aus `[HttpTrigger]`. Copilot Studio wählt Tools nach Zusammenfassung und Beschreibung aus, also beschreiben, was die Operation tut und wann man sie braucht.

```csharp
[Function("GetJob")]
[OpenApiOperation("GetJob", "Job abrufen", Description = "Status und Ergebnis eines eigenen Jobs.")]
[OpenApiParameter("id", Description = "Job-ID aus CreateJob", Summary = "Job-ID")]
[OpenApiResponse(200, typeof(JobResponse), Description = "Job")]
[OpenApiResponse(404, Description = "Job nicht gefunden")]
public async Task<IActionResult> Get(
    [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "jobs/{id}")] HttpRequest request, string id, ...)
```

- `[OpenApiOperation(id, zusammenfassung)]`: eindeutige ID und Titel der Aktion; `Visibility = OpenApiVisibility.Internal` blendet sie aus (Beispiel: `GetHealth`).
- `[OpenApiRequestBody(typeof(T))]` und `[OpenApiResponse(status, typeof(T))]`: Body als JSON; Antworten ohne Body nur mit Statuscode. Rückgabewerte als Record statt anonymem Objekt, sonst gibt es kein Schema (Beispiele: `JobError`, `SettingsInfo`).
- Beschreibungen von Feldern per `[property: Description("…")]` am Record.
- `[OpenApiIgnore]` nimmt eine Function heraus. Functions ohne `[OpenApiOperation]` erscheinen trotzdem, der Build warnt dann (`SEEDOPENAPI001`); `api/Api.Tests/OpenApiTests.cs` verlangt, dass es keine Warnungen gibt.
- Titel und Beschreibung der API: `[assembly: OpenApiInfo(…)]` in `Program.cs`. Alles Weitere in der README von `Bfs.Seed.OpenApi`.

Das Dokument entsteht bei jedem Build unter `api/Api/bin/<Konfiguration>/net10.0/openapi/openapi.json` und lässt sich lokal ansehen. Es ist Swagger 2.0, weil die Power Platform nichts anderes annimmt; `host` setzt die Pipeline je Umgebung.

**Weitere Angaben in `project.yaml`:**

- `displayName`: Name in der Power Platform, höchstens 30 Zeichen aus Buchstaben ohne Umlaute, Ziffern, Leerzeichen, `-` und `_` (Standard: `<project> <umgebung>`); anderes lehnt die Power Platform ab, der Plan prüft es vorher.
- `shareWith`: `everyone` (Standard) gibt allen Personen der Power-Platform-Umgebung Lesezugriff auf den Connector, `none` nur der Pipeline und Admins. Ohne Lesezugriff sieht eine Person den Connector nicht; was sie über ihn darf, regeln trotzdem App-Rollen und Capabilities der API.
- `iconBrandColor`: Farbe des Symbols, Standard `#007ee5`.

**Abschalten:** `customConnector: false` entfernt die Client-Registrierung; Verbindungen funktionieren dann nicht mehr. Den Connector selbst löscht die Pipeline nicht, das geht in Power Automate unter **Benutzerdefinierte Connectors**.


## Einstellungen je Umgebung

Eigene App-Settings, abweichende Feature-Schalter, die Obergrenze der Instanzen und die Personen-Komponenten stehen in `project.yaml`, für alle Umgebungen oder je Umgebung:

```yaml
settings:                           # für alle Umgebungen
  Beispiel__Zeitzone: Europe/Berlin

environments:
  test:                             # Name wie environments[].name in azure-pipelines.yml
    features: { keyVault: false }   # überschreibt einzelne Schalter aus features
    maxInstances: 1                 # höchstens so viele Instanzen der Function
    settings:                       # ergänzt und überschreibt settings
      Beispiel__Mocks: "true"
  prod:
    maxInstances: 4
    hosting:                        # ersetzt customDomains bzw. corsAllowedOrigins aus hosting
      customDomains: [app.example.org]
    mcp:                            # ersetzt einzelne Angaben aus mcp
      customDomain: mcp.example.org
    auth:
      directory: { enabled: false }   # überschreibt einzelne Schalter aus auth.directory
```

- **App-Settings:** Terraform setzt `settings` und `environments.<name>.settings` als App-Settings der Function; bei gleichem Namen gilt der Wert der Umgebung. Im Code liest `IConfiguration` sie wie jede andere Einstellung, `Beispiel__Zeitzone` als `Beispiel:Zeitzone`. Seed-eigene Settings gehen bei gleichem Namen vor: die der Features (`Seed__*`, `Auth__*`, `SeedStorage__*`, `Secrets__*`, `Mcp__*`) und die Grundeinstellungen der Function (`AzureWebJobsStorage__*`, `APPLICATIONINSIGHTS_*`, `AZURE_CLIENT_ID`).
- **Werte sind Text.** Zahlen und `true`/`false` nimmt Terraform als Text an, aber YAML liest manches anders, als es dasteht: `007` wird `7`, `1.50` wird `1.5`, `on` und `yes` werden `true`. Solche Werte in Anführungszeichen setzen. Listen, Objekte und leere Werte (für leer `""` schreiben) hält der Plan mit einer Meldung auf.
- **Features:** `environments.<name>.features` überschreibt einzelne Schalter aus `features`, etwa ohne Key Vault in `test`. Terraform und die Flags `Seed__Features__*` der API folgen dem Wert der Umgebung. Der Smoke-Test der Pipeline liest bisher nur `features`; `sso` deshalb nicht je Umgebung abschalten, sonst erwartet er auf `api/me` weiter eine 401. Ohne sso wäre die API in dieser Umgebung ohne Anmeldung erreichbar; Functions mit `[RequireCapability]` lassen sie dann nicht starten (siehe sso).
- **Instanzen:** `maxInstances` begrenzt das Hochskalieren der Function (Flex Consumption erlaubt 1 bis 1000). Ohne Angabe gilt der Standard des Moduls `core`, 40.
- **Domains und CORS:** `environments.<name>.hosting` ersetzt `customDomains` und `corsAllowedOrigins` aus `hosting`. Eine eigene Domain gehört zu genau einer Static Web App; steht sie unter `hosting`, versucht jede Umgebung, sie an ihre eigene zu hängen. Deshalb gehört sie meist unter die Umgebung, die sie bekommt. Tarif (`staticWebApp`) gilt für alle Umgebungen.
- **MCP:** `environments.<name>.mcp` ersetzt einzelne Angaben aus `mcp`, etwa `customDomain`, denn auch die eigene Domain der Function gibt es nur einmal.
- **Personen-Komponenten:** `environments.<name>.auth.directory` überschreibt einzelne Schalter aus `auth.directory`, siehe [Personen und Profilbilder](#personen-und-profilbilder).
- **Browser-Erweiterung:** `environments.<name>.auth.extraRedirectUris` ersetzt `auth.extraRedirectUris`, siehe [Browser-Erweiterungen](#browser-erweiterungen). Weitere Schlüssel unter `environments.<name>.auth` gibt es nicht.
- Eine Umgebung ohne Eintrag unter `environments` nutzt die allgemeinen Angaben. Unbekannte Schlüssel dort, etwa der Tippfehler `maxInstance`, hält der Plan auf.

Geänderte Settings ändern die Function App: Die Pipeline wartet auf die Infrastruktur-Freigabe, danach startet die Function neu. Lokal gelten sie nicht von selbst; `api/Api/local.settings.json` braucht sie unter `Values`. Plattform-Settings wie `WEBSITE_TIME_ZONE`, `TZ` oder `FUNCTIONS_WORKER_RUNTIME` gibt es auf Flex Consumption nicht; eine Zeitzone gehört deshalb in eine eigene Einstellung wie `Beispiel__Zeitzone`.

**Keine Secrets in `settings`:** `project.yaml` liegt im Repo, im Build der API (sie liest daraus die Rollen) und im Terraform-Plan. API-Keys und Passwörter gehören in den Key Vault (Feature [`keyVault`](#keyvault-secrets-von-drittanbietern)): Den Wert setzt ein Mensch, die Function liest ihn als `Secrets__<Name>`.

## Monitoring

Jede Umgebung hat Application Insights mit Log Analytics. Application Insights nimmt nur Telemetrie mit Entra-Token an; die Function sendet per Managed Identity. Das Tageslimit für Logs (`dailyCapGb`, Default 1 GB) schützt vor Kostenausreißern, etwa durch eine Log-Schleife; ist es erreicht, kommt bis 0 Uhr UTC keine Telemetrie mehr an.

Alarme und Budget schaltet ein Empfänger in `project.yaml` ein:

```yaml
monitoring:
  recipients: [betrieb@example.org]
  budget: { dev: 20, prod: 100 }
  exceptionsPerHour: 5
  healthCheckHours: 4
  dailyCapGb: 1
```

Dann legt Terraform je Umgebung an:

- eine Aktionsgruppe, die an alle Empfänger mailt; Azure schickt jeder neuen Adresse einmal eine Bestätigung,
- einen Alarm, sobald es in einer Stunde `exceptionsPerHour` Exceptions gab,
- eine Logic App, die alle `healthCheckHours` Stunden (Default 4, höchstens 12) `/api/health` aufruft, und einen Alarm, wenn der Aufruf auch nach Wiederholungen scheitert,
- einen Alarm, wenn das Tageslimit für Logs erreicht ist, weil bis zum Tageswechsel dann auch die übrigen Alarme still bleiben,
- mit Betrag für die Umgebung ein Monatsbudget der Resource Group in der Abrechnungswährung: Warnung bei 80 % der tatsächlichen Kosten und wenn die Prognose den Betrag übersteigt. `budget: 50` gilt für alle Umgebungen.

Die Meldungen enthalten nur Zählwerte, keine Inhalte von Exceptions oder Logs; die Details stehen in Application Insights. Der Health-Endpunkt muss ohne Token mit 200 antworten, deshalb trägt er `[AllowAnonymous]`. Jeder Health-Check startet die Function nach einer Ruhephase und schreibt deren Startmeldungen in die Logs; ein kürzerer Abstand meldet Ausfälle früher, kostet aber Freikontingent und Log-Volumen. Health-Check und Alarme kosten zusammen rund 1 Euro im Monat je Umgebung, Details und Entscheidungen im [Modul monitoring](https://github.com/blackforestsentinel/seed-terraform/tree/main/monitoring).

Ohne `recipients` gibt es keine Alarme und kein Budget; Application Insights und das Tageslimit bleiben.

## Hosting

### Eigene Domains

Die Static Web App ist immer unter ihrer Azure-Domain (`https://<name>.azurestaticapps.net`) erreichbar. Eigene Domains kommen in `project.yaml` dazu:

```yaml
hosting:
  staticWebApp: Free
  customDomains: [app.example.org]
```

1. Domain eintragen und pushen. Die Pipeline plant eine neue Ressource und wartet auf die Infrastruktur-Freigabe. Terraform legt die Domain mit Validierung per TXT-Eintrag an, trägt sie in die CORS-Freigabe der Function ein und, mit `sso`, als Redirect-URI `https://app.example.org/` in die App-Registrierung des Frontends.
2. DNS-Einträge setzen. Sie stehen am Ende des Apply-Logs im Output `custom_domain_dns_records`, solange die Domain nicht bereit ist zusätzlich als Warnung im Deploy:
   - TXT `_dnsauth.app.example.org` mit dem Wert aus `txt_value` (Validierung),
   - CNAME `app.example.org` auf den Host aus `cname` (Datenverkehr); bei einer Apex-Domain wie `example.org` stattdessen ALIAS, ANAME oder CNAME-Flattening, je nach DNS-Anbieter.
3. Azure prüft den TXT-Eintrag selbst und stellt ein Zertifikat aus; das dauert Minuten bis einige Stunden. Danach ist die Domain bereit und die Warnung im Deploy verschwindet.

Der Apply wartet nicht auf das DNS, die Einträge dürfen also auch erst danach gesetzt werden. Free erlaubt 2, Standard 5 eigene Domains. Läuft die Validierung ab (Status `Failed`), die Domain austragen, Pipeline laufen lassen und wieder eintragen.

Unter `hosting` gilt die Domain für alle Umgebungen. Soll sie nur an eine, etwa prod, gehört sie dorthin (siehe [Einstellungen je Umgebung](#einstellungen-je-umgebung)):

```yaml
environments:
  prod:
    hosting:
      customDomains: [app.example.org]
```

**Umzug einer Domain** von einer anderen Static Web App, etwa bei einer Migration: Eine Domain hängt immer nur an einer Static Web App. Erst an der alten entfernen, dann eintragen und pushen; den TXT-Eintrag für die neue Validierung setzen und den CNAME auf die neue Static Web App umstellen. Bis Azure die Domain validiert und das Zertifikat ausgestellt hat, antwortet sie nicht.

### CORS für weitere Websites

Die Function erlaubt Aufrufe aus dem Browser nur vom eigenen Frontend: der Static Web App, ihren eigenen Domains und in `dev` dem lokalen Vite-Server. Ruft eine andere Website eine Route direkt aus dem Browser auf, etwa ein eingebettetes Widget auf der Firmen-Website, kommt deren Origin dazu:

```yaml
hosting:
  corsAllowedOrigins: [https://www.example.org, https://example.org]
```

- **Origins**, nicht URLs: Schema, Host und optional Port, ohne Pfad und ohne Schrägstrich am Ende. `*` gibt es nicht; der Smoke-Test der Pipeline prüft, dass ein fremder Origin abgelehnt wird.
- **Je Umgebung** unter `environments.<name>.hosting.corsAllowedOrigins`; die Liste dort ersetzt die allgemeine.
- **Browser-Erweiterungen** kommen als `chrome-extension://<erweiterungs-id>` dazu (32 Zeichen `a` bis `p`), siehe [Browser-Erweiterungen](#browser-erweiterungen).
- **CORS ist kein Zugriffsschutz.** Es regelt nur, ob ein Browser die Antwort an das Skript der fremden Seite weitergibt. Was eine Route ohne Token preisgibt, schützt `[AllowAnonymous]` bzw. dessen Fehlen, nicht CORS.
- Die Function bekommt eine geänderte Liste mit dem nächsten Apply, also nach der Infrastruktur-Freigabe.

### Browser-Erweiterungen

Sonderfall: eine Browser-Erweiterung (Edge oder Chrome, Manifest V3) als weiterer Client derselben API. Sie meldet sich per `chrome.identity.launchWebAuthFlow` mit der Redirect-URI `https://<erweiterungs-id>.chromiumapp.org/` an und ruft die API mit der Origin `chrome-extension://<erweiterungs-id>` auf. Die entpackte Erweiterung zum Entwickeln (feste ID über `key` im Manifest) und die Version aus dem Store haben verschiedene IDs, deshalb steht beides meist je Umgebung in `project.yaml`:

```yaml
environments:
  dev:                              # ID der entpackten Erweiterung
    auth:
      extraRedirectUris: [https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/]
    hosting:
      corsAllowedOrigins: [chrome-extension://abcdefghijklmnopabcdefghijklmnop]
  prod:                             # ID aus dem Store
    auth:
      extraRedirectUris: [https://<store-id>.chromiumapp.org/]
    hosting:
      corsAllowedOrigins: [chrome-extension://<store-id>]
```

- **App-Registrierung:** Terraform trägt `auth.extraRedirectUris` als weitere Redirect-URIs an der App-Registrierung des Frontends (`<projekt>-<umgebung>-web`, Plattform „Single-Page-Anwendung“) ein, ohne Bridge-Seite. Nur dort nimmt Entra ID die Einlösung des Codes mit der Origin der Erweiterung an. Die Registrierung entsteht damit auch in einem Projekt ohne Frontend. Setzt `sso` voraus; erlaubt ist nur `https://`, unter `chromiumapp.org` mit gültiger Erweiterungs-ID. `auth.extraRedirectUris` gilt für alle Umgebungen, `environments.<name>.auth.extraRedirectUris` ersetzt es, auch mit `[]`. Mit `auth.existingRegistration` trägt der Admin des anderen Tenants die URIs ein.
- **CORS:** `chrome-extension://<erweiterungs-id>` in `hosting.corsAllowedOrigins`. Die Liste je Umgebung ersetzt die allgemeine; weitere Origins dort mit aufführen. Die CORS-Freigabe der Function beantwortet den Preflight auch für `Authorization` und `If-None-Match`; `host_permissions` braucht die Erweiterung nicht.
- **Antwort-Header wie `ETag`** liest die Erweiterung nur, wenn die Function sie freigibt. Die CORS-Freigabe der Plattform setzt `Access-Control-Expose-Headers` nicht selbst, lässt den Header aus dem Code aber durch, auch bei 304:

  ```csharp
  request.HttpContext.Response.Headers.AccessControlExposeHeaders = "ETag";
  ```
- **Paketieren** übernimmt der Pipeline-Parameter `extension` aus [seed-pipelines](https://github.com/blackforestsentinel/seed-pipelines), siehe dortige README; ohne Store signiert und veröffentlicht ihn die Pipeline mit `extension.signing` (unten).
- **Anmeldung in der Erweiterung:** Einstieg `@blackforestsentinel/seed-web-auth/extension`, siehe README von [`seed-web-auth`](https://github.com/blackforestsentinel/seed-packages/tree/main/web/packages/seed-web-auth).

#### Selbst gehostet für verwaltete Geräte

Statt aus dem Store kann die Erweiterung von der eigenen API kommen: Die Pipeline signiert sie im Deploy als CRX und legt sie im Storage des Projekts ab, [`Bfs.Seed.Extension`](https://github.com/blackforestsentinel/seed-packages/tree/main/dotnet/src/Bfs.Seed.Extension) liefert sie unter `/api/extension/updates.xml` aus. Verwaltete Geräte installieren sie von dort per Intune-Richtlinie (`ExtensionInstallForcelist`) und holen Updates selbst. Einmal einrichten:

1. **Schlüssel:** `onboarding/New-SeedExtensionKey.ps1` aus seed-pipelines erzeugt den Signaturschlüssel, legt ihn als Secure File im Azure-DevOps-Projekt ab und nennt die Erweiterungs-ID samt den Werten für die nächsten Schritte. Den Schlüssel danach sicher offline ablegen: Azure DevOps gibt ihn nicht wieder heraus, und ein neuer Schlüssel ergibt eine neue ID, also eine neue Erweiterung.
2. **project.yaml:** Feature `storage` mit dem Container `extension`, dazu Redirect-URI und CORS mit der ID aus dem Schlüssel in jeder Umgebung, in der signiert wird (Standard prod):

   ```yaml
   features:
     storage: true
   storage:
     containers: [extension]
   environments:
     prod:
       auth:
         extraRedirectUris: [https://<erweiterungs-id>.chromiumapp.org/]
       hosting:
         corsAllowedOrigins: [chrome-extension://<erweiterungs-id>]
   ```

   Mit dem Container gibt `infra/storage.tf` der Deployment-Identität Schreibrechte auf genau diesen Container (Modul `storage`, `extension_publisher_principal_id`), sonst keine Datenrechte.
3. **API:** das Paket `Bfs.Seed.Extension` referenzieren und den Update-Endpunkt in `Program.cs` zusammen mit dem Storage einschalten:

   ```csharp
   if (builder.Configuration.GetValue<bool>("Seed:Features:Storage"))
   {
       builder.AddSeedStorage();
       builder.AddSeedExtensionUpdates();
       // ...
   }
   ```

   `/api/extension/updates.xml` und `/api/extension/packages/<datei>` sind ohne Anmeldung erreichbar, wie der Browser es verlangt; das CRX ist signiert, sein Inhalt nicht geheim. Heißt das Paket in der Pipeline anders als das Projekt (`extension.name`), braucht die API dazu das App-Setting `Extension__PackageName` mit diesem Namen (`settings` in `project.yaml`).
4. **azure-pipelines.yml:** `signing` unter `extension`, mit den Werten aus Schritt 1:

   ```yaml
   extension:
     path: extension
     signing:
       secureFile: my-app-extension.pem
       id: <erweiterungs-id>
       # environments: [prod]
   ```

Der Deploy der Umgebung signiert und veröffentlicht dann jede neue Version, prüft, dass `updates.xml` sie ausliefert, und legt CRX und `release.json` als Artefakt `extension_release_<umgebung>` ab. Ein Paket mit unverändertem Inhalt veröffentlicht er nicht erneut, eine kleinere Version nie (README von seed-pipelines, „Signieren und Veröffentlichen“). Auf die Geräte kommt die Erweiterung über die zentrale Intune-Pipeline des Tenants (`seed-intune`, README von seed-pipelines, „Intune: Edge-Erweiterungen verteilen“): nach dem ersten Veröffentlichen ein Pull Request im Repo `seed-tenant` mit `id` und `updateUrl` (`<function-url>/api/extension/updates.xml`; beides steht auch in `release.json`). Edge installiert Erweiterungen von außerhalb des Stores nur auf verwalteten Geräten.

### Projekt ohne Frontend (nur API)

Für reine APIs, etwa als Backend für einen Custom Connector:

1. In `project.yaml` `hosting.staticWebApp: none` setzen. Terraform legt dann keine Static Web App an; mit `sso` entsteht nur die App-Registrierung der API, keine fürs Frontend.
2. In `azure-pipelines.yml` unter `parameters` `frontend: false` setzen. Die Pipeline baut und deployt dann kein Frontend, schreibt kein `config.json` und prüft im Smoke-Test nur die API. Passen beide Einstellungen nicht zusammen, bricht der Build mit einer Meldung ab.
3. Den Ordner `frontend/` löschen oder ignorieren; die Pipeline greift nicht darauf zu.

`seed-scaffold` erledigt die ersten beiden Schritte, wenn beim Anlegen „Mit Frontend“ ausgeschaltet ist.

### Security-Header

`frontend/public/staticwebapp.config.json` setzt für alle Antworten der Static Web App:

| Header | Wert und Zweck |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`, Skripte und Styles nur aus eigenen Dateien, Bilder zusätzlich als `data:` (kleine Assets bettet Vite so ein, die Personen-Komponenten Profilbilder); `connect-src` erlaubt die Anmeldung bei `https://login.microsoftonline.com`, Microsoft Graph (`https://graph.microsoft.com`, für [Personen und Profilbilder](#personen-und-profilbilder)) und die API; `frame-src` die stille Anmeldung von MSAL im unsichtbaren iframe; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Kamera, Mikrofon und Standort aus |
| `X-Frame-Options` / `frame-ancestors` | `SAMEORIGIN` bzw. `'self'`: keine Einbettung in fremde Seiten |

Die API steht in `connect-src` als Platzhalter `__API_ORIGIN__`. Die Pipeline ersetzt ihn beim Deploy durch den Ursprung der Function-URL und prüft im Smoke-Test, dass der Header ankommt und der Platzhalter verschwunden ist. Ohne Ersatz blockiert die CSP die API.

Warum `'self'` statt `'none'` bei `frame-ancestors`: MSAL holt Tokens notfalls in einem unsichtbaren iframe, das nach der Anmeldung auf die eigene Redirect-URI zurückkehrt. Diese Seite muss sich von der eigenen Anwendung einbetten lassen. Fremde Seiten bleiben ausgeschlossen.

`'unsafe-inline'` für Styles ist nicht nötig: Vite legt CSS als Datei ab, React setzt `style`-Attribute per DOM-API, die die CSP nicht betrifft. Wer eine Bibliothek ergänzt, die Styles zur Laufzeit als `<style>` einfügt, oder externe Dienste aufruft (Schriften, Telemetrie, weitere APIs), erweitert die passende Direktive. Lokal (`npm run dev`) gilt die CSP nicht; sie wirkt nur in der Static Web App.

Die eingebauten Anmeldewege der Static Web App sind gesperrt, weil die Anmeldung per MSAL läuft: `/.auth/login/aad` und `/.auth/login/github` (die beiden vorkonfigurierten Anbieter) liefern 404. Azure sperrt Anbieter nur über diese exakten Routen; eine Wildcard-Route auf `/.auth/*` greift nicht. Ohne Anmeldung bleibt `/.auth/me` leer (`clientPrincipal: null`).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
