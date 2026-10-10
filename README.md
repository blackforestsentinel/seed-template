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

- **API:** `builder.AddSeedCore()` aus `Bfs.Seed.Functions.Core` richtet Application Insights, die Seed-Optionen und `SeedSecrets` ein; der Health-Endpunkt liefert `SeedHealthReport`.
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
