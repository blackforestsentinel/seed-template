using Api.Jobs;
using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Bfs.Seed.Storage;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
builder.AddSeedCore();

// Feature sso aus project.yaml: Terraform setzt Seed__Features__Sso und die Auth-Settings.
// Dann verlangt jede HTTP-Function ein Token; Ausnahmen markiert [AllowAnonymous].
if (builder.Configuration.GetValue<bool>("Seed:Features:Sso"))
{
    builder.UseSeedAuth();
}

// Feature storage aus project.yaml: Terraform setzt Seed__Features__Storage und die Verbindung
// SeedStorage. Dann gibt es die Clients für Table, Blob und Queue; Beispiel in Jobs/.
if (builder.Configuration.GetValue<bool>("Seed:Features:Storage"))
{
    builder.AddSeedStorage();
    builder.Services.AddSeedTable<JobStatus>(JobStatus.TableName);
}

builder.Build().Run();
