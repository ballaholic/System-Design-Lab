using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Features.Architectures;
using SystemDesignLab.Api.Infrastructure.Persistence;

namespace SystemDesignLab.Api.Tests;

/// <summary>
/// ADR-022: the .NET validator must agree with the TypeScript (Zod) one. Both test the shared fixtures in
/// <c>schemas/fixtures</c>. No database needed.
/// </summary>
public sealed class ArchitectureSchemaTests
{
    private const int CurrentSchemaVersion = 1;

    private static readonly string FixturesDir = Path.Combine(FindRepoRoot(), "schemas", "fixtures");

    public static TheoryData<string> ValidFixtures => Fixtures("valid");
    public static TheoryData<string> InvalidFixtures => Fixtures("invalid");

    [Fact]
    public void A_fixture_directory_exists_for_the_current_schema_version()
    {
        Assert.True(Directory.Exists(Path.Combine(FixturesDir, $"v{CurrentSchemaVersion}", "valid")));
        Assert.True(Directory.Exists(Path.Combine(FixturesDir, $"v{CurrentSchemaVersion}", "invalid")));
        Assert.NotEmpty(ValidFixtures);
        Assert.NotEmpty(InvalidFixtures);
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixtures_pass_the_schema(string name)
    {
        var check = ArchitectureDocumentValidator.Shared.Check(Load("valid", name));

        Assert.True(check.IsValid, string.Join("; ", check.Errors));
        Assert.Equal(CurrentSchemaVersion, check.SchemaVersion);
    }

    [Theory]
    [MemberData(nameof(InvalidFixtures))]
    public void Invalid_fixtures_fail_the_schema(string name)
    {
        var check = ArchitectureDocumentValidator.Shared.Check(Load("invalid", name));

        Assert.False(check.IsValid);
        Assert.NotEmpty(check.Errors);
    }

    [Fact]
    public void Node_count_and_raw_json_are_captured()
    {
        var check = ArchitectureDocumentValidator.Shared.Check(Load("valid", "url-shortener.json"));

        Assert.Equal(7, check.NodeCount);
        Assert.Equal(JsonSerializer.Serialize(Load("valid", "url-shortener.json")), JsonSerializer.Serialize(JsonDocument.Parse(check.Raw).RootElement));
    }

    [Fact]
    public void Documents_over_256_KB_are_rejected_before_schema_validation()
    {
        var notes = new string('x', 300 * 1024);
        var doc = JsonDocument.Parse($$"""{"schemaVersion":1,"operations":[],"nodes":[],"edges":[],"layout":{},"notes":"{{notes}}"}""").RootElement;

        var check = ArchitectureDocumentValidator.Shared.Check(doc);

        Assert.True(check.TooLarge);
    }

    [Fact]
    public void Non_objects_are_rejected()
    {
        Assert.False(ArchitectureDocumentValidator.Shared.Check(JsonDocument.Parse("[]").RootElement).IsValid);
        Assert.False(ArchitectureDocumentValidator.Shared.Check(default).IsValid);
    }

    [Theory]
    [InlineData("\"3\"", 3)]
    [InlineData("W/\"7\"", 7)]
    [InlineData("12", 12)]
    [InlineData("", null)]
    [InlineData("\"abc\"", -1)]
    [InlineData("\"-1\"", -1)]
    public void If_match_parsing(string header, int? expected) => Assert.Equal(expected, ArchitectureInput.ParseIfMatch(header));

    [Fact]
    public void Cursors_round_trip_and_reject_garbage()
    {
        var cursor = new ListCursor(new DateTimeOffset(2026, 10, 17, 1, 2, 3, TimeSpan.Zero).AddTicks(1230), Guid.NewGuid());

        Assert.Equal(cursor, ListCursor.TryDecode(cursor.Encode()));
        Assert.Null(ListCursor.TryDecode("not-a-cursor"));
        Assert.Null(ListCursor.TryDecode("!!!"));
        Assert.Null(ListCursor.TryDecode(""));
    }

    [Fact]
    public void List_query_uses_a_row_value_comparison_for_keyset_pagination()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>();
        PersistenceSetup.Configure(options, "Host=unused.invalid;Database=unused");
        using var db = new AppDbContext(options.Options);

        var sql = ArchitecturesEndpoints.ListQuery(db, Guid.NewGuid(), new ListCursor(DateTimeOffset.UtcNow, Guid.NewGuid()), 10).ToQueryString();

        Assert.Contains("(a.updated_at, a.id) < (", sql, StringComparison.Ordinal);
        Assert.Contains("ORDER BY a.updated_at DESC, a.id DESC", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("document", sql, StringComparison.Ordinal);
    }

    private static JsonElement Load(string kind, string name) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(FixturesDir, $"v{CurrentSchemaVersion}", kind, name))).RootElement;

    private static TheoryData<string> Fixtures(string kind)
    {
        var data = new TheoryData<string>();
        foreach (var file in Directory.GetFiles(Path.Combine(FixturesDir, $"v{CurrentSchemaVersion}", kind), "*.json").Order(StringComparer.Ordinal))
            data.Add(Path.GetFileName(file));
        return data;
    }

    private static string FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "schemas", "fixtures"))) return dir.FullName;
        }
        throw new InvalidOperationException("Could not find the repository root (a folder containing schemas/fixtures).");
    }
}
