using Api.Jobs;
using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Bfs.Seed.Mcp;
using Bfs.Seed.Storage;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
builder.AddSeedCore();

// Feature keyVault: Secrets aus keyVault.secrets liest SeedSecrets erst beim Gebrauch, z. B.
// public sealed class PaymentFunction(SeedSecrets secrets) { ... secrets.Get("stripe-key") ... }
// Fehlt der Wert noch, wirft Get() mit dem Namen des Secrets; die App startet trotzdem.

// Feature sso aus project.yaml: Terraform setzt Seed__Features__Sso und die Auth-Settings.
// Dann verlangt jede HTTP-Function ein Token; Ausnahmen markiert [AllowAnonymous].
if (builder.Configuration.GetValue<bool>("Seed:Features:Sso"))
{
    builder.UseSeedAuth();
}

// Feature mcp aus project.yaml (setzt sso voraus): MCP-Endpunkt /api/mcp für Claude, VS Code
// und andere KI-Werkzeuge. Werkzeuge sind Klassen mit [McpServerToolType], hier in Mcp/.
if (builder.Configuration.GetValue<bool>("Seed:Features:Mcp"))
{
    builder.AddSeedMcp()
        .WithToolsFromAssembly(typeof(Program).Assembly)
        .WithInstructions("Rufe zuerst ueberblick_abrufen auf: Es nennt die anfragende Person und ihre Berechtigungen.");
}

// Feature storage aus project.yaml: Terraform setzt Seed__Features__Storage und die Verbindung
// SeedStorage. Dann gibt es die Clients für Table, Blob und Queue; Beispiel in Jobs/.
if (builder.Configuration.GetValue<bool>("Seed:Features:Storage"))
{
    builder.AddSeedStorage();
    builder.Services.AddSeedTable<JobStatus>(JobStatus.TableName);
}

builder.Build().Run();
