using System.Security.Claims;
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
