using System.Text.Json;
using System.Text.Json.Serialization;
using SystemDesignLab.Api.Features.Architectures;

namespace SystemDesignLab.Api.Features.Mentor;

public sealed record CreateConversationRequest(string? Mode, Guid? ArchitectureId, Guid? AttemptId);

public sealed record UpdateConversationRequest(string? Title, string? Step);

/// <param name="Architecture">The current, possibly unsaved, design. Required for the Reviewer.</param>
/// <param name="Simulation">The latest valid simulation of that design (<c>MentorSimulation</c> in @sdl/simulation).</param>
public sealed record SendMessageRequest(string? Content, JsonElement? Architecture, JsonElement? Simulation);

public sealed record ConversationResponse(
    Guid Id,
    string Mode,
    string Title,
    Guid? ArchitectureId,
    Guid? AttemptId,
    JsonElement Metadata,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static ConversationResponse From(AiConversation c) =>
        new(c.Id, c.Mode, c.Title, c.ArchitectureId, c.AttemptId, MentorJson.Parse(c.Metadata), c.CreatedAt, c.UpdatedAt);
}

public sealed record ConversationListResponse(IReadOnlyList<ConversationResponse> Items);

public sealed record MessageResponse(
    Guid Id,
    string Role,
    string Content,
    ReviewResult? Review,
    string Status,
    DateTimeOffset CreatedAt)
{
    public static MessageResponse From(AiMessage m) =>
        new(m.Id, m.Role, m.Content, m.Findings is null ? null : JsonSerializer.Deserialize<ReviewResult>(m.Findings, MentorJson.Options),
            m.Status, m.CreatedAt);
}

public sealed record ConversationDetailResponse(ConversationResponse Conversation, IReadOnlyList<MessageResponse> Messages);

/// <param name="Available">The mentor is switched on and configured.</param>
/// <param name="RemainingPercent">Share of today's budget left (ARCHITECTURE §8.4 shows a percentage, not dollars).</param>
public sealed record QuotaResponse(bool Available, bool EmailVerified, int RemainingPercent, DateTimeOffset ResetsAt);

// ---- Reviewer structured output (ARCHITECTURE §8.2) ----

public sealed record ReviewResult(string Summary, IReadOnlyList<ReviewFinding> Findings);

public sealed record ReviewFinding(
    string Id,
    string Category,
    string Severity,
    string Confidence,
    IReadOnlyList<string> NodeIds,
    string Title,
    string Explanation,
    string Suggestion);

// ---- Simulation context: mirrors MentorSimulation in packages/simulation/src/mentor.ts ----

public sealed record MentorSimulationContext(
    string EngineVersion,
    string InputHash,
    TrafficContext Traffic,
    IReadOnlyList<FailureContext> Failures,
    SummaryContext Summary,
    IReadOnlyDictionary<string, OperationContext> Operations,
    IReadOnlyDictionary<string, NodeContext> Nodes,
    CapacityContext Capacity,
    IReadOnlyList<EventContext> Events,
    IReadOnlyList<string> Assumptions);

public sealed record TrafficContext(double TotalRps, IReadOnlyDictionary<string, double>? Mix = null);

public sealed record FailureContext(string Kind, string NodeId, int? Count = null);

public sealed record SummaryContext(double Offered, double ProcessingSucceeded, double ProcessingSuccessRate, IReadOnlyList<BottleneckContext> Bottlenecks);

public sealed record BottleneckContext(string NodeId, string Resource, double Utilization);

public sealed record OperationContext(double Offered, double ProcessingSuccessRate);

public sealed record NodeContext(
    string Status,
    IReadOnlyList<string> Explanation,
    double? Utilization = null,
    double? Headroom = null,
    double? EffectiveHitRate = null,
    double? BacklogGrowthPerSec = null);

public sealed record CapacityContext(
    double? BreakingPointRps,
    IReadOnlyDictionary<string, int> InstancesNeeded,
    double TargetUtilization,
    SaturationContext? FirstSaturation = null);

public sealed record SaturationContext(string NodeId, string Resource);

public sealed record EventContext(string Kind, string Message, IReadOnlyList<string> NodeIds);

public static class MentorJson
{
    /// <summary>Strict: unknown properties and missing required ones (constructor parameters without a default) are errors, so only the agreed shape reaches a prompt.</summary>
    public static readonly JsonSerializerOptions Strict = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

/// <summary>A request's context after validation: the design as compact JSON and the simulation, if any.</summary>
public sealed record ValidatedContext(string? ArchitectureJson, IReadOnlySet<string> NodeIds, string? ArchitectureHash, MentorSimulationContext? Simulation);

/// <summary>Checks the untrusted context a client sends with a message (ARCHITECTURE §8.1 step 4).</summary>
public static class MentorContextValidator
{
    public const int MaxSimulationBytes = 128 * 1024;
    private const int MaxNodes = 200;
    private const int MaxEvents = 20;
    private const int MaxExplanationLines = 12;
    private const int MaxTextLength = 500;

    public static ValidatedContext? Validate(SendMessageRequest request, Dictionary<string, string[]> errors)
    {
        string? architectureJson = null;
        string? architectureHash = null;
        var nodeIds = new HashSet<string>(StringComparer.Ordinal);
        if (request.Architecture is { ValueKind: not JsonValueKind.Null } architecture)
        {
            var check = ArchitectureDocumentValidator.Shared.Check(architecture);
            if (!check.IsValid) errors["architecture"] = check.Errors;
            else
            {
                foreach (var node in architecture.GetProperty("nodes").EnumerateArray())
                    nodeIds.Add(node.GetProperty("id").GetString()!);
                architectureJson = CompactArchitecture(architecture);
                architectureHash = Hash(check.Raw);
            }
        }

        MentorSimulationContext? simulation = null;
        if (request.Simulation is { ValueKind: not JsonValueKind.Null } raw)
        {
            if (raw.ValueKind != JsonValueKind.Object || raw.GetRawText().Length > MaxSimulationBytes)
                errors["simulation"] = [$"The simulation must be a JSON object of at most {MaxSimulationBytes / 1024} KB."];
            else
            {
                try
                {
                    simulation = raw.Deserialize<MentorSimulationContext>(MentorJson.Strict);
                    if (simulation is not null && Problem(simulation, nodeIds, architectureJson is not null) is { } problem)
                    {
                        errors["simulation"] = [problem];
                        simulation = null;
                    }
                }
                catch (JsonException ex)
                {
                    errors["simulation"] = [$"The simulation doesn't have the expected shape ({ex.Path ?? "$"})."];
                }
            }
        }
        return errors.Count > 0 ? null : new ValidatedContext(architectureJson, nodeIds, architectureHash, simulation);
    }

    private static string? Problem(MentorSimulationContext s, HashSet<string> nodeIds, bool hasArchitecture)
    {
        if (s.Nodes.Count > MaxNodes) return "The simulation lists too many components.";
        if (s.Events.Count > MaxEvents) return $"The simulation may list at most {MaxEvents} events.";
        if (hasArchitecture && s.Nodes.Keys.Any(id => !nodeIds.Contains(id)))
            return "The simulation refers to components that aren't in the design.";
        var texts = s.Nodes.Values.SelectMany(n => n.Explanation).Concat(s.Events.Select(e => e.Message)).ToList();
        if (s.Nodes.Values.Any(n => n.Explanation.Count > MaxExplanationLines) || texts.Any(t => t.Length > MaxTextLength))
            return "The simulation's explanations are too long.";
        return null;
    }

    /// <summary>The design without presentation fields (layout, connection sides), which the mentor doesn't need.</summary>
    private static string CompactArchitecture(JsonElement architecture)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(architecture.GetRawText())!.AsObject();
        node.Remove("layout");
        node.Remove("edgeLayout");
        return node.ToJsonString();
    }

    private static string Hash(string raw) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)))[..16];
}
