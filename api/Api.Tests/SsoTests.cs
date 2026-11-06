using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Api.Me;
using Microsoft.Azure.Functions.Worker;
using YamlDotNet.RepresentationModel;

namespace Api.Tests;

/// <summary>
/// Ohne Feature sso startet die API nicht, solange eine Function aufrufbar ist, die eine Anmeldung
/// verlangt (Bfs.Seed.Functions.Core prüft das beim Start). Build, Tests und Deploy liefen sonst
/// grün durch, und erst die App in Azure stünde. Diese Tests finden das schon im Build: Jede solche
/// Function muss ohne sso abgeschaltet sein, in Azure über infra/ (sso_example_functions,
/// storage_example_functions), lokal über local.settings.sample.json.
/// </summary>
public sealed partial class SsoTests
{
    // Wie Bfs.Seed.Functions.Core beim Start: diese Attribute verlangen eine Anmeldung.
    private static readonly string[] AuthAttributes =
    [
        "Bfs.Seed.Auth.RequireCapabilityAttribute",
        "Bfs.Seed.Auth.RequireScopeAttribute",
        "Bfs.Seed.Auth.RequireAnyRoleAttribute",
        "Bfs.Seed.Auth.AllowWithoutRoleAttribute",
    ];

    [Fact]
    public void OhneSso_SindGeschuetzteFunctionsInAzureAbgeschaltet()
    {
        var ssoDisabled = TfList("main.tf", "sso_example_functions");
        var storageDisabled = TfList("storage.tf", "storage_example_functions");

        foreach (var (environment, sso, storage) in Environments())
        {
            if (sso)
            {
                continue;
            }

            var open = ProtectedFunctions()
                .Where(f => !ssoDisabled.Contains(f) && (storage || !storageDisabled.Contains(f)))
                .ToArray();

            // Abhilfe: sso einschalten (features.sso in project.yaml) oder die Function in
            // infra/main.tf unter sso_example_functions eintragen.
            Assert.True(open.Length == 0, $"{environment}: Ohne sso startet die API nicht, denn diese Functions verlangen eine Anmeldung: {string.Join(", ", open)}. features.sso: true setzen oder sie in infra/main.tf unter sso_example_functions eintragen.");
        }
    }

    [Fact]
    public void LokalOhneSso_SindGeschuetzteFunctionsAbgeschaltet()
    {
        using var sample = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "local.settings.sample.json")));
        var values = sample.RootElement.GetProperty("Values");
        if (values.TryGetProperty("Seed__Features__Sso", out var sso) && sso.GetString() == "true")
        {
            return;
        }

        var open = ProtectedFunctions()
            .Where(f => !(values.TryGetProperty($"AzureWebJobs.{f}.Disabled", out var disabled) && disabled.GetString() == "true"))
            .ToArray();

        Assert.True(open.Length == 0, $"local.settings.sample.json: Ohne sso startet die API lokal nicht, denn diese Functions verlangen eine Anmeldung: {string.Join(", ", open)}. Je Function \"AzureWebJobs.<Name>.Disabled\": \"true\" ergänzen oder Seed__Features__Sso auf \"true\" setzen (lokaler Anmeldemodus).");
    }

    /// <summary>Namen der Functions mit einem der <see cref="AuthAttributes"/> an Methode oder Klasse.</summary>
    private static IEnumerable<string> ProtectedFunctions()
    {
        const BindingFlags Members = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
        return typeof(MeFunction).Assembly.GetTypes()
            .SelectMany(type => type.GetMethods(Members).Select(method => (type, method)))
            .Where(m => m.method.GetCustomAttribute<FunctionAttribute>() is not null && (HasAuthAttribute(m.method) || HasAuthAttribute(m.type)))
            .Select(m => m.method.GetCustomAttribute<FunctionAttribute>()!.Name)
            .Order(StringComparer.Ordinal);
    }

    private static bool HasAuthAttribute(MemberInfo member) =>
        member.GetCustomAttributes(inherit: true).Any(a => AuthAttributes.Contains(a.GetType().FullName));

    /// <summary>
    /// Wirksame Schalter sso und storage: die allgemeinen aus features und je Umgebung unter
    /// environments.&lt;name&gt;.features, wie infra/main.tf sie zusammenführt.
    /// </summary>
    private static IEnumerable<(string Environment, bool Sso, bool Storage)> Environments()
    {
        // YamlDotNet kommt über Bfs.Seed.Auth, das project.yaml damit selbst liest.
        var yaml = new YamlStream();
        using (var reader = new StreamReader(Path.Combine(AppContext.BaseDirectory, "project.yaml")))
        {
            yaml.Load(reader);
        }

        var root = (YamlMappingNode)yaml.Documents[0].RootNode;
        var features = Child(root, "features");
        var sso = Flag(features, "sso");
        var storage = Flag(features, "storage");
        yield return ("features", sso ?? false, storage ?? false);

        if (Child(root, "environments") is { } environments)
        {
            foreach (var (name, node) in environments.Children)
            {
                var overrides = node is YamlMappingNode env ? Child(env, "features") : null;
                yield return ($"environments.{name}", Flag(overrides, "sso") ?? sso ?? false, Flag(overrides, "storage") ?? storage ?? false);
            }
        }
    }

    private static YamlMappingNode? Child(YamlMappingNode? node, string key) =>
        node is not null && node.Children.TryGetValue(new YamlScalarNode(key), out var child) ? child as YamlMappingNode : null;

    private static bool? Flag(YamlMappingNode? node, string key) =>
        node is not null && node.Children.TryGetValue(new YamlScalarNode(key), out var value) && value is YamlScalarNode scalar
            ? bool.TryParse(scalar.Value, out var flag) && flag
            : null;

    /// <summary>Liste von Function-Namen aus einer .tf-Datei in infra/, etwa sso_example_functions = ["Settings"].</summary>
    private static HashSet<string> TfList(string file, string name)
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "infra", file));
        var list = Regex.Match(text, $@"\b{name}\s*=\s*\[(?<items>[^\]]*)\]");
        Assert.True(list.Success, $"infra/{file}: {name} nicht gefunden.");
        return [.. QuotedRegex().Matches(list.Groups["items"].Value).Select(m => m.Groups[1].Value)];
    }

    [GeneratedRegex("\"([^\"]+)\"")]
    private static partial Regex QuotedRegex();
}
