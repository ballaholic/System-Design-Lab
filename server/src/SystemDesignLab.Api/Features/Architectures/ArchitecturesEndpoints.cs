using System.Buffers.Text;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Common;
using SystemDesignLab.Api.Features.Attempts;
using SystemDesignLab.Api.Features.Challenges;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;
using SystemDesignLab.Api.Infrastructure.Web;

namespace SystemDesignLab.Api.Features.Architectures;

/// <summary>
/// Owner-scoped CRUD for saved designs (DATA_MODEL §5). Another user's design is always 404, never 403 (AUTH-6).
/// Document updates use optimistic concurrency: <c>ETag</c> is the version and <c>PUT</c> requires <c>If-Match</c>.
/// </summary>
public static class ArchitecturesEndpoints
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;
    public const int MaxImportBatch = 10;

    // Body limits: one document is at most 256 KB, so 512 KB leaves room for JSON escaping and metadata.
    private const long SingleDocumentBodyLimit = 512 * 1024;
    private const long ImportBodyLimit = 3 * 1024 * 1024;

    public static IServiceCollection AddArchitecturesFeature(this IServiceCollection services) =>
        services.AddSingleton(_ => ArchitectureDocumentValidator.Shared);

    public static RouteGroupBuilder MapArchitecturesEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/architectures").WithTags("Architectures");
        group.MapGet("/", List).WithName("ListArchitectures");
        group.MapPost("/", Create).WithName("CreateArchitecture").WithRequestBodyLimit(SingleDocumentBodyLimit);
        group.MapPost("/import", Import).WithName("ImportArchitectures").WithRequestBodyLimit(ImportBodyLimit);
        group.MapGet("/{id:guid}", Get).WithName("GetArchitecture");
        group.MapPut("/{id:guid}", Update).WithName("UpdateArchitecture").WithRequestBodyLimit(SingleDocumentBodyLimit);
        group.MapPatch("/{id:guid}", Rename).WithName("RenameArchitecture").WithRequestBodyLimit(64 * 1024);
        group.MapDelete("/{id:guid}", Delete).WithName("DeleteArchitecture");
        group.MapPost("/{id:guid}/duplicate", Duplicate).WithName("DuplicateArchitecture");
        group.MapSnapshotsEndpoints();
        return api;
    }

    private static async Task<Results<Ok<ArchitectureListResponse>, ValidationProblem>> List(
        CurrentUser user, AppDbContext db, string? cursor, int? limit, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var pageSize = limit ?? DefaultPageSize;
        if (pageSize is < 1 or > MaxPageSize) errors["limit"] = [$"Limit must be between 1 and {MaxPageSize}."];
        var position = cursor is null ? null : ListCursor.TryDecode(cursor);
        if (cursor is not null && position is null) errors["cursor"] = ["The cursor is invalid."];
        if (errors.Count > 0) return Invalid(errors, "The list request is invalid.");

        var page = await ListQuery(db, user.Id, position, pageSize).ToListAsync(ct);
        var hasMore = page.Count > pageSize;
        if (hasMore) page.RemoveAt(page.Count - 1);
        var next = hasMore ? new ListCursor(page[^1].UpdatedAt, page[^1].Id).Encode() : null;
        return TypedResults.Ok(new ArchitectureListResponse(page, next));
    }

    /// <summary>Keyset pagination over (updated_at desc, id desc). Fetches one extra row to detect a next page.</summary>
    internal static IQueryable<ArchitectureSummary> ListQuery(AppDbContext db, Guid ownerId, ListCursor? position, int pageSize)
    {
        var query = db.Architectures.AsNoTracking().Where(a => a.OwnerId == ownerId);
        if (position is not null)
        {
            var (updatedAt, id) = (position.UpdatedAt, position.Id);
            query = query.Where(a => EF.Functions.LessThan(ValueTuple.Create(a.UpdatedAt, a.Id), ValueTuple.Create(updatedAt, id)));
        }
        return query
            .OrderByDescending(a => a.UpdatedAt)
            .ThenByDescending(a => a.Id)
            .Take(pageSize + 1)
            .Select(a => new ArchitectureSummary(a.Id, a.Title, a.Description, a.ChallengeSlug, a.NodeCount, a.Version, a.CreatedAt, a.UpdatedAt));
    }

    private static async Task<Results<Created<ArchitectureResponse>, ValidationProblem, ProblemHttpResult>> Create(
        CreateArchitectureRequest request, CurrentUser user, AppDbContext db, ArchitectureDocumentValidator validator,
        TimeProvider clock, HttpResponse response, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var title = ArchitectureInput.NormalizeTitle(request.Title);
        var description = ArchitectureInput.NormalizeDescription(request.Description);
        ArchitectureInput.ValidateTitle(title, "title", errors);
        ArchitectureInput.ValidateDescription(description, "description", errors);
        ArchitectureInput.ValidateChallengeSlug(request.ChallengeSlug, "challengeSlug", errors);
        var check = validator.Check(request.Document);
        if (check.TooLarge) return DocumentTooLarge();
        if (!check.IsValid) errors["document"] = check.Errors;
        if (errors.Count > 0) return Invalid(errors, "The design is invalid.");

        var now = Now(clock);
        var architecture = new Architecture
        {
            Id = Guid.CreateVersion7(),
            OwnerId = user.Id,
            Title = title,
            Description = description,
            Document = check.Raw,
            SchemaVersion = check.SchemaVersion,
            NodeCount = check.NodeCount,
            ChallengeSlug = request.ChallengeSlug,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Architectures.Add(architecture);
        await db.SaveChangesAsync(ct);

        response.Headers.ETag = ArchitectureInput.ETag(architecture.Version);
        return TypedResults.Created($"/api/architectures/{architecture.Id}", ArchitectureResponse.From(architecture));
    }

    private static async Task<Results<Ok<ArchitectureResponse>, ProblemHttpResult>> Get(
        Guid id, CurrentUser user, AppDbContext db, HttpResponse response, CancellationToken ct)
    {
        var architecture = await Find(db, id, user.Id, ct);
        if (architecture is null) return NotFound();
        response.Headers.ETag = ArchitectureInput.ETag(architecture.Version);
        return TypedResults.Ok(ArchitectureResponse.From(architecture));
    }

    private static async Task<Results<Ok<ArchitectureResponse>, ValidationProblem, ProblemHttpResult>> Update(
        Guid id, UpdateArchitectureRequest request, CurrentUser user, AppDbContext db, ArchitectureDocumentValidator validator,
        TimeProvider clock, HttpRequest httpRequest, HttpResponse response, CancellationToken ct)
    {
        var expected = ArchitectureInput.ParseIfMatch(httpRequest.Headers.IfMatch);
        if (expected is null)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status428PreconditionRequired,
                title: "Saving a design requires an If-Match header with its current version.",
                type: ProblemTypes.PreconditionRequired);
        }
        if (expected < 0) return Invalid(new() { ["If-Match"] = ["If-Match must be a version tag such as \"3\"."] }, "The request is invalid.");

        var check = validator.Check(request.Document);
        if (check.TooLarge) return DocumentTooLarge();
        if (!check.IsValid) return Invalid(new() { ["document"] = check.Errors }, "The design is invalid.");

        var now = Now(clock);
        // One conditional UPDATE, so two concurrent saves with the same version can't both succeed.
        var updated = await db.Architectures
            .Where(a => a.Id == id && a.OwnerId == user.Id && a.Version == expected)
            .ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Document, check.Raw)
                .SetProperty(a => a.SchemaVersion, check.SchemaVersion)
                .SetProperty(a => a.NodeCount, check.NodeCount)
                .SetProperty(a => a.Version, a => a.Version + 1)
                .SetProperty(a => a.UpdatedAt, now), ct);

        var architecture = await Find(db, id, user.Id, ct);
        if (architecture is null) return NotFound();
        if (updated == 0)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status412PreconditionFailed,
                title: "The design was changed elsewhere.",
                detail: "Another tab or device saved a newer version. Reload it, or overwrite it with your changes.",
                type: ProblemTypes.Conflict,
                extensions: new Dictionary<string, object?> { ["currentVersion"] = architecture.Version });
        }

        response.Headers.ETag = ArchitectureInput.ETag(architecture.Version);
        return TypedResults.Ok(ArchitectureResponse.From(architecture));
    }

    private static async Task<Results<Ok<ArchitectureResponse>, ValidationProblem, ProblemHttpResult>> Rename(
        Guid id, JsonElement body, CurrentUser user, AppDbContext db, TimeProvider clock, HttpResponse response, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object)
            return Invalid(new() { ["body"] = ["The body must be a JSON object."] }, "The request is invalid.");

        // "description": null clears it; an absent property leaves it unchanged.
        var errors = new Dictionary<string, string[]>();
        string? title = null;
        var hasDescription = false;
        string? description = null;
        if (body.TryGetProperty("title", out var titleElement))
        {
            if (titleElement.ValueKind != JsonValueKind.String) errors["title"] = ["Title must be a string."];
            else
            {
                title = ArchitectureInput.NormalizeTitle(titleElement.GetString());
                ArchitectureInput.ValidateTitle(title, "title", errors);
            }
        }
        if (body.TryGetProperty("description", out var descriptionElement))
        {
            hasDescription = true;
            if (descriptionElement.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                errors["description"] = ["Description must be a string or null."];
            else
            {
                description = ArchitectureInput.NormalizeDescription(descriptionElement.GetString());
                ArchitectureInput.ValidateDescription(description, "description", errors);
            }
        }
        if (errors.Count > 0) return Invalid(errors, "The update is invalid.");

        var architecture = await db.Architectures.SingleOrDefaultAsync(a => a.Id == id && a.OwnerId == user.Id, ct);
        if (architecture is null) return NotFound();
        if (title is not null) architecture.Title = title;
        if (hasDescription) architecture.Description = description;
        architecture.UpdatedAt = Now(clock);
        await db.SaveChangesAsync(ct);

        response.Headers.ETag = ArchitectureInput.ETag(architecture.Version);
        return TypedResults.Ok(ArchitectureResponse.From(architecture));
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> Delete(Guid id, CurrentUser user, AppDbContext db, CancellationToken ct)
    {
        var deleted = await db.Architectures.Where(a => a.Id == id && a.OwnerId == user.Id).ExecuteDeleteAsync(ct);
        return deleted == 0 ? NotFound() : TypedResults.NoContent();
    }

    private static async Task<Results<Created<ArchitectureResponse>, ProblemHttpResult>> Duplicate(
        Guid id, CurrentUser user, AppDbContext db, TimeProvider clock, HttpResponse response, CancellationToken ct)
    {
        var original = await Find(db, id, user.Id, ct);
        if (original is null) return NotFound();

        var now = Now(clock);
        var title = $"Copy of {original.Title}";
        var copy = new Architecture
        {
            Id = Guid.CreateVersion7(),
            OwnerId = user.Id,
            Title = title.Length > Architecture.MaxTitleLength ? title[..Architecture.MaxTitleLength].TrimEnd() : title,
            Description = original.Description,
            Document = original.Document,
            SchemaVersion = original.SchemaVersion,
            NodeCount = original.NodeCount,
            ChallengeSlug = original.ChallengeSlug,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Architectures.Add(copy);
        await db.SaveChangesAsync(ct);

        response.Headers.ETag = ArchitectureInput.ETag(copy.Version);
        return TypedResults.Created($"/api/architectures/{copy.Id}", ArchitectureResponse.From(copy));
    }

    /// <summary>
    /// Idempotent guest import (AUTH-9): each design and attempt carries a client-generated key, and a key that was
    /// already imported returns the existing item instead of creating another. Everything is one transaction.
    /// </summary>
    private static async Task<Results<Ok<ImportResponse>, ValidationProblem>> Import(
        ImportRequest request, CurrentUser user, AppDbContext db, ArchitectureDocumentValidator validator,
        ChallengeCatalog catalog, TimeProvider clock, CancellationToken ct)
    {
        var designs = request.Designs ?? [];
        var attempts = request.Attempts ?? [];
        if (designs.Count > MaxImportBatch || designs.Count + attempts.Count == 0)
            return Invalid(new() { ["designs"] = [$"Import between 1 and {MaxImportBatch} designs at a time."] }, "The import is invalid.");
        if (attempts.Count > MaxImportBatch)
            return Invalid(new() { ["attempts"] = [$"Import at most {MaxImportBatch} attempts at a time."] }, "The import is invalid.");

        var errors = new Dictionary<string, string[]>();
        var prepared = new List<(ImportDesign Design, string Title, string? Description, DocumentCheck Check)>();
        for (var i = 0; i < designs.Count; i++)
        {
            var design = designs[i];
            var prefix = $"designs[{i}]";
            if (design.ImportKey == Guid.Empty) errors[$"{prefix}.importKey"] = ["Import key is required."];
            var title = ArchitectureInput.NormalizeTitle(design.Title);
            var description = ArchitectureInput.NormalizeDescription(design.Description);
            ArchitectureInput.ValidateTitle(title, $"{prefix}.title", errors);
            ArchitectureInput.ValidateDescription(description, $"{prefix}.description", errors);
            ArchitectureInput.ValidateChallengeSlug(design.ChallengeSlug, $"{prefix}.challengeSlug", errors);
            var check = validator.Check(design.Document);
            if (!check.IsValid) errors[$"{prefix}.document"] = check.Errors;
            prepared.Add((design, title, description, check));
        }
        var preparedAttempts = new List<PreparedAttempt>();
        for (var i = 0; i < attempts.Count; i++)
        {
            if (PrepareAttempt(attempts[i], $"attempts[{i}]", catalog, errors) is { } attempt) preparedAttempts.Add(attempt);
        }
        if (errors.Count > 0) return Invalid(errors, "The import is invalid.");

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var results = new List<ImportResult>();
        var now = Now(clock);
        foreach (var (design, title, description, check) in prepared.DistinctBy(p => p.Design.ImportKey))
        {
            var id = Guid.CreateVersion7();
            // ON CONFLICT makes concurrent imports of the same key race-safe: exactly one insert wins.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO app.architectures
                  (id, owner_id, title, description, document, schema_version, node_count, challenge_slug, import_key, version, created_at, updated_at)
                VALUES
                  ({id}, {user.Id}, {title}, {description}, CAST({check.Raw} AS jsonb), {check.SchemaVersion}, {check.NodeCount},
                   {design.ChallengeSlug}, {design.ImportKey}, 1, {now}, {now})
                ON CONFLICT (owner_id, import_key) DO NOTHING
                """,
                ct);
            var storedId = await db.Architectures
                .Where(a => a.OwnerId == user.Id && a.ImportKey == design.ImportKey)
                .Select(a => a.Id)
                .SingleAsync(ct);
            results.Add(new ImportResult(design.ImportKey, storedId, storedId == id));
        }

        var attemptResults = new List<ImportResult>();
        foreach (var attempt in preparedAttempts.DistinctBy(a => a.Source.ImportKey))
            attemptResults.Add(await ImportAttemptAsync(db, user.Id, attempt, ct));

        await transaction.CommitAsync(ct);
        return TypedResults.Ok(new ImportResponse(results, attemptResults));
    }

    private sealed record PreparedAttempt(
        ImportAttempt Source, ChallengeEntry Challenge, string StageResults, string ExerciseAnswers, List<string> Hints);

    private static PreparedAttempt? PrepareAttempt(
        ImportAttempt attempt, string prefix, ChallengeCatalog catalog, Dictionary<string, string[]> errors)
    {
        var start = errors.Count;
        if (attempt.ImportKey == Guid.Empty) errors[$"{prefix}.importKey"] = ["Import key is required."];
        var challenge = attempt.ChallengeSlug is null ? null : catalog.Find(attempt.ChallengeSlug);
        if (challenge is null)
        {
            errors[$"{prefix}.challengeSlug"] = ["Unknown challenge."];
            return null;
        }
        if (attempt.Mode != AttemptModes.Guided) errors[$"{prefix}.mode"] = ["Mode must be \"guided\"."];
        if (attempt.Status is null || !AttemptStatuses.All.Contains(attempt.Status))
            errors[$"{prefix}.status"] = ["Status must be in_progress, completed or abandoned."];
        if (attempt.ChallengeVersion < 1) errors[$"{prefix}.challengeVersion"] = ["Challenge version must be at least 1."];
        AttemptValidation.StageId(attempt.CurrentStageId, challenge, $"{prefix}.currentStageId", errors);
        var stageResults = attempt.StageResults.ValueKind == JsonValueKind.Undefined
            ? "{}"
            : AttemptValidation.StageResults(attempt.StageResults, challenge, $"{prefix}.stageResults", errors);
        var answers = attempt.ExerciseAnswers.ValueKind == JsonValueKind.Undefined
            ? "{}"
            : AttemptValidation.ExerciseAnswers(attempt.ExerciseAnswers, challenge, $"{prefix}.exerciseAnswers", errors);
        var hints = attempt.HintsRevealed.ValueKind == JsonValueKind.Undefined
            ? []
            : AttemptValidation.Hints(attempt.HintsRevealed, challenge, $"{prefix}.hintsRevealed", errors);
        if (attempt.StartedAt == default) errors[$"{prefix}.startedAt"] = ["startedAt is required."];
        if (attempt.LastActivityAt == default) errors[$"{prefix}.lastActivityAt"] = ["lastActivityAt is required."];
        if (errors.Count > start || stageResults is null || answers is null || hints is null) return null;
        return new PreparedAttempt(attempt, challenge, stageResults, answers, hints);
    }

    /// <summary>
    /// Inserts one guest attempt, linking it to the design imported with the given guest key. When the user already
    /// has an attempt in progress at the same challenge, the more recently active one stays in progress.
    /// </summary>
    private static async Task<ImportResult> ImportAttemptAsync(AppDbContext db, Guid userId, PreparedAttempt prepared, CancellationToken ct)
    {
        var source = prepared.Source;
        var existingId = await db.Attempts.AsNoTracking()
            .Where(a => a.UserId == userId && a.ImportKey == source.ImportKey)
            .Select(a => (Guid?)a.Id)
            .SingleOrDefaultAsync(ct);
        if (existingId is { } already) return new ImportResult(source.ImportKey, already, false);

        Guid? architectureId = source.ArchitectureImportKey is { } key
            ? await db.Architectures.Where(a => a.OwnerId == userId && a.ImportKey == key).Select(a => (Guid?)a.Id).SingleOrDefaultAsync(ct)
            : null;

        var status = source.Status!;
        if (status == AttemptStatuses.InProgress)
        {
            var other = await db.Attempts.SingleOrDefaultAsync(
                a => a.UserId == userId && a.ChallengeSlug == prepared.Challenge.Slug && a.Status == AttemptStatuses.InProgress, ct);
            if (other is not null)
            {
                if (other.LastActivityAt >= source.LastActivityAt) status = AttemptStatuses.Abandoned;
                else
                {
                    other.Status = AttemptStatuses.Abandoned;
                    await db.SaveChangesAsync(ct);
                }
            }
        }

        var id = Guid.CreateVersion7();
        var completedAt = status == AttemptStatuses.Completed ? source.CompletedAt ?? source.LastActivityAt : (DateTimeOffset?)null;
        var hints = prepared.Hints.ToArray();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO app.challenge_attempts
              (id, user_id, challenge_slug, challenge_version, mode, status, current_stage_id, architecture_id,
               stage_results, exercise_answers, hints_revealed, import_key, started_at, last_activity_at, completed_at)
            VALUES
              ({id}, {userId}, {prepared.Challenge.Slug}, {source.ChallengeVersion}, {AttemptModes.Guided}, {status}, {source.CurrentStageId},
               {architectureId}, CAST({prepared.StageResults} AS jsonb), CAST({prepared.ExerciseAnswers} AS jsonb), {hints},
               {source.ImportKey}, {source.StartedAt}, {source.LastActivityAt}, {completedAt})
            ON CONFLICT (user_id, import_key) WHERE import_key IS NOT NULL DO NOTHING
            """,
            ct);
        var storedId = await db.Attempts.Where(a => a.UserId == userId && a.ImportKey == source.ImportKey).Select(a => a.Id).SingleAsync(ct);
        return new ImportResult(source.ImportKey, storedId, storedId == id);
    }

    private static Task<Architecture?> Find(AppDbContext db, Guid id, Guid ownerId, CancellationToken ct) =>
        db.Architectures.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id && a.OwnerId == ownerId, ct);

    /// <summary>PostgreSQL stores microseconds, so responses match what a later read returns.</summary>
    private static DateTimeOffset Now(TimeProvider clock)
    {
        var now = clock.GetUtcNow();
        return now.AddTicks(-(now.Ticks % 10));
    }

    private static ValidationProblem Invalid(Dictionary<string, string[]> errors, string title) =>
        TypedResults.ValidationProblem(errors, title: title, type: ProblemTypes.Validation);

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Design not found.", type: ProblemTypes.NotFound);

    private static ProblemHttpResult DocumentTooLarge() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: "The design is too large.",
            detail: $"A design can be at most {ArchitectureDocumentValidator.MaxDocumentBytes / 1024} KB.",
            type: ProblemTypes.DocumentTooLarge);
}

/// <summary>Opaque keyset position for the designs list.</summary>
internal sealed record ListCursor(DateTimeOffset UpdatedAt, Guid Id)
{
    public string Encode() =>
        Base64Url.EncodeToString(Encoding.UTF8.GetBytes(
            $"{UpdatedAt.UtcTicks.ToString(CultureInfo.InvariantCulture)}:{Id:N}"));

    public static ListCursor? TryDecode(string value)
    {
        try
        {
            var parts = Encoding.UTF8.GetString(Base64Url.DecodeFromChars(value)).Split(':');
            if (parts.Length == 2
                && long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                && ticks >= DateTimeOffset.MinValue.UtcTicks && ticks <= DateTimeOffset.MaxValue.UtcTicks
                && Guid.TryParseExact(parts[1], "N", out var id))
            {
                return new ListCursor(new DateTimeOffset(ticks, TimeSpan.Zero), id);
            }
        }
        catch (FormatException)
        {
        }
        return null;
    }
}
