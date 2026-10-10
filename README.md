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

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights und die Seed-Optionen ein; der Health-Endpunkt liefert `SeedHealthReport`. `Bfs.Seed.Auth` und `Bfs.Seed.Mcp` schalten sich über die Features `sso` und `mcp` zu.
- **Frontend:** `loadRuntimeConfig()` und `createHttpClient()` aus `@blackforestsentinel/seed-web-core` lesen `/config.json` und sprechen mit der API.

Verbesserungen an diesen Bausteinen kommen per Versions-Bump der Pakete ins Projekt.

## Features

`project.yaml` schaltet Features an oder aus, beim Start oder nachträglich. Der nächste Pipeline-Lauf ergänzt nur die neuen Ressourcen.

### sso: Login mit Entra ID

In `project.yaml` `sso: true` setzen und pushen. Mehr braucht es nicht:

- **Infrastruktur:** Terraform legt die App-Registrierungen für API und Frontend an und setzt die App-Settings der Function (`Seed__Features__Sso`, `Auth__*`).
- **API:** `Program.cs` schaltet `builder.UseSeedAuth()` über `Seed__Features__Sso` ein. Dann verlangt jede HTTP-Function ein gültiges Token; Ausnahmen markiert `[AllowAnonymous]` wie beim Health-Endpunkt. Die angemeldete Person steht in `request.HttpContext.User`. Fehlen bei eingeschaltetem sso die Auth-Settings, startet die App nicht.
- **Frontend:** Steht ein Auth-Teil in `config.json`, meldet es per MSAL an und hängt an jeden API-Aufruf ein Token. Lokal trägt `public/config.json` dafür die Werte aus dem Terraform-Output `frontend_config` ein.

Voraussetzung im Tenant: Die Deployment-Identität hat die Graph-Berechtigung `Application.ReadWrite.OwnedBy` mit Admin-Consent (Tenant-Onboarding).

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

`storage` und `customConnector` folgen.

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
