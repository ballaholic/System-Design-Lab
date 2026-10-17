using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Common;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;
using SystemDesignLab.Api.Infrastructure.Web;

namespace SystemDesignLab.Api.Features.Architectures;

public sealed record SnapshotSummary(Guid Id, string Label, DateTimeOffset CreatedAt, int NodeCount);

public sealed record SnapshotListResponse(IReadOnlyList<SnapshotSummary> Items);

/// <summary>
/// Checkpoints of a design (DATA_MODEL §5): listed and created here, restored in a later phase. Owner-scoped
/// through the design: another user's design is 404.
/// </summary>
public static class SnapshotsEndpoints
{
    private const long BodyLimit = 512 * 1024;

    public static RouteGroupBuilder MapSnapshotsEndpoints(this RouteGroupBuilder architectures)
    {
        architectures.MapGet("/{id:guid}/snapshots", List).WithName("ListSnapshots");
        architectures.MapPost("/{id:guid}/snapshots", Create).WithName("CreateSnapshot").WithRequestBodyLimit(BodyLimit);
        return architectures;
    }

    private static async Task<Results<Ok<SnapshotListResponse>, ProblemHttpResult>> List(
        Guid id, CurrentUser user, AppDbContext db, CancellationToken ct)
    {
        if (!await db.Architectures.AnyAsync(a => a.Id == id && a.OwnerId == user.Id, ct)) return NotFound();
        var items = await db.ArchitectureSnapshots.AsNoTracking()
            .Where(s => s.ArchitectureId == id)
            .OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id)
            .Select(s => new SnapshotSummary(s.Id, s.Label, s.CreatedAt, s.NodeCount))
            .ToListAsync(ct);
        return TypedResults.Ok(new SnapshotListResponse(items));
    }

    private static async Task<Results<Created<SnapshotSummary>, ValidationProblem, ProblemHttpResult>> Create(
        Guid id, JsonElement body, CurrentUser user, AppDbContext db, ArchitectureDocumentValidator validator,
        TimeProvider clock, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object)
            return Invalid(new() { ["body"] = ["The body must be a JSON object."] });

        var errors = new Dictionary<string, string[]>();
        var label = body.TryGetProperty("label", out var labelElement) && labelElement.ValueKind == JsonValueKind.String
            ? labelElement.GetString()!.Trim()
            : "";
        if (label.Length == 0) errors["label"] = ["Label is required."];
        else if (label.Length > ArchitectureSnapshot.MaxLabelLength)
            errors["label"] = [$"Label must be at most {ArchitectureSnapshot.MaxLabelLength} characters."];
        else if (label.Any(char.IsControl)) errors["label"] = ["Label cannot contain control characters."];

        DocumentCheck? check = null;
        if (body.TryGetProperty("document", out var document) && document.ValueKind != JsonValueKind.Null)
        {
            check = validator.Check(document);
            if (check.TooLarge)
            {
                return TypedResults.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    title: "The design is too large.",
                    detail: $"A design can be at most {ArchitectureDocumentValidator.MaxDocumentBytes / 1024} KB.",
                    type: ProblemTypes.DocumentTooLarge);
            }
            if (!check.IsValid) errors["document"] = check.Errors;
        }

        var architecture = await db.Architectures.AsNoTracking()
            .Where(a => a.Id == id && a.OwnerId == user.Id)
            .Select(a => new { a.Document, a.NodeCount })
            .SingleOrDefaultAsync(ct);
        if (architecture is null) return NotFound();
        if (errors.Count > 0) return Invalid(errors);

        var now = clock.GetUtcNow();
        var snapshot = new ArchitectureSnapshot
        {
            Id = Guid.CreateVersion7(),
            ArchitectureId = id,
            Label = label,
            Document = check?.Raw ?? architecture.Document,
            NodeCount = check?.NodeCount ?? architecture.NodeCount,
            CreatedAt = now.AddTicks(-(now.Ticks % 10)),
        };

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.ArchitectureSnapshots.Add(snapshot);
        await db.SaveChangesAsync(ct);
        // Keep the newest snapshots only (DATA_MODEL §4.2), in the same transaction as the insert.
        await db.ArchitectureSnapshots
            .Where(s => s.ArchitectureId == id)
            .OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id)
            .Skip(ArchitectureSnapshot.RetainedPerArchitecture)
            .ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Created(
            $"/api/architectures/{id}/snapshots/{snapshot.Id}",
            new SnapshotSummary(snapshot.Id, snapshot.Label, snapshot.CreatedAt, snapshot.NodeCount));
    }

    private static ValidationProblem Invalid(Dictionary<string, string[]> errors) =>
        TypedResults.ValidationProblem(errors, title: "The snapshot is invalid.", type: ProblemTypes.Validation);

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Design not found.", type: ProblemTypes.NotFound);
}
