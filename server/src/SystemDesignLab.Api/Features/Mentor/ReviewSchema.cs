using System.Text.Json;

namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>The Reviewer's structured output (ARCHITECTURE §8.2): the schema sent to Claude and the server-side checks.</summary>
public static class ReviewSchema
{
    public const int MaxFindings = 6;

    public static readonly IReadOnlyList<string> Categories = ["capacity", "availability", "data-flow", "requirements", "simplicity", "other"];
    public static readonly IReadOnlyList<string> Levels = ["high", "medium", "low"];

    public static readonly IReadOnlyDictionary<string, JsonElement> Schema = BuildSchema();

    private static Dictionary<string, JsonElement> BuildSchema()
    {
        var finding = new
        {
            type = "object",
            properties = new Dictionary<string, object>
            {
                ["id"] = new { type = "string" },
                ["category"] = new { type = "string", @enum = Categories },
                ["severity"] = new { type = "string", @enum = Levels },
                ["confidence"] = new { type = "string", @enum = Levels },
                ["nodeIds"] = new { type = "array", items = new { type = "string" } },
                ["title"] = new { type = "string" },
                ["explanation"] = new { type = "string" },
                ["suggestion"] = new { type = "string" },
            },
            required = new[] { "id", "category", "severity", "confidence", "nodeIds", "title", "explanation", "suggestion" },
            additionalProperties = false,
        };
        var schema = new
        {
            type = "object",
            properties = new Dictionary<string, object>
            {
                ["summary"] = new { type = "string" },
                ["findings"] = new { type = "array", items = finding },
            },
            required = new[] { "summary", "findings" },
            additionalProperties = false,
        };
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(schema));
        return document.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
    }

    /// <summary>
    /// Parses the Reviewer's JSON. Node ids that aren't in the submitted design are dropped (the model can't
    /// highlight what doesn't exist), unknown categories become "other", and at most <see cref="MaxFindings"/> are kept.
    /// Returns null when the text isn't a review.
    /// </summary>
    public static ReviewResult? Parse(string json, IReadOnlySet<string> nodeIds)
    {
        ReviewResult? raw;
        try
        {
            raw = JsonSerializer.Deserialize<ReviewResult>(json, MentorJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
        if (raw is null || string.IsNullOrWhiteSpace(raw.Summary) || raw.Findings is null) return null;

        var findings = raw.Findings
            .Where(f => f is not null && !string.IsNullOrWhiteSpace(f.Title))
            .Take(MaxFindings)
            .Select((f, i) => f with
            {
                Id = $"f{i + 1}",
                Category = Categories.Contains(f.Category) ? f.Category : "other",
                Severity = Levels.Contains(f.Severity) ? f.Severity : "medium",
                Confidence = Levels.Contains(f.Confidence) ? f.Confidence : "medium",
                NodeIds = (f.NodeIds ?? []).Where(nodeIds.Contains).Distinct(StringComparer.Ordinal).ToList(),
                Explanation = f.Explanation ?? "",
                Suggestion = f.Suggestion ?? "",
            })
            .ToList();
        return new ReviewResult(raw.Summary.Trim(), findings);
    }
}
