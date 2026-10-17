using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SystemDesignLab.Api.Common;
using SystemDesignLab.Api.Features.Challenges;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;

namespace SystemDesignLab.Api.Features.Attempts;

public sealed record AttemptResponse(
    Guid Id,
    string ChallengeSlug,
    int ChallengeVersion,
    string Mode,
    string Status,
    string CurrentStageId,
    Guid? ArchitectureId,
    JsonElement StageResults,
    JsonElement ExerciseAnswers,
    IReadOnlyList<string> HintsRevealed,
    DateTimeOffset StartedAt,
    DateTimeOffset LastActivityAt,
    DateTimeOffset? CompletedAt)
{
    public static AttemptResponse From(ChallengeAttempt a) =>
        new(a.Id, a.ChallengeSlug, a.ChallengeVersion, a.Mode, a.Status, a.CurrentStageId, a.ArchitectureId,
            Parse(a.StageResults), Parse(a.ExerciseAnswers), a.HintsRevealed, a.StartedAt, a.LastActivityAt, a.CompletedAt);

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

public sealed record AttemptListResponse(IReadOnlyList<AttemptResponse> Items);

public sealed record CreateAttemptRequest(string? ChallengeSlug, string? Mode, Guid? ArchitectureId, bool? Restart);

/// <summary>
/// Challenge attempts (DATA_MODEL §5). Owner-scoped: another user's attempt is always 404. At most one attempt per
/// challenge is in progress, enforced by a partial unique index; starting again requires <c>restart: true</c>.
/// </summary>
public static class AttemptsEndpoints
{
    public const int MaxListSize = 100;

    public static RouteGroupBuilder MapAttemptsEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/attempts").WithTags("Attempts");
        group.MapGet("/", List).WithName("ListAttempts");
        group.MapGet("/{id:guid}", Get).WithName("GetAttempt");
        group.MapPost("/", Create).WithName("CreateAttempt");
        group.MapPatch("/{id:guid}", Update).WithName("UpdateAttempt");
        return api;
    }

    private static async Task<Results<Ok<AttemptListResponse>, ValidationProblem>> List(
        CurrentUser user, AppDbContext db, string? status, CancellationToken ct)
    {
        if (status is not null && !AttemptStatuses.All.Contains(status))
            return Invalid(new() { ["status"] = ["Status must be in_progress, completed or abandoned."] }, "The list request is invalid.");

        var query = db.Attempts.AsNoTracking().Where(a => a.UserId == user.Id);
        if (status is not null) query = query.Where(a => a.Status == status);
        var items = await query.OrderByDescending(a => a.LastActivityAt).ThenByDescending(a => a.Id).Take(MaxListSize).ToListAsync(ct);
        return TypedResults.Ok(new AttemptListResponse(items.Select(AttemptResponse.From).ToList()));
    }

    private static async Task<Results<Ok<AttemptResponse>, ProblemHttpResult>> Get(Guid id, CurrentUser user, AppDbContext db, CancellationToken ct)
    {
        var attempt = await db.Attempts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id && a.UserId == user.Id, ct);
        return attempt is null ? NotFound() : TypedResults.Ok(AttemptResponse.From(attempt));
    }

    private static async Task<Results<Created<AttemptResponse>, ValidationProblem, ProblemHttpResult>> Create(
        CreateAttemptRequest request, CurrentUser user, AppDbContext db, ChallengeCatalog catalog, TimeProvider clock, CancellationToken ct)
    {
        // Interview mode is the AI interviewer, which needs a verified email (PRD CH-8).
        if (request.Mode == AttemptModes.Interview && user.EmailVerified != true)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Verify your email to use Interview mode.",
                detail: "Interview mode uses the AI mentor, which needs a verified email.",
                type: ProblemTypes.EmailNotVerified);
        }

        var errors = new Dictionary<string, string[]>();
        var challenge = request.ChallengeSlug is null ? null : catalog.Find(request.ChallengeSlug);
        if (challenge is null) errors["challengeSlug"] = ["Unknown challenge."];
        if (request.Mode is not (AttemptModes.Guided or AttemptModes.Interview)) errors["mode"] = ["Mode must be \"guided\" or \"interview\"."];
        if (request.ArchitectureId is { } architectureId && !await OwnsArchitecture(db, user.Id, architectureId, ct))
            errors["architectureId"] = ["Design not found."];
        if (errors.Count > 0) return Invalid(errors, "The attempt is invalid.");

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var existing = await db.Attempts
            .SingleOrDefaultAsync(a => a.UserId == user.Id && a.ChallengeSlug == challenge!.Slug && a.Status == AttemptStatuses.InProgress, ct);
        var now = Now(clock);
        if (existing is not null)
        {
            if (request.Restart != true) return InProgress(existing.Id);
            existing.Status = AttemptStatuses.Abandoned;
            existing.LastActivityAt = now;
            await db.SaveChangesAsync(ct);
        }

        var attempt = new ChallengeAttempt
        {
            Id = Guid.CreateVersion7(),
            UserId = user.Id,
            ChallengeSlug = challenge!.Slug,
            ChallengeVersion = challenge.Version,
            Mode = request.Mode!,
            Status = AttemptStatuses.InProgress,
            CurrentStageId = challenge.StageIds[0],
            ArchitectureId = request.ArchitectureId,
            StartedAt = now,
            LastActivityAt = now,
        };
        db.Attempts.Add(attempt);
        try
        {
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (IsInProgressConflict(ex))
        {
            // Another request started an attempt between our check and insert.
            await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var winner = await db.Attempts.AsNoTracking()
                .Where(a => a.UserId == user.Id && a.ChallengeSlug == challenge.Slug && a.Status == AttemptStatuses.InProgress)
                .Select(a => a.Id)
                .SingleAsync(ct);
            return InProgress(winner);
        }
        return TypedResults.Created($"/api/attempts/{attempt.Id}", AttemptResponse.From(attempt));
    }

    private static async Task<Results<Ok<AttemptResponse>, ValidationProblem, ProblemHttpResult>> Update(
        Guid id, JsonElement body, CurrentUser user, AppDbContext db, ChallengeCatalog catalog, TimeProvider clock, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object)
            return Invalid(new() { ["body"] = ["The body must be a JSON object."] }, "The request is invalid.");

        var attempt = await db.Attempts.SingleOrDefaultAsync(a => a.Id == id && a.UserId == user.Id, ct);
        if (attempt is null) return NotFound();
        if (attempt.Status != AttemptStatuses.InProgress)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "This attempt is no longer in progress.",
                type: ProblemTypes.AttemptNotInProgress);
        }
        var challenge = catalog.Find(attempt.ChallengeSlug);
        if (challenge is null)
            return Invalid(new() { ["challengeSlug"] = ["This challenge is no longer available."] }, "The update is invalid.");

        var errors = new Dictionary<string, string[]>();
        if (body.TryGetProperty("currentStageId", out var stage))
        {
            var stageId = stage.ValueKind == JsonValueKind.String ? stage.GetString() : null;
            AttemptValidation.StageId(stageId, challenge, "currentStageId", errors);
            if (stageId is not null && !errors.ContainsKey("currentStageId")) attempt.CurrentStageId = stageId;
        }
        if (body.TryGetProperty("stageResults", out var results)
            && AttemptValidation.StageResults(results, challenge, "stageResults", errors) is { } stageResults)
            attempt.StageResults = stageResults;
        if (body.TryGetProperty("exerciseAnswers", out var answers)
            && AttemptValidation.ExerciseAnswers(answers, challenge, "exerciseAnswers", errors) is { } exerciseAnswers)
            attempt.ExerciseAnswers = exerciseAnswers;
        if (body.TryGetProperty("hintsRevealed", out var hints)
            && AttemptValidation.Hints(hints, challenge, "hintsRevealed", errors) is { } hintIds)
            attempt.HintsRevealed = hintIds;
        if (body.TryGetProperty("architectureId", out var architecture))
        {
            if (architecture.ValueKind == JsonValueKind.Null) attempt.ArchitectureId = null;
            else if (architecture.ValueKind == JsonValueKind.String && architecture.TryGetGuid(out var architectureId)
                     && await OwnsArchitecture(db, user.Id, architectureId, ct))
                attempt.ArchitectureId = architectureId;
            else errors["architectureId"] = ["Design not found."];
        }
        var now = Now(clock);
        if (body.TryGetProperty("status", out var status))
        {
            var value = status.ValueKind == JsonValueKind.String ? status.GetString() : null;
            if (value == AttemptStatuses.Completed)
            {
                attempt.Status = AttemptStatuses.Completed;
                attempt.CompletedAt = now;
            }
            else if (value == AttemptStatuses.Abandoned) attempt.Status = AttemptStatuses.Abandoned;
            else if (value != AttemptStatuses.InProgress) errors["status"] = ["Status can only change to completed or abandoned."];
        }
        if (errors.Count > 0) return Invalid(errors, "The update is invalid.");

        attempt.LastActivityAt = now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(AttemptResponse.From(attempt));
    }

    internal static Task<bool> OwnsArchitecture(AppDbContext db, Guid userId, Guid architectureId, CancellationToken ct) =>
        db.Architectures.AnyAsync(a => a.Id == architectureId && a.OwnerId == userId, ct);

    internal static bool IsInProgressConflict(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg
        && pg.ConstraintName == "ux_challenge_attempts_in_progress";

    /// <summary>PostgreSQL stores microseconds, so responses match what a later read returns.</summary>
    internal static DateTimeOffset Now(TimeProvider clock)
    {
        var now = clock.GetUtcNow();
        return now.AddTicks(-(now.Ticks % 10));
    }

    private static ProblemHttpResult InProgress(Guid attemptId) =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "An attempt at this challenge is already in progress.",
            detail: "Resume it, or start again with restart: true to abandon it.",
            type: ProblemTypes.AttemptInProgress,
            extensions: new Dictionary<string, object?> { ["attemptId"] = attemptId });

    private static ValidationProblem Invalid(Dictionary<string, string[]> errors, string title) =>
        TypedResults.ValidationProblem(errors, title: title, type: ProblemTypes.Validation);

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Attempt not found.", type: ProblemTypes.NotFound);
}
