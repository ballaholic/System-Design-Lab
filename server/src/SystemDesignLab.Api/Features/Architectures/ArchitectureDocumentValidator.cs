using System.Text;
using System.Text.Json;
using Json.Schema;

namespace SystemDesignLab.Api.Features.Architectures;

/// <summary>
/// Validates architecture documents against the JSON Schema generated from the TypeScript model
/// (<c>schemas/architecture.schema.json</c>, embedded at build time). The server accepts only the current
/// schema version on write; clients migrate older documents on load (ARCHITECTURE §4).
/// </summary>
public sealed class ArchitectureDocumentValidator
{
    /// <summary>PRD PG-11: at most 256 KB of UTF-8 JSON per document.</summary>
    public const int MaxDocumentBytes = 256 * 1024;

    private const int MaxReportedErrors = 5;
    private const string ResourceName = "architecture.schema.json";

    private static readonly Lazy<ArchitectureDocumentValidator> SharedInstance = new(() => new ArchitectureDocumentValidator());

    private readonly JsonSchema _schema;

    private ArchitectureDocumentValidator()
    {
        using var stream = typeof(ArchitectureDocumentValidator).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        // A private registry, so building the schema never collides with another instance in the global registry.
        _schema = JsonSchema.FromText(reader.ReadToEnd(), new BuildOptions { SchemaRegistry = new SchemaRegistry() });
    }

    /// <summary>The schema is immutable, so one instance serves the whole process.</summary>
    public static ArchitectureDocumentValidator Shared => SharedInstance.Value;

    public DocumentCheck Check(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object)
            return DocumentCheck.Invalid(["The document must be a JSON object."]);

        var raw = document.GetRawText();
        if (Encoding.UTF8.GetByteCount(raw) > MaxDocumentBytes)
            return DocumentCheck.Invalid([$"The document is larger than {MaxDocumentBytes / 1024} KB."], tooLarge: true);

        var result = _schema.Evaluate(document, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!result.IsValid)
        {
            var errors = (result.Details ?? [])
                .Where(d => d.Errors is { Count: > 0 })
                .SelectMany(d => d.Errors!.Select(e => Describe(d.InstanceLocation.ToString(), e.Value)))
                .Distinct()
                .Take(MaxReportedErrors)
                .ToArray();
            return DocumentCheck.Invalid(errors.Length > 0 ? errors : ["The document doesn't match the architecture schema."]);
        }

        var nodeCount = document.TryGetProperty("nodes", out var nodes) ? nodes.GetArrayLength() : 0;
        var schemaVersion = document.GetProperty("schemaVersion").GetInt32();
        return DocumentCheck.Valid(raw, schemaVersion, nodeCount);
    }

    private static string Describe(string location, string message) =>
        string.IsNullOrEmpty(location) ? message : $"{location}: {message}";
}

public sealed record DocumentCheck(bool IsValid, bool TooLarge, string[] Errors, string Raw, int SchemaVersion, int NodeCount)
{
    public static DocumentCheck Valid(string raw, int schemaVersion, int nodeCount) => new(true, false, [], raw, schemaVersion, nodeCount);

    public static DocumentCheck Invalid(string[] errors, bool tooLarge = false) => new(false, tooLarge, errors, "", 0, 0);
}
