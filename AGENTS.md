# Regeln für Coding-Agents

Dieses Projekt entsteht aus Sentinel Seed. Die Regeln gelten für jede Änderung. Vieles davon prüft der Build oder die Pipeline und bricht sonst ab; was niemand prüft, gilt trotzdem.

## Grundsätze

- `project.yaml` ist die einzige Wahrheit über Projekt, Besitzer (`owner`), Features, Rollen und Capabilities, Secrets, App-Settings und Umgebungen. Terraform, Pipeline und API lesen sie. Nichts davon in `infra/`, im Code oder in der Pipeline nachbauen oder doppeln.
- Änderungen nur per Pull Request auf `main`, nie direkt auf `main` pushen. Der PR-Lauf der Pipeline muss grün sein.
- Ein Commit oder PR enthält nur, was zur Aufgabe gehört. Seed-Versionen hebt ein eigener PR an.
- `TODO(onboarding)` in `project.yaml` markiert offene Angaben; die Pipeline warnt je Fund. Die Angabe nachtragen, nicht nur die Markierung löschen.

## API (`api/`)

- Jede HTTP-Function legt an Methode oder Klasse fest, wer sie aufrufen darf; sonst bricht der Build ab (SEEDAUTH001, für MCP-Werkzeuge SEEDAUTH002):
  - `[RequireCapability("…")]` ist die Regel. Die Capability vergibt eine Rolle unter `auth.roles.<Rolle>.capabilities` in `project.yaml`.
  - `[RequireAnyRole]`: jede App-Rolle genügt. Nur mit Grund in einem Kommentar direkt darüber.
  - `[AllowWithoutRole]`: jedes angemeldete Konto, auch ohne Rolle, wie `GET /api/me`. Nur mit Grund.
  - `[AllowAnonymous]`: ohne Token. Nur `/api/health`.
- Ohne Feature sso startet die API nicht, solange eine Function mit einem der ersten drei Attribute aufrufbar ist. Solche Functions stehen in `infra/main.tf` unter `sso_example_functions` und lokal als `AzureWebJobs.<Name>.Disabled` in `local.settings.json`.
- Jede HTTP-Function trägt `[OpenApiOperation]`; `OpenApiTests` verlangt ein OpenAPI-Dokument ohne Warnungen. Enums brauchen eine Werteliste (SEEDOPENAPI014).
- Nach Änderungen an Functions lokal bauen: Der Build schreibt die Endpunkt-Tabelle in `README.md`, und die Datei gehört in denselben Commit. Die Pipeline ändert sie nicht, sondern bricht bei einer veralteten Tabelle ab (SEEDOPENAPI015; fehlen Datei oder Marker: SEEDOPENAPI016).
- Operationen des Custom Connectors nicht einfach entfernen oder umbenennen: Flows rufen sie über die operationId auf. Erst als deprecated markieren, mit `[OpenApiOperation(…, Deprecated = true, DeprecationMessage = "Stattdessen …")]` oder `[Obsolete("Stattdessen …")]` an der Methode, und erst entfernen, wenn kein Flow sie mehr nutzt. Die Pipeline prüft vor jeder Freigabe, welche Flows betroffen sind.
- Verbotene APIs stehen in `api/BannedSymbols.txt`, die Meldung von RS0030 nennt die Alternative: Zeit über `TimeProvider`, HTTP über `IHttpClientFactory`, Einstellungen über `IConfiguration`, Logs über `ILogger<T>`, `await` statt `.Result` und `Thread.Sleep`.
- Zeitzonen kommen aus einer Einstellung (`settings` in `project.yaml`), nie aus dem Server.

## Secrets

- Secrets nur im Key Vault: Name unter `keyVault.secrets` in `project.yaml`, lesen per `SeedSecrets.Get("name")`. Den Wert setzt ein Mensch.
- Nie ein Secret in `project.yaml` (auch nicht unter `settings`), im Code, in Tests, in der Pipeline oder in einer eingecheckten `local.settings.json`. `api/Api/local.settings.json` ist ignoriert; `local.settings.sample.json` enthält keine Secrets.

## Tests

- Jede Function bekommt Tests in `api/Api.Tests`: Erfolgsfall, ungültige Eingaben und, wo es Rechte gibt, die Capability. Frontend-Code bekommt Tests in `frontend/src/*.test.tsx`.
- Tests nicht löschen, abschwächen oder überspringen, um grün zu werden.

## Pakete

- Keine Vorabversionen (`-preview`, `-rc`, `-beta` …) von NuGet- oder npm-Paketen. Eine Ausnahme für ein direkt referenziertes NuGet-Paket steht mit Begründung unter `build.prereleasePackages` in `project.yaml`.
- Eine bekannte Sicherheitslücke der Stufe High oder Critical bricht den Build. Hinnehmen nur bewusst: mit `id` (GHSA-ID oder URL der Advisory) und Begründung unter `build.ignoreAdvisories`. Besser das Paket anheben.
- `Bfs.Seed.*`, `@blackforestsentinel/seed-web-*` und die Refs auf seed-pipelines (`azure-pipelines.yml`) und seed-terraform (`infra/*.tf`) gemeinsam auf Release-Versionen anheben, nach den Release-Notes.

## Infrastruktur (`infra/`)

- Eigene `.tf`-Dateien prüft Trivy in der Pipeline. Eine Ausnahme steht inline direkt über dem Block oder der Zeile, mit Regel-ID und Begründung von mindestens zehn Zeichen: `# trivy:ignore:AZU-0011 <Begründung>`, mit Ablaufdatum `# trivy:ignore:AZU-0011:exp:2027-12-31 <Begründung>`. `.trivyignore` wirkt nicht.
- Plan und Apply macht nur die Pipeline.

## Ausnahmen

- Eine Regel auszusetzen braucht eine Begründung, die im PR steht. Der Build prüft das:
  - `[SuppressMessage("Kategorie", "ID", Justification = "Grund")]` am kleinsten passenden Element; ohne `Justification` SEEDSUPPRESS001;
  - `#pragma warning disable ID // Grund` mit dem Kommentar in derselben Zeile, sonst SEEDSUPPRESS002; `#pragma warning restore ID` direkt danach.
- SEEDAUTH*, SEEDSUPPRESS* und RS0030 nicht in `.editorconfig` abschwächen. Kein `<NoWarn>` in Projektdateien und keine abgeschwächte Schwere in `.editorconfig` ohne Begründung im Kommentar daneben.

## Build und Format

- Warnungen gelten in der Pipeline als Fehler: Compiler, Nullable, Analyzer, Code-Stil und MSBuild, etwa SEEDOPENAPI*. Nur Warnungen zu Lücken in Paketen (NU1901–NU1904) bleiben Warnungen; die prüft die Pipeline gesondert.
- Vor dem Commit `dotnet format api/Api.slnx`. Die Pipeline prüft mindestens den Leerraum (`dotnet format whitespace --verify-no-changes`).

## Befehle

Aus dem Wurzelordner des Repos:

| Zweck | API | Frontend (in `frontend/`) |
| --- | --- | --- |
| Abhängigkeiten | `dotnet restore api/Api.slnx` | `npm ci` |
| Build | `dotnet build api/Api.slnx -warnaserror -warnNotAsError:NU1901,NU1902,NU1903,NU1904` | `npm run build` |
| Tests | `dotnet test --solution api/Api.slnx` | `npm test` |
| Typen und Format | `dotnet format api/Api.slnx` (prüfen: `--verify-no-changes`) | `npm run typecheck`; einen Formatierer bringt das Template nicht mit |
| Lokal starten | `func start` in `api/Api` (vorher `local.settings.sample.json` nach `local.settings.json` kopieren) | `npm run dev` |

Infrastruktur: `terraform -chdir=infra fmt -check`, `terraform -chdir=infra init -backend=false` und `terraform -chdir=infra validate`.

In Claude Code laufen Build, Tests und Formatprüfung nach Änderungen unter `api/` oder `frontend/` von selbst, bevor eine Antwort endet; beim Start einer Sitzung meldet ein Hook veraltete Seed-Bausteine (`.claude/settings.json`, Skripte in `.claude/hooks/`). Meldet der Hook einen Fehler, die Ursache beheben, nicht den Hook umgehen.

## Dokumentation

- `README.md` dieses Repos: Features, `project.yaml`, lokale Entwicklung, Endpunkte.
- READMEs der Seed-Repos unter github.com/blackforestsentinel: `seed-template` (diese Vorlage), `seed-pipelines` (Pipeline, Parameter, Prüfungen im Build), `seed-terraform` (Module), `seed-packages` (`Bfs.Seed.*` und `@blackforestsentinel/seed-web-*`, je Paket eine README, die Analyzer-Regeln in der von `Bfs.Seed.Auth`).
