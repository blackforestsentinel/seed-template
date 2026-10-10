using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
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

builder.Build().Run();
