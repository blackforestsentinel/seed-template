using System.Reflection;
using System.Security.Claims;
using Api.Jobs;
using Api.Me;
using Bfs.Seed.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Api.Tests;

public class AuthTests
{
    [Fact]
    public void RequiredCapabilities_AreDefinedInProjectYaml()
    {
        // Ein Tippfehler in [RequireCapability] ließe die App in Azure nicht starten; hier fällt er schon im Build auf.
        var map = SeedCapabilityMap.Load(Path.Combine(AppContext.BaseDirectory, "project.yaml"));

        Assert.Empty(SeedCapabilityCheck.FindUnknownCapabilities(map, typeof(MeFunction).Assembly));
    }

    [Fact]
    public void Me_IsReachableWithoutRole()
    {
        // Mit auth.assignmentRequired: false zeigt das Frontend „Kein Zugriff“ nur, wenn GET /api/me
        // auch ohne Rolle mit 200 antwortet; mit true bekommt ohne Rolle niemand ein Token.
        Assert.NotNull(typeof(MeFunction).GetCustomAttribute<AllowWithoutRoleAttribute>());
    }

    [Theory]
    [InlineData(nameof(JobFunctions.Create))]
    [InlineData(nameof(JobFunctions.Get))]
    public void Jobs_RequireRunCapability(string method)
    {
        var attribute = typeof(JobFunctions).GetMethod(method)!.GetCustomAttribute<RequireCapabilityAttribute>();

        Assert.Equal(JobFunctions.RunCapability, attribute?.Capability);
    }

    [Fact]
    public void Me_ReturnsRolesAndCapabilities()
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim("name", "Erika Muster"),
                    new Claim(SeedClaimTypes.Role, "Admin"),
                    new Claim(SeedClaimTypes.Capability, "settings.manage"),
                ],
                "test")),
        };

        var result = Assert.IsType<OkObjectResult>(new MeFunction().Run(http.Request));

        var user = Assert.IsType<SeedUserInfo>(result.Value);
        Assert.Equal("Erika Muster", user.Name);
        Assert.Equal(["Admin"], user.Roles);
        Assert.Equal(["settings.manage"], user.Capabilities);
    }
}
