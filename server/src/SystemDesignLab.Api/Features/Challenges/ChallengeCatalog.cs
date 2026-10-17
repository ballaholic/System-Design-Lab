using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace SystemDesignLab.Api.Features.Challenges;

public sealed class ChallengeCatalogOptions
{
    public const string Section = "Challenges";

    /// <summary>Folder holding one sub-folder per challenge. Defaults to the content copied next to the API.</summary>
    public string? ContentPath { get; init; }

    public string ResolvedContentPath =>
        string.IsNullOrWhiteSpace(ContentPath) ? Path.Combine(AppContext.BaseDirectory, "content", "challenges") : ContentPath;
}

/// <summary>Thrown at startup when challenge content is invalid, listing every problem found.</summary>
public sealed class ChallengeContentException(IReadOnlyList<string> problems)
    : Exception("Challenge content is invalid:" + Environment.NewLine + string.Join(Environment.NewLine, problems.Select(p => "  - " + p)))
{
    public IReadOnlyList<string> Problems { get; } = problems;
}

/// <summary>One exercise, as far as the API needs to know it to validate answers.</summary>
public sealed record ChallengeExercise(string Id, string Kind, IReadOnlySet<string> OptionIds);

/// <summary>A loaded challenge: the JSON served to clients and the ids used to validate attempts.</summary>
public sealed class ChallengeEntry
{
    public required string Slug { get; init; }
    public required int Version { get; init; }
    public required int Order { get; init; }

    /// <summary>The catalog list item.</summary>
    public required JsonObject Summary { get; init; }

    /// <summary>The definition as authored, plus each stage's <c>briefMd</c> and a top-level <c>starter</c>.</summary>
    public required string DetailJson { get; init; }

    public required IReadOnlyList<string> StageIds { get; init; }
    public required IReadOnlyDictionary<string, ChallengeExercise> Exercises { get; init; }
    public required IReadOnlySet<string> HintIds { get; init; }
}

/// <summary>
/// Challenge definitions are repo content (ADR-008), loaded once at startup and validated against the JSON Schema
/// generated from <c>@sdl/challenges</c>. The API serves them anonymously and uses them to check attempts' shape
/// (ADR-010). Deeper checks (solvable stages, criteria references) run in the TypeScript content check in CI.
/// </summary>
public sealed class ChallengeCatalog
{
    private const string SchemaResource = "challenge.schema.json";
    private readonly Dictionary<string, ChallengeEntry> _bySlug;

    public ChallengeCatalog(IEnumerable<ChallengeEntry> entries)
    {
        Items = entries.OrderBy(e => e.Order).ThenBy(e => e.Slug, StringComparer.Ordinal).ToList();
        _bySlug = Items.ToDictionary(e => e.Slug, StringComparer.Ordinal);
    }

    public IReadOnlyList<ChallengeEntry> Items { get; }

    public ChallengeEntry? Find(string slug) => _bySlug.GetValueOrDefault(slug);

    /// <summary>Loads every <c>&lt;slug&gt;/challenge.json</c> under <paramref name="contentPath"/>; throws on any problem.</summary>
    public static ChallengeCatalog Load(string contentPath)
    {
        var problems = new List<string>();
        var entries = new List<ChallengeEntry>();
        if (!Directory.Exists(contentPath))
            throw new ChallengeContentException([$"The content folder \"{contentPath}\" doesn't exist."]);

        var schema = LoadSchema();
        foreach (var dir in Directory.GetDirectories(contentPath).Order(StringComparer.Ordinal))
        {
            var folder = Path.GetFileName(dir);
            var entry = LoadOne(dir, folder, schema, problems);
            if (entry is not null) entries.Add(entry);
        }
        if (entries.Count == 0 && problems.Count == 0) problems.Add($"No challenges found in \"{contentPath}\".");
        if (problems.Count > 0) throw new ChallengeContentException(problems);
        return new ChallengeCatalog(entries);
    }

    private static JsonSchema LoadSchema()
    {
        using var stream = typeof(ChallengeCatalog).Assembly.GetManifestResourceStream(SchemaResource)
            ?? throw new InvalidOperationException($"Embedded resource {SchemaResource} is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return JsonSchema.FromText(reader.ReadToEnd(), new BuildOptions { SchemaRegistry = new SchemaRegistry() });
    }

    private static ChallengeEntry? LoadOne(string dir, string folder, JsonSchema schema, List<string> problems)
    {
        var file = Path.Combine(dir, "challenge.json");
        if (!File.Exists(file))
        {
            problems.Add($"{folder}: challenge.json is missing.");
            return null;
        }

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(File.ReadAllText(file, Encoding.UTF8));
        }
        catch (JsonException ex)
        {
            problems.Add($"{folder}/challenge.json: not valid JSON ({ex.Message}).");
            return null;
        }
        if (root is not JsonObject definition)
        {
            problems.Add($"{folder}/challenge.json: must be a JSON object.");
            return null;
        }

        using (var parsed = JsonDocument.Parse(definition.ToJsonString()))
        {
            var result = schema.Evaluate(parsed.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List });
            if (!result.IsValid)
            {
                var errors = (result.Details ?? [])
                    .Where(d => d.Errors is { Count: > 0 })
                    .SelectMany(d => d.Errors!.Select(e => $"{folder}/challenge.json {d.InstanceLocation}: {e.Value}"))
                    .Distinct()
                    .Take(10)
                    .ToList();
                problems.AddRange(errors.Count > 0 ? errors : [$"{folder}/challenge.json doesn't match the challenge schema."]);
                return null;
            }
        }

        var slug = definition["slug"]!.GetValue<string>();
        var start = problems.Count;
        if (slug != folder) problems.Add($"{folder}/challenge.json: slug \"{slug}\" must match the folder name.");

        var detail = (JsonObject)definition.DeepClone();
        JsonNode? starter = null;
        if (definition["starterArchitecture"]?.GetValue<string>() is { } starterFile)
        {
            var path = Path.Combine(dir, starterFile);
            if (!File.Exists(path)) problems.Add($"{folder}: starter file \"{starterFile}\" is missing.");
            else
            {
                try
                {
                    starter = JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8));
                }
                catch (JsonException ex)
                {
                    problems.Add($"{folder}/{starterFile}: not valid JSON ({ex.Message}).");
                }
            }
        }
        detail["starter"] = starter;

        var stageIds = new List<string>();
        var exercises = new Dictionary<string, ChallengeExercise>(StringComparer.Ordinal);
        var hints = new HashSet<string>(StringComparer.Ordinal);
        var stageSummaries = new JsonArray();
        foreach (var stageNode in detail["stages"]!.AsArray())
        {
            var stage = stageNode!.AsObject();
            var id = stage["id"]!.GetValue<string>();
            stageIds.Add(id);
            stageSummaries.Add(new JsonObject { ["id"] = id, ["title"] = stage["title"]!.GetValue<string>() });

            var brief = stage["brief"]!.GetValue<string>();
            var briefPath = Path.Combine(dir, brief);
            if (!File.Exists(briefPath)) problems.Add($"{folder}: stage \"{id}\" brief \"{brief}\" is missing.");
            else stage["briefMd"] = File.ReadAllText(briefPath, Encoding.UTF8);

            foreach (var exerciseNode in stage["exercises"]?.AsArray() ?? [])
            {
                var exercise = exerciseNode!.AsObject();
                var exerciseId = exercise["id"]!.GetValue<string>();
                var options = (exercise["options"]?.AsArray() ?? [])
                    .Select(o => o!["id"]!.GetValue<string>())
                    .ToHashSet(StringComparer.Ordinal);
                if (!exercises.TryAdd(exerciseId, new ChallengeExercise(exerciseId, exercise["kind"]!.GetValue<string>(), options)))
                    problems.Add($"{folder}: duplicate exercise id \"{exerciseId}\".");
            }
            foreach (var hint in stage["hints"]!.AsArray())
            {
                var hintId = hint!["id"]!.GetValue<string>();
                if (!hints.Add(hintId)) problems.Add($"{folder}: duplicate hint id \"{hintId}\".");
            }
        }
        if (stageIds.Distinct(StringComparer.Ordinal).Count() != stageIds.Count) problems.Add($"{folder}: duplicate stage ids.");
        if (problems.Count > start) return null;

        var summary = new JsonObject
        {
            ["slug"] = slug,
            ["version"] = definition["version"]!.GetValue<int>(),
            ["title"] = definition["title"]!.DeepClone(),
            ["summary"] = definition["summary"]!.DeepClone(),
            ["difficulty"] = definition["difficulty"]!.DeepClone(),
            ["topics"] = definition["topics"]!.DeepClone(),
            ["order"] = definition["order"]!.GetValue<int>(),
            ["stageCount"] = stageIds.Count,
            ["stages"] = stageSummaries,
        };

        return new ChallengeEntry
        {
            Slug = slug,
            Version = definition["version"]!.GetValue<int>(),
            Order = definition["order"]!.GetValue<int>(),
            Summary = summary,
            DetailJson = detail.ToJsonString(),
            StageIds = stageIds,
            Exercises = exercises,
            HintIds = hints,
        };
    }
}
