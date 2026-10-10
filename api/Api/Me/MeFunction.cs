using Bfs.Seed.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Api.Me;

/// <summary>
/// Angemeldete Person mit Rollen und Capabilities. Das Frontend blendet damit UI-Elemente ein oder
/// aus, ohne zu wissen, welche Rolle was darf; das steht nur in project.yaml (auth.roles).
/// </summary>
public sealed class MeFunction
{
    [Function("Me")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me")] HttpRequest request)
        => new OkObjectResult(SeedUserInfo.From(request.HttpContext.User));
}
