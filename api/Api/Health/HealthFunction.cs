using Bfs.Seed.Functions.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Options;

namespace Api.Health;

/// <summary>
/// Anonymer Health-Endpunkt. Der Smoke-Test der Pipeline und das Frontend rufen ihn auf.
/// [AllowAnonymous] nimmt ihn von der Token-Prüfung aus, wenn das Feature sso aktiv ist.
/// </summary>
[AllowAnonymous]
public sealed class HealthFunction(IOptions<SeedOptions> options)
{
    [Function("Health")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest request)
        => new OkObjectResult(SeedHealthReport.Create(options.Value, typeof(HealthFunction).Assembly));
}
