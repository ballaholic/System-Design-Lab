using SystemDesignLab.Api.Features.Challenges;

namespace SystemDesignLab.Api.Tests;

/// <summary>Loading and validating challenge content at startup (no database).</summary>
public sealed class ChallengeCatalogTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "sdl-challenges-" + Guid.NewGuid().ToString("N"));

    private static string ShippedContent => Path.Combine(AppContext.BaseDirectory, "content", "challenges");

    private string CopyOfShipped()
    {
        foreach (var file in Directory.GetFiles(ShippedContent, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(_root, Path.GetRelativePath(ShippedContent, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target);
        }
        return Path.Combine(_root, "url-shortener");
    }

    [Fact]
    public void Loads_the_shipped_content_without_reference_solutions()
    {
        var catalog = ChallengeCatalog.Load(ShippedContent);

        var entry = Assert.Single(catalog.Items);
        Assert.Equal("url-shortener", entry.Slug);
        Assert.Equal(["s1-baseline", "s2-viral", "s3-outage"], entry.StageIds);
        Assert.Equal("decision", entry.Exercises["id-generation"].Kind);
        Assert.Contains("counter-base62", entry.Exercises["id-generation"].OptionIds);
        Assert.Contains("s2-cache", entry.HintIds);
        Assert.False(Directory.Exists(Path.Combine(ShippedContent, "url-shortener", "solutions")));
    }

    [Fact]
    public void Fails_with_every_problem_listed_when_content_is_broken()
    {
        var dir = CopyOfShipped();
        File.Delete(Path.Combine(dir, "s2-viral.md"));
        File.Delete(Path.Combine(dir, "starter.json"));
        Directory.Move(dir, Path.Combine(_root, "renamed"));

        var error = Assert.Throws<ChallengeContentException>(() => ChallengeCatalog.Load(_root));

        Assert.Contains(error.Problems, p => p.Contains("slug \"url-shortener\" must match the folder name", StringComparison.Ordinal));
        Assert.Contains(error.Problems, p => p.Contains("brief \"s2-viral.md\" is missing", StringComparison.Ordinal));
        Assert.Contains(error.Problems, p => p.Contains("starter file \"starter.json\" is missing", StringComparison.Ordinal));
        Assert.StartsWith("Challenge content is invalid:", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Fails_when_a_definition_breaks_the_schema()
    {
        var dir = CopyOfShipped();
        var file = Path.Combine(dir, "challenge.json");
        File.WriteAllText(file, File.ReadAllText(file).Replace("\"difficulty\": \"beginner\"", "\"difficulty\": \"impossible\"", StringComparison.Ordinal));

        var error = Assert.Throws<ChallengeContentException>(() => ChallengeCatalog.Load(_root));

        Assert.Contains(error.Problems, p => p.Contains("/difficulty", StringComparison.Ordinal));
    }

    [Fact]
    public void Fails_on_invalid_json_and_on_a_missing_folder()
    {
        var dir = CopyOfShipped();
        File.WriteAllText(Path.Combine(dir, "challenge.json"), "{ not json");
        Assert.Contains(Assert.Throws<ChallengeContentException>(() => ChallengeCatalog.Load(_root)).Problems,
            p => p.Contains("not valid JSON", StringComparison.Ordinal));

        Assert.Throws<ChallengeContentException>(() => ChallengeCatalog.Load(Path.Combine(_root, "nowhere")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
