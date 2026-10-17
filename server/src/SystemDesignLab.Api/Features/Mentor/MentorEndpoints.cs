using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.RateLimiting;
using Anthropic.Exceptions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SystemDesignLab.Api.Common;
using SystemDesignLab.Api.Features.Attempts;
using SystemDesignLab.Api.Features.Challenges;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;
using SystemDesignLab.Api.Infrastructure.Web;

namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>
/// The AI mentor (ARCHITECTURE §8, DATA_MODEL §5). Conversations are owner-scoped (another user's is 404). Creating
/// conversations and sending messages need a verified email; sending also passes the kill switch, a per-user rate
/// limit, one request in flight per user and the cost budgets before Claude is called.
/// </summary>
public static class MentorEndpoints
{
    public const string RateLimitPolicy = "mentor-messages";
    public const int MaxListSize = 50;

    /// <summary>Design plus simulation plus message, with room for JSON overhead.</summary>
    public const long MaxSendBodyBytes = Architectures.ArchitectureDocumentValidator.MaxDocumentBytes + MentorContextValidator.MaxSimulationBytes + 32 * 1024;

    public static IServiceCollection AddMentorFeature(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<MentorOptions>(configuration.GetSection(MentorOptions.Section));
        services.AddSingleton<IClaudeClient, AnthropicClaudeClient>();
        services.AddSingleton<MentorConcurrency>();
        services.AddScoped<MentorBudget>();
        services.Configure<RateLimiterOptions>(options => options.AddPolicy(RateLimitPolicy, context =>
        {
            var permits = context.RequestServices.GetRequiredService<IOptionsMonitor<MentorOptions>>().CurrentValue.MessagesPerMinute;
            var key = context.User.FindFirst("sub")?.Value ?? $"ip:{context.Connection.RemoteIpAddress}";
            return RateLimitPartition.GetFixedWindowLimiter($"mentor:{key}", _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permits,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
        }));
        return services;
    }

    public static RouteGroupBuilder MapMentorEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/mentor").WithTags("Mentor");
        group.MapGet("/quota", Quota).WithName("GetMentorQuota");
        group.MapGet("/conversations", List).WithName("ListConversations");
        group.MapPost("/conversations", Create).WithName("CreateConversation");
        group.MapGet("/conversations/{id:guid}", Get).WithName("GetConversation");
        group.MapPatch("/conversations/{id:guid}", Update).WithName("UpdateConversation");
        group.MapPost("/conversations/{id:guid}/messages", Send)
            .WithName("SendMessage")
            .RequireRateLimiting(RateLimitPolicy)
            .WithRequestBodyLimit(MaxSendBodyBytes);
        return api;
    }

    private static async Task<Ok<QuotaResponse>> Quota(
        CurrentUser user, MentorBudget budget, IOptionsMonitor<MentorOptions> options, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        var remaining = await budget.RemainingPercentAsync(user.Id, ct);
        return TypedResults.Ok(new QuotaResponse(settings.Enabled && settings.IsConfigured, user.EmailVerified == true, remaining, budget.ResetsAt));
    }

    private static async Task<Results<Ok<ConversationListResponse>, ValidationProblem>> List(
        CurrentUser user, AppDbContext db, string? mode, Guid? architectureId, Guid? attemptId, CancellationToken ct)
    {
        if (mode is not null && !MentorModes.All.Contains(mode))
            return Invalid(new() { ["mode"] = ["Mode must be tutor, interviewer or reviewer."] }, "The list request is invalid.");

        var query = db.Set<AiConversation>().AsNoTracking().Where(c => c.UserId == user.Id);
        if (mode is not null) query = query.Where(c => c.Mode == mode);
        if (architectureId is not null) query = query.Where(c => c.ArchitectureId == architectureId);
        if (attemptId is not null) query = query.Where(c => c.AttemptId == attemptId);
        var items = await query.OrderByDescending(c => c.UpdatedAt).ThenByDescending(c => c.Id).Take(MaxListSize).ToListAsync(ct);
        return TypedResults.Ok(new ConversationListResponse(items.Select(ConversationResponse.From).ToList()));
    }

    private static async Task<Results<Created<ConversationDetailResponse>, ValidationProblem, ProblemHttpResult>> Create(
        CreateConversationRequest request, CurrentUser user, AppDbContext db, ChallengeCatalog catalog, TimeProvider clock, CancellationToken ct)
    {
        if (user.EmailVerified != true) return NotVerified();

        var errors = new Dictionary<string, string[]>();
        if (request.Mode is null || !MentorModes.All.Contains(request.Mode)) errors["mode"] = ["Mode must be tutor, interviewer or reviewer."];
        if (request.ArchitectureId is { } architectureId && !await AttemptsEndpoints.OwnsArchitecture(db, user.Id, architectureId, ct))
            errors["architectureId"] = ["Design not found."];
        ChallengeAttempt? attempt = null;
        if (request.AttemptId is { } attemptId)
        {
            attempt = await db.Attempts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == attemptId && a.UserId == user.Id, ct);
            if (attempt is null) errors["attemptId"] = ["Attempt not found."];
        }
        if (request.Mode == MentorModes.Interviewer && request.AttemptId is null)
            errors["attemptId"] = ["An interview needs a challenge attempt."];
        if (errors.Count > 0) return Invalid(errors, "The conversation is invalid.");

        var now = AttemptsEndpoints.Now(clock);
        var challenge = attempt is null ? null : catalog.Find(attempt.ChallengeSlug);
        var conversation = new AiConversation
        {
            Id = Guid.CreateVersion7(),
            UserId = user.Id,
            Mode = request.Mode!,
            Title = request.Mode switch
            {
                MentorModes.Interviewer => Truncate($"Interview: {challenge?.Summary["title"]?.GetValue<string>() ?? "challenge"}", AiConversation.MaxTitleLength),
                MentorModes.Reviewer => "Design review",
                _ => "New conversation",
            },
            ArchitectureId = request.ArchitectureId,
            AttemptId = request.AttemptId,
            Metadata = request.Mode == MentorModes.Interviewer ? """{"step":"requirements"}""" : "{}",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Add(conversation);

        var messages = new List<AiMessage>();
        if (request.Mode == MentorModes.Interviewer)
        {
            // Seeded with the challenge without calling Claude, so opening an interview costs nothing.
            var opening = new AiMessage
            {
                Id = Guid.CreateVersion7(),
                ConversationId = conversation.Id,
                Role = MessageRoles.Assistant,
                Content = MentorPrompts.InterviewOpening(challenge?.Summary["title"]?.GetValue<string>() ?? "this system"),
                CreatedAt = now,
            };
            db.Add(opening);
            messages.Add(opening);
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Created(
            $"/api/mentor/conversations/{conversation.Id}",
            new ConversationDetailResponse(ConversationResponse.From(conversation), messages.Select(MessageResponse.From).ToList()));
    }

    private static async Task<Results<Ok<ConversationDetailResponse>, ProblemHttpResult>> Get(
        Guid id, CurrentUser user, AppDbContext db, CancellationToken ct)
    {
        var conversation = await db.Set<AiConversation>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && c.UserId == user.Id, ct);
        if (conversation is null) return NotFound();
        var messages = await db.Set<AiMessage>().AsNoTracking()
            .Where(m => m.ConversationId == id)
            .OrderBy(m => m.CreatedAt).ThenBy(m => m.Id)
            .ToListAsync(ct);
        return TypedResults.Ok(new ConversationDetailResponse(ConversationResponse.From(conversation), messages.Select(MessageResponse.From).ToList()));
    }

    private static async Task<Results<Ok<ConversationResponse>, ValidationProblem, ProblemHttpResult>> Update(
        Guid id, UpdateConversationRequest request, CurrentUser user, AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var conversation = await db.Set<AiConversation>().SingleOrDefaultAsync(c => c.Id == id && c.UserId == user.Id, ct);
        if (conversation is null) return NotFound();

        var errors = new Dictionary<string, string[]>();
        if (request.Title is not null)
        {
            var title = request.Title.Trim();
            if (title.Length is 0 or > AiConversation.MaxTitleLength) errors["title"] = [$"The title must be 1–{AiConversation.MaxTitleLength} characters."];
            else conversation.Title = title;
        }
        if (request.Step is not null)
        {
            if (conversation.Mode != MentorModes.Interviewer) errors["step"] = ["Only interviews have steps."];
            else if (!MentorPrompts.InterviewSteps.Contains(request.Step))
                errors["step"] = [$"Step must be one of: {string.Join(", ", MentorPrompts.InterviewSteps)}."];
            else conversation.Metadata = new JsonObject { ["step"] = request.Step }.ToJsonString();
        }
        if (errors.Count > 0) return Invalid(errors, "The update is invalid.");

        conversation.UpdatedAt = AttemptsEndpoints.Now(clock);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ConversationResponse.From(conversation));
    }

    private static async Task<IResult> Send(
        Guid id,
        SendMessageRequest request,
        CurrentUser user,
        HttpContext http,
        AppDbContext db,
        ChallengeCatalog catalog,
        MentorBudget budget,
        MentorConcurrency concurrency,
        IClaudeClient claude,
        IOptionsMonitor<MentorOptions> options,
        TimeProvider clock,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        var settings = options.CurrentValue;
        if (!settings.Enabled || !settings.IsConfigured) return Unavailable();
        if (user.EmailVerified != true) return NotVerified();

        var conversation = await db.Set<AiConversation>().SingleOrDefaultAsync(c => c.Id == id && c.UserId == user.Id, ct);
        if (conversation is null) return NotFound();

        var errors = new Dictionary<string, string[]>();
        var content = request.Content?.Trim() ?? "";
        if (content.Length == 0 || content.Length > settings.MaxMessageLength)
            errors["content"] = [$"The message must be 1–{settings.MaxMessageLength} characters."];
        var context = MentorContextValidator.Validate(request, errors);
        if (conversation.Mode == MentorModes.Reviewer && request.Architecture is not { ValueKind: JsonValueKind.Object })
            errors["architecture"] = ["A review needs the design."];
        if (errors.Count > 0) return Invalid(errors, "The message is invalid.");

        if (!concurrency.TryEnter(user.Id))
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "The mentor is still answering your previous message.",
                detail: "Wait for that answer to finish, then send this one.",
                type: ProblemTypes.MentorBusy);
        }
        try
        {
            var mode = settings.ModeOptions(conversation.Mode);
            var challenge = await StageOf(conversation, db, catalog, ct);
            var history = await History(db, conversation.Id, settings.MaxHistoryMessages, ct);
            var step = conversation.Mode == MentorModes.Interviewer
                ? MentorJson.Parse(conversation.Metadata).TryGetProperty("step", out var s) ? s.GetString() : null
                : null;
            var claudeRequest = PromptBuilder.Build(conversation.Mode, mode, challenge, history, content, context!, step ?? MentorPrompts.InterviewSteps[0]);

            var price = settings.PriceOf(mode.Model);
            var worstCase = price.CostMicros(new TokenUsage(PromptBuilder.EstimateInputTokens(claudeRequest), mode.MaxTokens, 0, 0));
            var (outcome, reservation) = await budget.ReserveAsync(user.Id, worstCase, ct);
            if (outcome != ReservationOutcome.Reserved) return BudgetProblem(http, outcome, budget.ResetsAt, clock);

            var now = AttemptsEndpoints.Now(clock);
            db.Add(new AiMessage { Id = Guid.CreateVersion7(), ConversationId = conversation.Id, Role = MessageRoles.User, Content = content, CreatedAt = now });
            if (conversation.Title == "New conversation") conversation.Title = Truncate(content, AiConversation.MaxTitleLength);
            conversation.UpdatedAt = now;
            await db.SaveChangesAsync(ct);

            await StreamReply(http, db, claude, budget, reservation!, price, conversation, claudeRequest, context!, challenge, clock,
                loggers.CreateLogger("SystemDesignLab.Mentor"), ct);
            return Results.Empty;
        }
        finally
        {
            concurrency.Exit(user.Id);
        }
    }

    /// <summary>
    /// Relays Claude's answer as server-sent events: <c>delta</c> (text as it arrives, not for the Reviewer), then
    /// <c>done</c> with the saved message, or <c>error</c>. The budget is settled and the reply saved in every case.
    /// </summary>
    private static async Task StreamReply(
        HttpContext http, AppDbContext db, IClaudeClient claude, MentorBudget budget, BudgetReservation reservation, ModelPrice price,
        AiConversation conversation, ClaudeRequest request, ValidatedContext context, ChallengeStageRef? challenge, TimeProvider clock,
        ILogger logger, CancellationToken ct)
    {
        http.Response.ContentType = "text/event-stream";
        http.Response.Headers.CacheControl = "no-cache";
        http.Response.Headers["X-Accel-Buffering"] = "no";
        await http.Response.StartAsync(ct);

        var isReview = conversation.Mode == MentorModes.Reviewer;
        var text = new StringBuilder();
        ClaudeCompleted? completed = null;
        Exception? failure = null;
        try
        {
            await foreach (var streamEvent in claude.StreamAsync(request, ct))
            {
                switch (streamEvent)
                {
                    case ClaudeTextDelta delta:
                        text.Append(delta.Text);
                        if (!isReview) await WriteEvent(http, "delta", new { text = delta.Text }, ct);
                        break;
                    case ClaudeCompleted done:
                        completed = done;
                        break;
                }
            }
        }
        catch (Exception ex) when (ex is AnthropicException or OperationCanceledException or IOException)
        {
            failure = ex;
            if (ex is AnthropicException) MentorLog.ClaudeFailed(logger, ex, conversation.Id);
        }

        // Without final usage (an error or a disconnect), charge an estimate: the input and what was streamed so far.
        var usage = completed?.Usage ?? new TokenUsage(PromptBuilder.EstimateInputTokens(request), text.Length / 2, 0, 0);
        var cost = price.CostMicros(usage);
        var (status, reply, review, problem) = Outcome(completed, failure, text.ToString(), isReview, context);

        var message = new AiMessage
        {
            Id = Guid.CreateVersion7(),
            ConversationId = conversation.Id,
            Role = MessageRoles.Assistant,
            Content = reply,
            Findings = review is null ? null : JsonSerializer.Serialize(review, MentorJson.Options),
            ContextRef = ContextRef(context, challenge),
            Model = request.Model,
            InputTokens = (int)Math.Min(int.MaxValue, usage.InputTokens + usage.CacheWriteTokens),
            OutputTokens = (int)Math.Min(int.MaxValue, usage.OutputTokens),
            CacheReadTokens = (int)Math.Min(int.MaxValue, usage.CacheReadTokens),
            CostMicros = cost,
            Status = status,
            CreatedAt = AttemptsEndpoints.Now(clock),
        };
        db.Add(message);
        await db.SaveChangesAsync(CancellationToken.None);
        await budget.SettleAsync(reservation, usage, cost);

        if (ct.IsCancellationRequested) return;
        if (problem is not null) await WriteEvent(http, "error", problem, CancellationToken.None);
        else
        {
            var remaining = await budget.RemainingPercentAsync(conversation.UserId, CancellationToken.None);
            await WriteEvent(http, "done", new { message = MessageResponse.From(message), remainingPercent = remaining }, CancellationToken.None);
        }
    }

    private static (string Status, string Reply, ReviewResult? Review, object? Problem) Outcome(
        ClaudeCompleted? completed, Exception? failure, string text, bool isReview, ValidatedContext context)
    {
        if (failure is not null || completed is null)
        {
            var (title, detail) = failure switch
            {
                AnthropicRateLimitException => ("The mentor is busy right now.", "Too many people are asking at once. Try again in a minute."),
                Anthropic5xxException or AnthropicIOException => ("The mentor couldn't be reached.", "The AI service didn't respond. Try again in a moment."),
                _ => ("The mentor couldn't answer.", "Something went wrong while writing the answer. Try again."),
            };
            return (MessageStatuses.Error, text, null, new { type = ProblemTypes.MentorFailed, title, detail });
        }
        if (completed.StopReason == "refusal")
        {
            const string refusal = "I can't help with that request. Try asking about your design or a system design concept.";
            return (MessageStatuses.Error, refusal, null, null);
        }
        if (isReview)
        {
            var review = completed.StopReason == "max_tokens" ? null : ReviewSchema.Parse(text, context.NodeIds);
            if (review is null)
            {
                return (MessageStatuses.Error, "", null, new
                {
                    type = ProblemTypes.MentorFailed,
                    title = "The review couldn't be completed.",
                    detail = "The answer wasn't a complete review. Try again.",
                });
            }
            return (MessageStatuses.Complete, review.Summary, review, null);
        }
        return completed.StopReason == "max_tokens"
            ? (MessageStatuses.Truncated, text, null, null)
            : (MessageStatuses.Complete, text, null, null);
    }

    private static string ContextRef(ValidatedContext context, ChallengeStageRef? challenge) =>
        JsonSerializer.Serialize(new
        {
            architectureHash = context.ArchitectureHash,
            simInputHash = context.Simulation?.InputHash,
            engineVersion = context.Simulation?.EngineVersion,
            challenge = challenge?.Challenge.Slug,
            stage = challenge?.StageId,
        }, MentorJson.Options);

    private static async Task WriteEvent(HttpContext http, string name, object data, CancellationToken ct)
    {
        await http.Response.WriteAsync($"event: {name}\ndata: {JsonSerializer.Serialize(data, MentorJson.Options)}\n\n", ct);
        await http.Response.Body.FlushAsync(ct);
    }

    private static async Task<ChallengeStageRef?> StageOf(AiConversation conversation, AppDbContext db, ChallengeCatalog catalog, CancellationToken ct)
    {
        if (conversation.AttemptId is not { } attemptId) return null;
        var attempt = await db.Attempts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == attemptId && a.UserId == conversation.UserId, ct);
        var challenge = attempt is null ? null : catalog.Find(attempt.ChallengeSlug);
        return challenge is null ? null : new ChallengeStageRef(challenge, attempt!.CurrentStageId);
    }

    /// <summary>The latest earlier messages that completed, oldest first. Failed replies and their prompts are skipped.</summary>
    private static async Task<IReadOnlyList<ClaudeMessage>> History(AppDbContext db, Guid conversationId, int max, CancellationToken ct)
    {
        var recent = await db.Set<AiMessage>().AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id)
            .Take(max * 2)
            .ToListAsync(ct);
        recent.Reverse();
        var turns = new List<ClaudeMessage>();
        for (var i = 0; i < recent.Count; i++)
        {
            var m = recent[i];
            if (m.Role == MessageRoles.User)
            {
                var reply = i + 1 < recent.Count ? recent[i + 1] : null;
                if (reply is { Role: MessageRoles.Assistant } && reply.Status != MessageStatuses.Error && reply.Content.Length > 0)
                {
                    turns.Add(new ClaudeMessage(MessageRoles.User, m.Content));
                    turns.Add(new ClaudeMessage(MessageRoles.Assistant, reply.Content));
                    i++;
                }
            }
            else if (turns.Count == 0 && m.Status != MessageStatuses.Error)
            {
                turns.Add(new ClaudeMessage(MessageRoles.Assistant, m.Content)); // the Interviewer's opening
            }
        }
        return turns.Count > max ? turns.Skip(turns.Count - max).ToList() : turns;
    }

    private static ProblemHttpResult BudgetProblem(HttpContext http, ReservationOutcome outcome, DateTimeOffset resetsAt, TimeProvider clock)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling((resetsAt - clock.GetUtcNow()).TotalSeconds));
        http.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        return outcome == ReservationOutcome.UserBudgetExhausted
            ? TypedResults.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "You've used today's mentor allowance.",
                detail: "It resets at midnight UTC.",
                type: ProblemTypes.MentorQuotaExceeded,
                extensions: new Dictionary<string, object?> { ["resetsAt"] = resetsAt })
            : TypedResults.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "The mentor is paused for today.",
                detail: "The app has reached its daily AI limit. It resets at midnight UTC.",
                type: ProblemTypes.MentorPaused,
                extensions: new Dictionary<string, object?> { ["resetsAt"] = resetsAt });
    }

    private static ProblemHttpResult Unavailable() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "The AI mentor is turned off.",
            detail: "It's temporarily unavailable. Everything else keeps working.",
            type: ProblemTypes.MentorUnavailable);

    private static ProblemHttpResult NotVerified() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status403Forbidden,
            title: "Verify your email to use the AI mentor.",
            detail: "Open the link in the confirmation email, then sign in again.",
            type: ProblemTypes.EmailNotVerified);

    private static ValidationProblem Invalid(Dictionary<string, string[]> errors, string title) =>
        TypedResults.ValidationProblem(errors, title: title, type: ProblemTypes.Validation);

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Conversation not found.", type: ProblemTypes.NotFound);

    private static string Truncate(string value, int max)
    {
        var line = value.ReplaceLineEndings(" ");
        return line.Length <= max ? line : line[..(max - 1)] + "…";
    }
}

internal static partial class MentorLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Claude request failed for conversation {ConversationId}")]
    public static partial void ClaudeFailed(ILogger logger, Exception exception, Guid conversationId);
}
