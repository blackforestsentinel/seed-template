using System.Reflection;
using System.Security.Claims;
using Api.Mcp;
using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Microsoft.Extensions.Options;

namespace Api.Tests;

public class BeispielToolsTests
{
    private readonly BeispielTools tools = new(Options.Create(new SeedOptions { Project = "kundenportal", Environment = "dev" }));

    [Fact]
    public void UeberblickAbrufen_NamesPersonRolesAndCapabilities()
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim("name", "Erika Muster"),
                new Claim(SeedClaimTypes.Role, "Reader"),
                new Claim(SeedClaimTypes.Capability, "status.read"),
            ],
            authenticationType: "Bearer"));

        var ueberblick = tools.UeberblickAbrufen(user);

        Assert.Equal(("Erika Muster", "kundenportal", "dev"), (ueberblick.Person, ueberblick.Projekt, ueberblick.Umgebung));
        Assert.Equal(["Reader"], ueberblick.Rollen);
        Assert.Equal(["status.read"], ueberblick.Berechtigungen);
    }

    [Fact]
    public void StatusAbrufen_RequiresCapability()
    {
        var method = typeof(BeispielTools).GetMethod(nameof(BeispielTools.StatusAbrufen))!;

        Assert.Equal("status.read", method.GetCustomAttribute<RequireCapabilityAttribute>()!.Capability);
        Assert.Equal("ok", tools.StatusAbrufen().Status);
    }
}
