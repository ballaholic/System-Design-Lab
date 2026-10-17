using System.Text.Json;

namespace SystemDesignLab.Api.Features.Architectures;

public sealed record ArchitectureResponse(
    Guid Id,
    string Title,
    string? Description,
    string? ChallengeSlug,
    JsonElement Document,
    int Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static ArchitectureResponse From(Architecture a)
    {
        using var parsed = JsonDocument.Parse(a.Document);
        return new(a.Id, a.Title, a.Description, a.ChallengeSlug, parsed.RootElement.Clone(), a.Version, a.CreatedAt, a.UpdatedAt);
    }
}

public sealed record ArchitectureSummary(
    Guid Id,
    string Title,
    string? Description,
    string? ChallengeSlug,
    int NodeCount,
    int Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ArchitectureListResponse(IReadOnlyList<ArchitectureSummary> Items, string? NextCursor);

public sealed record CreateArchitectureRequest(string? Title, string? Description, JsonElement Document, string? ChallengeSlug);

public sealed record UpdateArchitectureRequest(JsonElement Document);

public sealed record ImportDesign(Guid ImportKey, string? Title, string? Description, JsonElement Document, string? ChallengeSlug);

/// <summary>A guest challenge attempt, imported with the guest's designs. Progress fields are validated like PATCH.</summary>
public sealed record ImportAttempt(
    Guid ImportKey,
    string? ChallengeSlug,
    int ChallengeVersion,
    string? Mode,
    string? Status,
    string? CurrentStageId,
    Guid? ArchitectureImportKey,
    JsonElement StageResults,
    JsonElement ExerciseAnswers,
    JsonElement HintsRevealed,
    DateTimeOffset StartedAt,
    DateTimeOffset LastActivityAt,
    DateTimeOffset? CompletedAt);

public sealed record ImportRequest(IReadOnlyList<ImportDesign>? Designs, IReadOnlyList<ImportAttempt>? Attempts);

public sealed record ImportResult(Guid ImportKey, Guid Id, bool Created);

public sealed record ImportResponse(IReadOnlyList<ImportResult> Results, IReadOnlyList<ImportResult> AttemptResults);
