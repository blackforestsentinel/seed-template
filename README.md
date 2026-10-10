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

## Bausteine im Code

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights und die Seed-Optionen ein; der Health-Endpunkt liefert `SeedHealthReport`.
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
