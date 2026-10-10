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

**Lokal mit Anmeldung (Feature sso):** In `local.settings.json` `Seed__Features__Sso` auf `true` setzen. `Auth__Mode` ist dort `Local`: Die API verlangt dann kein Token, jede Anfrage läuft als Entwicklungsnutzer mit den Rollen aus `Auth__LocalUser__Roles__0`, `__1` … (Default `Admin`) und den Capabilities, die `auth.roles` in `project.yaml` dafür vorsieht. `public/config.json` enthält passend `"auth": { "mode": "local" }`; das Frontend startet ohne MSAL und lädt die Person von `GET /api/me`. Um andere Rechte auszuprobieren, die Rollen in `local.settings.json` ändern und `func start` neu starten. In Azure startet die API mit `Auth__Mode=Local` nicht.

Wer lokal gegen Entra ID testen will, entfernt `Auth__Mode`, trägt die Werte aus dem Terraform-Output der Umgebung `dev` ein (`Auth__TenantId`, `Auth__ClientId`, `Auth__Audience` in `local.settings.json`, `frontend_config` in `public/config.json`); `http://localhost:5173/` ist in `dev` als Redirect-URI eingetragen.

Mit dem Feature `storage` braucht die API lokal [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) als Ersatz für den Storage Account, siehe [storage](#storage-datenhaltung-mit-table-blob-und-queue).

## Bausteine im Code

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights, die Seed-Optionen und `SeedSecrets` ein; der Health-Endpunkt liefert `SeedHealthReport`. `Bfs.Seed.Auth` und `Bfs.Seed.Mcp` schalten sich über die Features `sso` und `mcp` zu, mit dem Feature `storage` kommen `builder.AddSeedStorage()` aus `Bfs.Seed.Storage` und das Beispiel in `api/Api/Jobs` dazu. Telemetrie geht per Managed Identity an Application Insights, ohne Schlüssel im Code.
- **Frontend:** `loadRuntimeConfig()` und `createHttpClient()` aus `@blackforestsentinel/seed-web-core` lesen `/config.json` und sprechen mit der API.
- **Rechte:** `api/Api/Me/MeFunction.cs` (`GET /api/me`) liefert die Person mit Rollen und Capabilities, `api/Api/Settings/SettingsFunction.cs` zeigt `[RequireCapability]`, `frontend/src/pages/HomePage.tsx` `<IfCapability>` (siehe sso).

Verbesserungen an diesen Bausteinen kommen per Versions-Bump der Pakete ins Projekt.

## Features

`project.yaml` schaltet Features an oder aus, beim Start oder nachträglich. Der nächste Pipeline-Lauf ergänzt nur die neuen Ressourcen.

### sso: Login mit Entra ID

In `project.yaml` `sso: true` setzen und pushen. Mehr braucht es nicht:

- **Infrastruktur:** Terraform legt die App-Registrierungen für API und Frontend an und setzt die App-Settings der Function (`Seed__Features__Sso`, `Auth__*`).
- **API:** `Program.cs` schaltet `builder.UseSeedAuth()` über `Seed__Features__Sso` ein. Dann verlangt jede HTTP-Function ein gültiges Token; Ausnahmen markiert `[AllowAnonymous]` wie beim Health-Endpunkt. Die angemeldete Person steht in `request.HttpContext.User`. Fehlen bei eingeschaltetem sso die Auth-Settings, startet die App nicht.
- **Frontend:** Steht ein Auth-Teil in `config.json`, meldet es per MSAL an und hängt an jeden API-Aufruf ein Token. Läuft das Refresh-Token ab (nach 24 Stunden), erneuert es die Sitzung still: erst im unsichtbaren iframe über die Bridge-Seite `frontend/redirect.html`, sonst per Umleitung ohne Dialog. Die Redirect-URI der Bridge-Seite trägt Terraform ein.

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
- **Frontend:** `SeedUserProvider` lädt `GET /api/me`; `<IfCapability capability="settings.manage">` und `useCapabilities()` aus `@blackforestsentinel/seed-web-auth/react` blenden Elemente ein oder aus. Das Frontend kennt die Zuordnung nicht, und die Prüfung macht immer die API.
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

**Andere Clients:** Jeder Client, der mit einem eigenen Entra-Token für die API und `mcp_access` kommt, wird angenommen; eine Liste zugelassener Clients gibt es nicht. Braucht er eine eigene Redirect-URI an der Registrierung, kommt sie über `mcp.redirectUris` in `project.yaml` dazu (die Liste ersetzt die Standardwerte, also Claude und Claude Code mit aufführen). Clients, die ein Client-Secret verlangen, etwa Copilot Studio, unterstützt das Feature nicht; dafür ist der Custom Connector vorgesehen.

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

2. Die Pipeline plant neue Ressourcen und wartet auf die Infrastruktur-Freigabe. Terraform legt den Vault an (nur RBAC, Purge-Schutz, 90 Tage Soft Delete), je Secret einen Platzhalter und die App-Settings `Secrets__StripeKey` und `Secrets__SmtpPassword` als Key-Vault-Referenz. Die Function bekommt `Key Vault Secrets User`, die Personen oder Gruppen aus `secretOfficers` `Key Vault Secrets Officer`.
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

Nach rund 15 Sekunden meldet `/api/health` wieder `status: "ok"`. Ohne den letzten Befehl übernimmt die Function den Wert beim nächsten Deploy, also beim nächsten Pipeline-Lauf, spätestens aber nach 24 Stunden. `az functionapp restart` reicht auf Flex Consumption nicht. Terraform überschreibt gesetzte Werte nicht wieder mit dem Platzhalter.

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

**Vorsicht beim Entfernen:** Fällt eine Tabelle, Queue oder ein Container aus `project.yaml` heraus oder wird `storage` wieder `false`, löscht der nächste Apply sie samt Inhalt. Container bleiben 7 Tage wiederherstellbar, Tabellen und Queues nicht. Vor der Infrastruktur-Freigabe den Plan auf `destroy` prüfen. Ein Backup gehört noch nicht zum Baustein.

**Lokal mit Azurite:** `local.settings.sample.json` enthält `SeedStorage = UseDevelopmentStorage=true`; lokal legt das Paket Tabellen, Queues und Container beim ersten Zugriff an.

```bash
npm install -g azurite
azurite --inMemoryPersistence --skipApiVersionCheck   # eigenes Terminal
```

In `api/Api/local.settings.json` dann `Seed__Features__Storage` auf `true` setzen und die drei Zeilen `AzureWebJobs.<Name>.Disabled` entfernen. `--skipApiVersionCheck` braucht es, wenn die Azure-SDKs neuer sind als Azurite. Zum Ansehen der Daten eignet sich der Azure Storage Explorer (Emulator-Verbindung).

`customConnector` folgt mit Phase 4.

## Monitoring

Jede Umgebung hat Application Insights mit Log Analytics. Application Insights nimmt nur Telemetrie mit Entra-Token an; die Function sendet per Managed Identity. Das Tageslimit für Logs (`dailyCapGb`, Default 1 GB) schützt vor Kostenausreißern, etwa durch eine Log-Schleife; ist es erreicht, kommt bis 0 Uhr UTC keine Telemetrie mehr an.

Alarme und Budget schaltet ein Empfänger in `project.yaml` ein:

```yaml
monitoring:
  recipients: [betrieb@example.org]
  budget: { dev: 20, prod: 100 }
  exceptionsPerHour: 5
  dailyCapGb: 1
```

Dann legt Terraform je Umgebung an:

- eine Aktionsgruppe, die an alle Empfänger mailt; Azure schickt jeder neuen Adresse einmal eine Bestätigung,
- einen Alarm, sobald es in einer Stunde `exceptionsPerHour` Exceptions gab,
- einen Webtest, der alle 15 Minuten aus Amsterdam und Dublin `/api/health` aufruft, und einen Alarm, wenn er von beiden Standorten aus scheitert,
- einen Alarm, wenn das Tageslimit für Logs erreicht ist, weil bis zum Tageswechsel dann auch die übrigen Alarme still bleiben,
- mit Betrag für die Umgebung ein Monatsbudget der Resource Group in der Abrechnungswährung: Warnung bei 80 % der tatsächlichen Kosten und wenn die Prognose den Betrag übersteigt. `budget: 50` gilt für alle Umgebungen.

Die Meldungen enthalten nur Zählwerte, keine Inhalte von Exceptions oder Logs; die Details stehen in Application Insights. Der Health-Endpunkt muss ohne Token mit 200 antworten, deshalb trägt er `[AllowAnonymous]`. Webtest und Alarme kosten zusammen rund 4,50 Euro im Monat je Umgebung, Details und Entscheidungen im [Modul monitoring](https://github.com/blackforestsentinel/seed-terraform/tree/main/monitoring).

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
| `Content-Security-Policy` | `default-src 'self'`, Skripte und Styles nur aus eigenen Dateien, Bilder zusätzlich als `data:` (kleine Assets bettet Vite so ein); `connect-src` erlaubt die Anmeldung bei `https://login.microsoftonline.com` und die API; `frame-src` die stille Anmeldung von MSAL im unsichtbaren iframe; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
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
