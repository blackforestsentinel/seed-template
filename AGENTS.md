# Regeln für Coding-Agents

Dieses Projekt entsteht aus Sentinel Seed. Die Regeln gelten für jede Änderung. Vieles davon prüft der Build oder die Pipeline und bricht sonst ab; was niemand prüft, gilt trotzdem.

## Grundsätze

- `project.yaml` ist die einzige Wahrheit über Projekt, Besitzer (`owner`), Features, Rollen und Capabilities, Secrets, App-Settings und Umgebungen. Terraform, Pipeline und API lesen sie. Nichts davon in `infra/`, im Code oder in der Pipeline nachbauen oder doppeln.
- Änderungen nur per Pull Request auf `main`, nie direkt auf `main` pushen. Der PR-Lauf der Pipeline muss grün sein.
- Ein Commit oder PR enthält nur, was zur Aufgabe gehört. Seed-Versionen hebt ein eigener PR an.
- `TODO(onboarding)` in `project.yaml` markiert Angaben, die nur ein Mensch liefern kann, etwa `owner`; die Pipeline warnt je Fund. Ist eine solche Angabe bekannt, sie nachtragen und die Markierung entfernen. Fehlt sie, darf ein Agent selbst `# TODO(onboarding): …` setzen und nennt das im PR.

## API (`api/`)

- **Fachliche Endpunkte brauchen sso.** Ohne Feature sso startet die API nicht, solange eine Function mit `[RequireCapability]`, `[RequireAnyRole]`, `[AllowWithoutRole]` oder `[RequireScope]` aufrufbar ist. Vor der ersten eigenen Function deshalb `features.sso: true` in `project.yaml`. Ohne sso geht nur `[AllowAnonymous]`, und das bleibt anonym, auch wenn sso später dazukommt. `SsoTests` prüft das im Build.
- Jede HTTP-Function legt an Methode oder Klasse fest, wer sie aufrufen darf; sonst bricht der Build ab (SEEDAUTH001, für MCP-Werkzeuge SEEDAUTH002):
  - `[RequireCapability("…")]` ist die Regel. Die Capability vergibt eine Rolle unter `auth.roles.<Rolle>.capabilities` in `project.yaml`.
  - `[RequireAnyRole]`: jede App-Rolle genügt. Nur mit Grund in einem Kommentar direkt darüber.
  - `[AllowWithoutRole]`: jedes angemeldete Konto, auch ohne Rolle, wie `GET /api/me`. Nur mit Grund.
  - `[AllowAnonymous]`: ohne Token, nur `/api/health`. Nur an der Methode oder der eigenen Klasse und nie zusammen mit einem der anderen Attribute, auch nicht über Klasse oder Basisklasse (SEEDAUTH003).
- Beispiele, die ohne sso bzw. ohne storage nicht laufen, schaltet `infra/main.tf` (`sso_example_functions`) bzw. `infra/storage.tf` (`storage_example_functions`) ab, lokal `AzureWebJobs.<Name>.Disabled` in `local.settings.json`. Eine umbenannte oder gelöschte Function dort mit anpassen.
- Jede HTTP-Function trägt `[OpenApiOperation]`; `OpenApiTests` verlangt ein OpenAPI-Dokument ohne Warnungen.
- Feste Wertelisten sind ein `enum` mit `[JsonConverter(typeof(JsonStringEnumConverter<T>))]`, kein `string` mit Konstanten. Nur dann steht die Liste im OpenAPI-Dokument, und der Custom Connector zeigt eine Auswahl (Beispiel: `JobState` in `api/Api/Jobs/JobStatus.cs`). `[Flags]` bekommt keine Werteliste (SEEDOPENAPI014).
- Nach Änderungen an Functions lokal bauen: Der Build schreibt die Endpunkt-Tabelle in `README.md`, und die Datei gehört in denselben Commit. Die Pipeline ändert sie nicht; mit `treatWarningsAsErrors: true` (Standard) bricht sie bei einer veralteten Tabelle ab (SEEDOPENAPI015, fehlen Datei oder Marker: SEEDOPENAPI016).
- Operationen des Custom Connectors nicht einfach entfernen oder umbenennen: Flows rufen sie über die operationId auf. Erst als deprecated markieren, bevorzugt mit `[OpenApiOperation(…, Deprecated = true, DeprecationMessage = "Stattdessen …")]`. `[Obsolete]` an der Methode geht auch, aber ruft ein Test sie auf, wird CS0618 in der Pipeline zum Fehler. Erst entfernen, wenn kein Flow sie mehr nutzt; die Pipeline prüft vor jeder Freigabe, welche Flows betroffen sind.
- Verbotene APIs stehen in `api/BannedSymbols.txt`, die Meldung von RS0030 nennt die Alternative: Zeit über `TimeProvider` (in `Program.cs` registriert), HTTP über `IHttpClientFactory`, Einstellungen über `IConfiguration`, Logs über `ILogger<T>`, `await` statt `.Result`, `.Wait()` und `Thread.Sleep`.
- Zeitzonen kommen aus einer Einstellung (`settings` in `project.yaml`), nie aus dem Server.

## Secrets

- Secrets nur im Key Vault: Name unter `keyVault.secrets` in `project.yaml`, lesen per `SeedSecrets.Get("name")`. Den Wert setzt ein Mensch.
- Nie ein Secret in `project.yaml` (auch nicht unter `settings`), im Code, in Tests, in der Pipeline oder in einer eingecheckten `local.settings.json`. `api/Api/local.settings.json` ist ignoriert; `local.settings.sample.json` enthält keine Secrets.

## Tests

- Jede Function bekommt Tests in `api/Api.Tests`: Erfolgsfall, ungültige Eingaben und, wo es Rechte gibt, die Capability. Frontend-Code bekommt Tests in `frontend/src/*.test.tsx`.
- Tests nicht löschen, abschwächen oder überspringen, um grün zu werden. `OpenApiTests` listet alle Operationen; eine neue Function gehört dort dazu.
- Spickzettel, die Paket-READMEs liegen außerhalb des Repos:

  ```csharp
  // Angemeldete Person mit Rolle und Capability (wie in AuthTests)
  var http = new DefaultHttpContext
  {
      User = new ClaimsPrincipal(new ClaimsIdentity(
          [new Claim("oid", "00000000-0000-0000-0000-000000000001"), new Claim(SeedClaimTypes.Role, "Admin"), new Claim(SeedClaimTypes.Capability, "settings.manage")],
          "test")),
  };

  // Secrets: Schlüssel Secrets:<Name in PascalCase>, also stripe-key als Secrets:StripeKey
  var secrets = new SeedSecrets(new ConfigurationBuilder()
      .AddInMemoryCollection(new Dictionary<string, string?> { [SeedSecrets.ConfigurationKey("stripe-key")] = "sk_test_123" })
      .Build());

  // Capabilities einer Rolle laut project.yaml (liegt in der Build-Ausgabe)
  var map = SeedCapabilityMap.Load(Path.Combine(AppContext.BaseDirectory, "project.yaml"));
  IReadOnlySet<string> capabilities = map.Resolve(["Admin"], SeedMemberTypes.User);

  // Zeit: eigene Unterklasse von TimeProvider mit fester GetUtcNow(), oder FakeTimeProvider
  // aus dem Paket Microsoft.Extensions.TimeProvider.Testing
  sealed class FixedTime(DateTimeOffset now) : TimeProvider
  {
      public override DateTimeOffset GetUtcNow() => now;
  }
  ```

  `CancellationToken` in Tests: `TestContext.Current.CancellationToken` (xunit v3). Ein `HttpClient` mit Fake-Handler ist gesperrt (RS0030); im Test geht er mit `[SuppressMessage("ApiDesign", "RS0030", Justification = "Test mit Fake-Handler, ohne Sockets")]` an der Testklasse.

## Pakete

- Keine Vorabversionen (`-preview`, `-rc`, `-beta` …) von NuGet- oder npm-Paketen. Eine Ausnahme für ein direkt referenziertes NuGet-Paket steht mit Begründung unter `build.prereleasePackages` in `project.yaml`.
- Eine bekannte Sicherheitslücke der Stufe High oder Critical bricht den Build. Hinnehmen nur bewusst: mit `id` (GHSA-ID oder URL der Advisory) und Begründung unter `build.ignoreAdvisories`. Besser das Paket anheben.
- `Bfs.Seed.*`, `@blackforestsentinel/seed-web-*` und die Refs auf seed-pipelines (`azure-pipelines.yml`) und seed-terraform (`infra/*.tf`) gemeinsam auf Release-Versionen anheben, nach den Release-Notes.

## Infrastruktur (`infra/`)

- Eigene `.tf`-Dateien prüft Trivy in der Pipeline. Eine Ausnahme steht inline direkt über dem Block oder der Zeile, mit Regel-ID und Begründung: `# trivy:ignore:AZU-0011 <Begründung>`, mit Ablaufdatum `# trivy:ignore:AZU-0011:exp:2027-12-31 <Begründung>`. `.trivyignore` wirkt nicht.
- Plan und Apply macht nur die Pipeline.

## Ausnahmen

- Eine Regel auszusetzen braucht eine Begründung von **mindestens zehn Zeichen**, die im PR steht. Das gilt für `Justification`, den Kommentar am `#pragma`, `reason` in `project.yaml` und Trivy-Ausnahmen. Build und Pipeline prüfen es:
  - `[SuppressMessage("Kategorie", "ID", Justification = "Grund")]` am kleinsten passenden Element, sonst SEEDSUPPRESS001;
  - `#pragma warning disable ID // Grund` mit dem Kommentar in derselben Zeile, sonst SEEDSUPPRESS002; `#pragma warning restore ID` direkt danach.
- SEEDAUTH001–003, SEEDSUPPRESS001 und SEEDSUPPRESS002 sind Fehler und nicht abschaltbar: weder per `.editorconfig` noch `NoWarn` noch `#pragma`. Die einzige Ausnahme ist `[SuppressMessage("Security", "SEEDAUTH001", Justification = "…")]` mit Begründung. Das gilt auch in generiertem Code.
- Wer RS0030 oder eine `SEED…`-Regel in `.editorconfig`, `*.props` oder `*.csproj` abschwächt, schreibt in die Zeile davor einen Kommentar mit Begründung; sonst bricht die Pipeline ab. Pauschale Abschaltungen (`RunAnalyzers false`, `dotnet_analyzer_diagnostic.severity = none`) meldet sie als Warnung. Kein `<NoWarn>` und keine abgeschwächte Schwere ohne Begründung im Kommentar daneben.

## Build und Format

- Warnungen gelten in der Pipeline als Fehler: Compiler, Nullable, Analyzer, Code-Stil und MSBuild, etwa SEEDOPENAPI*. Ausgenommen sind nur Warnungen von NuGet, die vom Netz abhängen oder Lücken melden; die prüft die Pipeline gesondert.
- Vor dem Commit `dotnet format api/Api.slnx`. Pipeline und Stop-Hook prüfen nur den Leerraum (`dotnet format whitespace --verify-no-changes`).

## Befehle

Aus dem Wurzelordner des Repos:

| Zweck | API | Frontend (in `frontend/`) |
| --- | --- | --- |
| Abhängigkeiten | `dotnet restore api/Api.slnx` | `npm ci` |
| Build wie die Pipeline | `dotnet build api/Api.slnx -warnaserror -warnNotAsError:NU1603,NU1608,NU1801,NU1900,NU1901,NU1902,NU1903,NU1904,NU1905,MSB3026` | `npm run build` |
| Tests | `dotnet test --solution api/Api.slnx` | `npm test` |
| Typen und Format | `dotnet format api/Api.slnx` (prüfen wie die Pipeline: `dotnet format whitespace api/Api.slnx --verify-no-changes`) | `npm run typecheck`; einen Formatierer bringt das Template nicht mit |
| Lokal starten | `func start` in `api/Api`, vorher `local.settings.sample.json` nach `local.settings.json` kopieren. Braucht Azure Functions Core Tools ab 4.13.0; ältere brechen mit „Could not load file or assembly 'Microsoft.Extensions.Options, Version=10.0.0.0'“ ab. | `npm run dev` |

Infrastruktur: `terraform -chdir=infra fmt -check`, `terraform -chdir=infra init -backend=false` und `terraform -chdir=infra validate`.

## Hooks für Claude Code

- `.claude/settings.json` startet zwei Node-Skripte aus `.claude/hooks/`. Vor dem Ende jeder Antwort prüft `seed-verify.mjs` die geänderten Teile unter `api/` oder `frontend/`: Build, Tests und Leerraum wie die Pipeline.
- Schlägt etwas fehl oder schreibt der Build eine Datei wie die README, gibt der Hook das zurück. Derselbe Stand blockt je Sitzung nur einmal; danach kommt nur ein Hinweis. Die Ursache beheben, nicht den Hook umgehen.
- Beim Start einer Sitzung meldet `seed-update-check.mjs` veraltete Seed-Bausteine. Abschalten mit der Umgebungsvariable `SEED_UPDATE_CHECK=0`, etwa unter `env` in `.claude/settings.local.json`.

## Dokumentation

- `README.md` dieses Repos: Features, `project.yaml`, lokale Entwicklung, Endpunkte, Regeln und Prüfungen.
- READMEs der Seed-Repos unter github.com/blackforestsentinel: `seed-template` (diese Vorlage), `seed-pipelines` (Pipeline, Parameter, Prüfungen im Build), `seed-terraform` (Module), `seed-packages` (`Bfs.Seed.*` und `@blackforestsentinel/seed-web-*`, je Paket eine README, die Analyzer-Regeln in der von `Bfs.Seed.Auth`).
