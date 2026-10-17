using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.Memory;
using Microsoft.Extensions.DependencyInjection;
using SystemDesignLab.Api.Features.Mentor;
using SystemDesignLab.Api.Infrastructure.Persistence;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

/// <summary>The mentor endpoints against PostgreSQL, with a scripted Claude (no real API calls).</summary>
[Collection(DatabaseTestGroup.Name)]
public sealed class MentorEndpointsTests(PostgresFixture db)
{
    private static readonly string[] KnownAndGhost = ["n0", "ghost"];
    private static readonly Dictionary<string, object> Verified = new() { ["email_verified"] = true };
    private static readonly Dictionary<string, object> Unverified = new() { ["email_verified"] = false };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>An API with a fake Claude and its own settings. The memory provider can be changed at runtime.</summary>
    private sealed class MentorApi : IDisposable
    {
        public FakeClaude Claude { get; } = new();
        public ApiFactory Factory { get; }
        private readonly MemoryConfigurationSource _settings;

        public MentorApi(string connectionString, Dictionary<string, string?>? settings = null)
        {
            var values = new Dictionary<string, string?>
            {
                ["Mentor:ApiKey"] = "test-key",
                ["Mentor:Enabled"] = "true",
                ["Mentor:MessagesPerMinute"] = "100",
            };
            foreach (var (key, value) in settings ?? []) values[key] = value;
            _settings = new MemoryConfigurationSource { InitialData = values };
            Factory = new ApiFactory(connectionString, configure: builder =>
            {
                builder.ConfigureAppConfiguration((_, config) => config.Add(_settings));
                builder.ConfigureTestServices(services => services.AddSingleton<IClaudeClient>(Claude));
            });
        }

        public HttpClient Client(Guid? userId = null, bool verified = true) =>
            Factory.CreateClientFor(userId ?? Guid.NewGuid(), verified ? Verified : Unverified);

        /// <summary>Changes a setting and reloads configuration, as editing appsettings does in a running app.</summary>
        public void Set(string key, string value)
        {
            var configuration = (IConfigurationRoot)Factory.Services.GetRequiredService<IConfiguration>();
            configuration.Providers.OfType<MemoryConfigurationProvider>().Last().Set(key, value);
            configuration.Reload();
        }

        public void Dispose() => Factory.Dispose();
    }

    private MentorApi Api(Dictionary<string, string?>? settings = null) => new(db.ConnectionString, settings);

    private static async Task<Guid> CreateConversationAsync(HttpClient client, string mode = "tutor", Guid? attemptId = null, Guid? architectureId = null)
    {
        var response = await client.PostAsJsonAsync("/api/mentor/conversations", new { mode, attemptId, architectureId }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("conversation").GetProperty("id").GetGuid();
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, Guid conversationId, string content = "Why is my API saturated?", object? architecture = null) =>
        client.PostAsJsonAsync($"/api/mentor/conversations/{conversationId}/messages", new { content, architecture = architecture ?? TestData.Document(2) }, Ct);

    private static async Task<List<(string Event, JsonElement Data)>> EventsAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync(Ct);
        return body.Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(block => block.Split('\n'))
            .Select(lines => (lines[0]["event: ".Length..], JsonDocument.Parse(lines[1]["data: ".Length..]).RootElement.Clone()))
            .ToList();
    }

    private static Task<T> Query<T>(MentorApi api, Func<AppDbContext, Task<T>> query) => QueryAsync(api.Factory, query);

    private static async Task<T> QueryAsync<T>(ApiFactory factory, Func<AppDbContext, Task<T>> query)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    [Fact]
    public async Task Guests_get_401_and_unverified_users_get_403_but_can_read_their_quota()
    {
        db.SkipIfUnavailable();
        using var api = Api();

        var guest = api.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync("/api/mentor/quota", Ct)).StatusCode);

        var unverified = api.Client(verified: false);
        await TestData.ProblemAsync(
            await unverified.PostAsJsonAsync("/api/mentor/conversations", new { mode = "tutor" }, Ct),
            HttpStatusCode.Forbidden, "email-not-verified");
        var quota = await unverified.GetFromJsonAsync<JsonElement>("/api/mentor/quota", Ct);
        Assert.False(quota.GetProperty("emailVerified").GetBoolean());
        Assert.True(quota.GetProperty("available").GetBoolean());
        Assert.Equal(100, quota.GetProperty("remainingPercent").GetInt32());

        // A conversation made while verified can't be continued once the token says otherwise.
        var userId = Guid.NewGuid();
        var conversation = await CreateConversationAsync(api.Client(userId));
        await TestData.ProblemAsync(await SendAsync(api.Client(userId, verified: false), conversation), HttpStatusCode.Forbidden, "email-not-verified");
        Assert.Empty(api.Claude.Requests);
    }

    [Fact]
    public async Task A_tutor_answer_streams_and_is_saved_with_its_usage_and_cost()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var userId = Guid.NewGuid();
        var client = api.Client(userId);
        var conversation = await CreateConversationAsync(client);
        api.Claude.Reply("The API server is at **275%** utilization.", new TokenUsage(2000, 100, 500, 0));

        var events = await EventsAsync(await SendAsync(client, conversation));

        Assert.Equal("The API server is at **275%** utilization.", string.Concat(events.Where(e => e.Event == "delta").Select(e => e.Data.GetProperty("text").GetString())));
        var done = events[^1];
        Assert.Equal("done", done.Event);
        Assert.Equal("complete", done.Data.GetProperty("message").GetProperty("status").GetString());
        Assert.InRange(done.Data.GetProperty("remainingPercent").GetInt32(), 99, 100);

        // Haiku 5.5 at its default price: 2000 × 0.10 + 100 × 0.50 + 500 × 0.01 = 255 micro-dollars.
        var stored = await Query(api, d => d.Set<AiMessage>().AsNoTracking().Where(m => m.ConversationId == conversation).OrderBy(m => m.CreatedAt).ToListAsync(Ct));
        Assert.Equal(["user", "assistant"], stored.Select(m => m.Role));
        Assert.Equal(2000, stored[1].InputTokens);
        Assert.Equal(500, stored[1].CacheReadTokens);
        Assert.Equal(255, stored[1].CostMicros);
        Assert.Equal("claude-haiku-5-5", stored[1].Model);
        Assert.Contains("architectureHash", stored[1].ContextRef);

        var usage = await Query(api, d => d.Set<AiUsageDaily>().AsNoTracking().SingleAsync(u => u.UserId == userId, Ct));
        Assert.Equal(255, usage.CostMicros);
        Assert.Equal(0, usage.ReservedMicros); // the reservation was released
        Assert.Equal(1, usage.Requests);

        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/mentor/conversations/{conversation}", Ct);
        Assert.Equal("Why is my API saturated?", detail.GetProperty("conversation").GetProperty("title").GetString());
        Assert.Equal(2, detail.GetProperty("messages").GetArrayLength());

        var request = Assert.Single(api.Claude.Requests);
        Assert.Equal("claude-haiku-5-5", request.Model);
        Assert.False(request.Thinking);
    }

    [Fact]
    public async Task History_is_replayed_and_conversations_are_owner_scoped()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);
        api.Claude.Reply("First answer.").Reply("Second answer.");
        await EventsAsync(await SendAsync(client, conversation, "First question"));
        await EventsAsync(await SendAsync(client, conversation, "Second question"));

        var second = api.Claude.Requests.Last();
        Assert.Equal(["user", "assistant", "user"], second.Messages.Select(m => m.Role));
        Assert.Equal("First question", second.Messages[0].Text);
        Assert.Equal("First answer.", second.Messages[1].Text);

        var stranger = api.Client();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/mentor/conversations/{conversation}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(stranger, conversation)).StatusCode);
        var list = await stranger.GetFromJsonAsync<JsonElement>("/api/mentor/conversations", Ct);
        Assert.Equal(0, list.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task A_malformed_context_returns_400_without_calling_claude()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);

        var invalid = TestData.Document(1);
        invalid["schemaVersion"] = 99;
        await TestData.AssertInvalidAsync(await SendAsync(client, conversation, architecture: invalid), "architecture");
        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync($"/api/mentor/conversations/{conversation}/messages", new { content = "Hi", simulation = new { engineVersion = "1" } }, Ct),
            "simulation");
        await TestData.AssertInvalidAsync(await SendAsync(client, conversation, content: " "), "content");
        Assert.Empty(api.Claude.Requests);
    }

    [Fact]
    public async Task Reviewer_findings_are_saved_with_unknown_node_ids_dropped()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        var architectureId = await TestData.CreateArchitectureAsync(client, nodes: 2);
        var conversation = await CreateConversationAsync(client, "reviewer", architectureId: architectureId);
        api.Claude.Reply(JsonSerializer.Serialize(new
        {
            summary = "A load balancer with nothing behind it.",
            findings = new[]
            {
                new { id = "1", category = "requirements", severity = "high", confidence = "high", nodeIds = KnownAndGhost, title = "No servers", explanation = "Nothing handles requests.", suggestion = "Add an API server." },
            },
        }));

        var events = await EventsAsync(await SendAsync(client, conversation, "Review my design."));

        Assert.DoesNotContain(events, e => e.Event == "delta"); // JSON isn't streamed to the learner
        var review = events[^1].Data.GetProperty("message").GetProperty("review");
        Assert.Equal("A load balancer with nothing behind it.", review.GetProperty("summary").GetString());
        var finding = review.GetProperty("findings")[0];
        Assert.Equal("f1", finding.GetProperty("id").GetString());
        Assert.Equal(["n0"], finding.GetProperty("nodeIds").EnumerateArray().Select(n => n.GetString()));
        Assert.NotNull(Assert.Single(api.Claude.Requests).OutputSchema);

        var reviews = await client.GetFromJsonAsync<JsonElement>($"/api/mentor/conversations?mode=reviewer&architectureId={architectureId}", Ct);
        Assert.Equal(conversation, reviews.GetProperty("items")[0].GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task An_interview_opens_with_the_challenge_and_tracks_its_step()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        await TestData.ProblemAsync(await client.PostAsJsonAsync("/api/mentor/conversations", new { mode = "interviewer" }, Ct), HttpStatusCode.BadRequest, "validation");
        var attempt = await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = "url-shortener", mode = "interview" }, Ct);
        var attemptId = (await attempt.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();

        var created = await client.PostAsJsonAsync("/api/mentor/conversations", new { mode = "interviewer", attemptId }, Ct);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var conversation = body.GetProperty("conversation");
        Assert.Equal("Interview: URL Shortener", conversation.GetProperty("title").GetString());
        Assert.Equal("requirements", conversation.GetProperty("metadata").GetProperty("step").GetString());
        Assert.Contains("URL Shortener", body.GetProperty("messages")[0].GetProperty("content").GetString());
        Assert.Empty(api.Claude.Requests); // the opening costs nothing

        var id = conversation.GetProperty("id").GetGuid();
        var moved = await client.PatchAsJsonAsync($"/api/mentor/conversations/{id}", new { step = "estimation" }, Ct);
        Assert.Equal("estimation", (await moved.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("metadata").GetProperty("step").GetString());
        await TestData.AssertInvalidAsync(await client.PatchAsJsonAsync($"/api/mentor/conversations/{id}", new { step = "coding" }, Ct), "step");

        api.Claude.Reply("What request rate do you expect?");
        await EventsAsync(await SendAsync(client, id, "Users shorten links and follow them."));
        var request = Assert.Single(api.Claude.Requests);
        Assert.Contains("<interview step=\"estimation\"/>", request.Messages[^1].Text);
        Assert.Contains("Challenge: URL Shortener", request.System[1]);
    }

    [Fact]
    public async Task Exceeding_the_message_rate_returns_429_with_retry_after()
    {
        db.SkipIfUnavailable();
        using var api = Api(new() { ["Mentor:MessagesPerMinute"] = "2" });
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);
        api.Claude.Reply("One.").Reply("Two.");
        await EventsAsync(await SendAsync(client, conversation));
        await EventsAsync(await SendAsync(client, conversation));

        var limited = await SendAsync(client, conversation);

        await TestData.ProblemAsync(limited, HttpStatusCode.TooManyRequests, "rate-limited");
        Assert.NotNull(limited.Headers.RetryAfter);
        Assert.Equal(2, api.Claude.Requests.Count);
    }

    [Fact]
    public async Task A_reservation_larger_than_the_remaining_budget_is_rejected_before_calling_claude()
    {
        db.SkipIfUnavailable();
        // The worst case of one Tutor message (2000 output tokens at $0.50/M = 1000 micro-dollars) exceeds a 500 budget.
        using var api = Api(new() { ["Mentor:UserDailyBudgetMicros"] = "500" });
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);

        var response = await SendAsync(client, conversation);

        var problem = await TestData.ProblemAsync(response, HttpStatusCode.TooManyRequests, "mentor-quota-exceeded");
        Assert.True(problem.TryGetProperty("resetsAt", out _));
        Assert.NotNull(response.Headers.RetryAfter);
        Assert.Empty(api.Claude.Requests);
    }

    [Fact]
    public async Task The_global_cap_pauses_the_mentor_for_everyone()
    {
        db.SkipIfUnavailable();
        // Fresh day row per test run isn't possible, so the cap is set below any reservation instead.
        using var api = Api(new() { ["Mentor:GlobalDailyBudgetMicros"] = "1" });
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);

        await TestData.ProblemAsync(await SendAsync(client, conversation), HttpStatusCode.TooManyRequests, "mentor-paused");
        Assert.Empty(api.Claude.Requests);
    }

    [Fact]
    public async Task Concurrent_reservations_cannot_overshoot_the_user_budget()
    {
        db.SkipIfUnavailable();
        using var api = Api(new() { ["Mentor:UserDailyBudgetMicros"] = "10000" });
        var userId = Guid.NewGuid();
        await api.Client(userId).GetAsync("/api/me", Ct); // creates the profile

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            await using var scope = api.Factory.Services.CreateAsyncScope();
            var budget = scope.ServiceProvider.GetRequiredService<MentorBudget>();
            return (await budget.ReserveAsync(userId, 3000, Ct)).Outcome;
        }));

        Assert.Equal(3, outcomes.Count(o => o == ReservationOutcome.Reserved));
        var usage = await Query(api, d => d.Set<AiUsageDaily>().AsNoTracking().SingleAsync(u => u.UserId == userId, Ct));
        Assert.Equal(9000, usage.ReservedMicros);
    }

    [Fact]
    public async Task Settling_releases_the_unused_part_of_a_reservation()
    {
        db.SkipIfUnavailable();
        using var api = Api(new() { ["Mentor:UserDailyBudgetMicros"] = "10000" });
        var userId = Guid.NewGuid();
        await api.Client(userId).GetAsync("/api/me", Ct);
        await using var scope = api.Factory.Services.CreateAsyncScope();
        var budget = scope.ServiceProvider.GetRequiredService<MentorBudget>();

        var (_, reservation) = await budget.ReserveAsync(userId, 8000, Ct);
        Assert.Equal(ReservationOutcome.UserBudgetExhausted, (await budget.ReserveAsync(userId, 3000, Ct)).Outcome);
        await budget.SettleAsync(reservation!, new TokenUsage(100, 10, 0, 0), 1500);

        Assert.Equal(ReservationOutcome.Reserved, (await budget.ReserveAsync(userId, 3000, Ct)).Outcome);
        Assert.Equal(55, await budget.RemainingPercentAsync(userId, Ct)); // 10000 − 1500 spent − 3000 reserved
    }

    [Fact]
    public async Task Only_one_message_per_user_is_answered_at_a_time()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var userId = Guid.NewGuid();
        var client = api.Client(userId);
        var conversation = await CreateConversationAsync(client);
        var release = new TaskCompletionSource();
        api.Claude.ReplyAfter(release.Task, "Slow answer.");

        var first = SendAsync(client, conversation, "First");
        await WaitUntil(() => !api.Claude.Requests.IsEmpty);
        await TestData.ProblemAsync(await SendAsync(api.Client(userId), conversation, "Second"), HttpStatusCode.TooManyRequests, "mentor-busy");

        release.SetResult();
        Assert.Equal("done", (await EventsAsync(await first))[^1].Event);
    }

    [Fact]
    public async Task The_kill_switch_turns_the_mentor_off_without_a_restart()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);

        api.Set("Mentor:Enabled", "false");

        await TestData.ProblemAsync(await SendAsync(client, conversation), HttpStatusCode.ServiceUnavailable, "mentor-unavailable");
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/mentor/quota", Ct)).GetProperty("available").GetBoolean());

        api.Set("Mentor:Enabled", "true");
        api.Claude.Reply("Back.");
        Assert.Equal("done", (await EventsAsync(await SendAsync(client, conversation)))[^1].Event);
    }

    [Fact]
    public async Task A_failed_claude_call_ends_the_stream_with_an_error_and_still_settles_the_budget()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var userId = Guid.NewGuid();
        var client = api.Client(userId);
        var conversation = await CreateConversationAsync(client);
        api.Claude.Fail(new IOException("connection reset"));

        var events = await EventsAsync(await SendAsync(client, conversation));

        Assert.Equal("error", events[^1].Event);
        Assert.Equal("https://systemdesignlab.dev/problems/mentor-failed", events[^1].Data.GetProperty("type").GetString());
        var usage = await Query(api, d => d.Set<AiUsageDaily>().AsNoTracking().SingleAsync(u => u.UserId == userId, Ct));
        Assert.Equal(0, usage.ReservedMicros);
        var reply = await Query(api, d => d.Set<AiMessage>().AsNoTracking().SingleAsync(m => m.ConversationId == conversation && m.Role == "assistant", Ct));
        Assert.Equal("error", reply.Status);

        // A failed exchange isn't replayed as history.
        api.Claude.Reply("Works now.");
        await EventsAsync(await SendAsync(client, conversation, "Try again"));
        Assert.Single(api.Claude.Requests.Last().Messages);
    }

    [Fact]
    public async Task A_refusal_is_shown_as_a_friendly_message()
    {
        db.SkipIfUnavailable();
        using var api = Api();
        var client = api.Client();
        var conversation = await CreateConversationAsync(client);
        api.Claude.Reply("", stopReason: "refusal");

        var done = (await EventsAsync(await SendAsync(client, conversation)))[^1];

        Assert.Equal("done", done.Event);
        Assert.StartsWith("I can't help with that request.", done.Data.GetProperty("message").GetProperty("content").GetString());
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++) await Task.Delay(25, Ct);
        Assert.True(condition());
    }
}
