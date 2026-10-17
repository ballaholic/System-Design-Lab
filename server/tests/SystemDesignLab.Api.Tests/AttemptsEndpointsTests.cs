using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

[Collection(DatabaseTestGroup.Name)]
public sealed class AttemptsEndpointsTests(PostgresFixture db)
{
    private const string Slug = "url-shortener";
    private const string At = "2026-10-17T10:00:00Z";
    private static readonly string[] TwoHints = ["s1-path", "s1-flows"];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private HttpClient NewUser() => db.Api.CreateClientFor(Guid.NewGuid());

    private static async Task<JsonElement> StartAsync(HttpClient client, object? body = null)
    {
        var response = await client.PostAsJsonAsync("/api/attempts", body ?? new { challengeSlug = Slug, mode = "guided" }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    private static Task<HttpResponseMessage> PatchAsync(HttpClient client, Guid id, object body) =>
        client.PatchAsJsonAsync($"/api/attempts/{id}", body, Ct);

    private static object StageResult(bool passed = true) => new
    {
        passedAt = At,
        criteria = new object[] { new { id = "s1-path", passed, detail = "Connected." }, new { id = "x", passed = false, detail = "", optional = true } },
        engineVersion = "1.0.0",
    };

    [Fact]
    public async Task Start_returns_the_attempt_at_the_first_stage()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var architectureId = await TestData.CreateArchitectureAsync(client);

        var response = await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "guided", architectureId }, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var attempt = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var id = attempt.GetProperty("id").GetGuid();
        Assert.Equal($"/api/attempts/{id}", response.Headers.Location?.ToString());
        Assert.Equal(Slug, attempt.GetProperty("challengeSlug").GetString());
        Assert.Equal(1, attempt.GetProperty("challengeVersion").GetInt32());
        Assert.Equal("guided", attempt.GetProperty("mode").GetString());
        Assert.Equal("in_progress", attempt.GetProperty("status").GetString());
        Assert.Equal("s1-baseline", attempt.GetProperty("currentStageId").GetString());
        Assert.Equal(architectureId, attempt.GetProperty("architectureId").GetGuid());
        Assert.Equal(JsonValueKind.Object, attempt.GetProperty("stageResults").ValueKind);
        Assert.Equal(0, attempt.GetProperty("hintsRevealed").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, attempt.GetProperty("completedAt").ValueKind);

        var fetched = await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{id}", Ct);
        Assert.Equal(attempt.GetProperty("startedAt").GetDateTimeOffset(), fetched.GetProperty("startedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task A_second_start_returns_409_with_the_existing_attempt_and_restart_abandons_it()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId);
        var first = (await StartAsync(client)).GetProperty("id").GetGuid();

        var conflict = await TestData.ProblemAsync(
            await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "guided" }, Ct),
            HttpStatusCode.Conflict, "attempt-in-progress");
        Assert.Equal(first, conflict.GetProperty("attemptId").GetGuid());

        var second = (await StartAsync(client, new { challengeSlug = Slug, mode = "guided", restart = true })).GetProperty("id").GetGuid();

        Assert.NotEqual(first, second);
        var statuses = await db.QueryAsync(c => c.Attempts.Where(a => a.UserId == userId).OrderBy(a => a.StartedAt).Select(a => a.Status).ToListAsync(Ct));
        Assert.Equal(["abandoned", "in_progress"], statuses);
        var inProgress = await client.GetFromJsonAsync<JsonElement>("/api/attempts?status=in_progress", Ct);
        Assert.Equal(second, Assert.Single(inProgress.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Concurrent_starts_leave_exactly_one_attempt_in_progress()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId);
        await client.GetAsync("/api/me", Ct);

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ =>
            client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "guided" }, Ct)));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.Created), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Equal(1, await db.QueryAsync(c => c.Attempts.CountAsync(a => a.UserId == userId && a.Status == "in_progress", Ct)));
    }

    [Fact]
    public async Task Start_validates_the_challenge_mode_and_design()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var someoneElsesDesign = await TestData.CreateArchitectureAsync(NewUser());

        await TestData.AssertInvalidAsync(await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = "nope", mode = "guided" }, Ct), "challengeSlug");
        await TestData.AssertInvalidAsync(await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "speedrun" }, Ct), "mode");
        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "guided", architectureId = someoneElsesDesign }, Ct),
            "architectureId");

        // Interview mode uses the AI mentor, so it needs a verified email.
        var unverified = db.Api.CreateClientFor(Guid.NewGuid(), new() { ["email_verified"] = false });
        await TestData.ProblemAsync(
            await unverified.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "interview" }, Ct),
            HttpStatusCode.Forbidden, "email-not-verified");
    }

    [Fact]
    public async Task A_verified_user_can_start_in_interview_mode()
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid(), new() { ["email_verified"] = true });

        var attempt = await StartAsync(client, new { challengeSlug = Slug, mode = "interview" });

        Assert.Equal("interview", attempt.GetProperty("mode").GetString());
    }

    [Fact]
    public async Task Patch_saves_progress_and_bumps_last_activity()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var attempt = await StartAsync(client);
        var id = attempt.GetProperty("id").GetGuid();
        var architectureId = await TestData.CreateArchitectureAsync(client);

        var response = await PatchAsync(client, id, new
        {
            currentStageId = "s2-viral",
            stageResults = new Dictionary<string, object> { ["s1-baseline"] = StageResult() },
            exerciseAnswers = new Dictionary<string, object>
            {
                ["est-redirect-rate"] = new { kind = "estimate", value = 120, correct = true, attempts = 2, revealed = false, answeredAt = At },
                ["id-generation"] = new { kind = "decision", optionId = "counter-base62", answeredAt = At },
            },
            hintsRevealed = TwoHints,
            architectureId,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("s2-viral", body.GetProperty("currentStageId").GetString());
        Assert.True(body.GetProperty("stageResults").GetProperty("s1-baseline").GetProperty("criteria")[0].GetProperty("passed").GetBoolean());
        Assert.Equal("counter-base62", body.GetProperty("exerciseAnswers").GetProperty("id-generation").GetProperty("optionId").GetString());
        Assert.Equal(["s1-path", "s1-flows"], body.GetProperty("hintsRevealed").EnumerateArray().Select(h => h.GetString()));
        Assert.Equal(architectureId, body.GetProperty("architectureId").GetGuid());
        Assert.True(body.GetProperty("lastActivityAt").GetDateTimeOffset() >= attempt.GetProperty("lastActivityAt").GetDateTimeOffset());

        var unlinked = await (await PatchAsync(client, id, new { architectureId = (Guid?)null })).Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(JsonValueKind.Null, unlinked.GetProperty("architectureId").ValueKind);
        Assert.Equal("s2-viral", unlinked.GetProperty("currentStageId").GetString()); // absent fields are unchanged
    }

    [Fact]
    public async Task Completing_sets_completed_at_and_freezes_the_attempt()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await StartAsync(client)).GetProperty("id").GetGuid();

        var completed = await (await PatchAsync(client, id, new { status = "completed" })).Content.ReadFromJsonAsync<JsonElement>(Ct);

        Assert.Equal("completed", completed.GetProperty("status").GetString());
        Assert.NotEqual(JsonValueKind.Null, completed.GetProperty("completedAt").ValueKind);
        await TestData.ProblemAsync(await PatchAsync(client, id, new { currentStageId = "s2-viral" }), HttpStatusCode.Conflict, "attempt-not-in-progress");
        // A completed attempt doesn't block starting again.
        await StartAsync(client);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/attempts", Ct);
        Assert.Equal(2, list.GetProperty("items").GetArrayLength());
        Assert.Equal("in_progress", list.GetProperty("items")[0].GetProperty("status").GetString());
    }

    public static TheoryData<string, string> InvalidPatches => new()
    {
        { """{"currentStageId":"s9"}""", "currentStageId" },
        { """{"stageResults":[]}""", "stageResults" },
        { """{"stageResults":{"s9":{"criteria":[],"engineVersion":"1"}}}""", "stageResults.s9" },
        { """{"stageResults":{"s1-baseline":{"criteria":[],"engineVersion":"1","extra":1}}}""", "stageResults.s1-baseline.extra" },
        { """{"stageResults":{"s1-baseline":{"criteria":[]}}}""", "stageResults.s1-baseline.engineVersion" },
        { """{"stageResults":{"s1-baseline":{"criteria":[],"engineVersion":"1","passedAt":"yesterday"}}}""", "stageResults.s1-baseline.passedAt" },
        { """{"stageResults":{"s1-baseline":{"criteria":[{"id":"a","passed":"yes","detail":""}],"engineVersion":"1"}}}""", "stageResults.s1-baseline.criteria[0].passed" },
        { """{"exerciseAnswers":{"nope":{"kind":"decision","optionId":"x","answeredAt":"2026-10-17T10:00:00Z"}}}""", "exerciseAnswers.nope" },
        { """{"exerciseAnswers":{"id-generation":{"kind":"estimate","value":1,"correct":true,"attempts":1,"revealed":false,"answeredAt":"2026-10-17T10:00:00Z"}}}""", "exerciseAnswers.id-generation.kind" },
        { """{"exerciseAnswers":{"id-generation":{"kind":"decision","optionId":"made-up","answeredAt":"2026-10-17T10:00:00Z"}}}""", "exerciseAnswers.id-generation.optionId" },
        { """{"exerciseAnswers":{"est-storage":{"kind":"estimate","value":"big","correct":true,"attempts":1,"revealed":false,"answeredAt":"2026-10-17T10:00:00Z"}}}""", "exerciseAnswers.est-storage.value" },
        { """{"exerciseAnswers":{"est-storage":{"kind":"estimate","value":1,"correct":true,"attempts":-1,"revealed":false,"answeredAt":"2026-10-17T10:00:00Z"}}}""", "exerciseAnswers.est-storage.attempts" },
        { """{"hintsRevealed":["s1-path","s1-path"]}""", "hintsRevealed" },
        { """{"hintsRevealed":["not-a-hint"]}""", "hintsRevealed" },
        { """{"architectureId":"not-a-guid"}""", "architectureId" },
        { """{"status":"paused"}""", "status" },
    };

    [Theory]
    [MemberData(nameof(InvalidPatches))]
    public async Task Patch_rejects_progress_that_doesnt_match_the_challenge(string json, string field)
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await StartAsync(client)).GetProperty("id").GetGuid();

        var response = await client.PatchAsync($"/api/attempts/{id}", new StringContent(json, System.Text.Encoding.UTF8, "application/json"), Ct);

        await TestData.AssertInvalidAsync(response, field);
    }

    [Fact]
    public async Task Another_users_attempt_is_not_found()
    {
        db.SkipIfUnavailable();
        var id = (await StartAsync(NewUser())).GetProperty("id").GetGuid();
        var other = NewUser();

        await TestData.ProblemAsync(await other.GetAsync($"/api/attempts/{id}", Ct), HttpStatusCode.NotFound, "not-found");
        await TestData.ProblemAsync(await PatchAsync(other, id, new { currentStageId = "s2-viral" }), HttpStatusCode.NotFound, "not-found");
        Assert.Equal(0, (await other.GetFromJsonAsync<JsonElement>("/api/attempts", Ct)).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task List_rejects_an_unknown_status_filter()
    {
        db.SkipIfUnavailable();
        await TestData.AssertInvalidAsync(await NewUser().GetAsync("/api/attempts?status=paused", Ct), "status");
    }

    [Fact]
    public async Task Deleting_the_linked_design_keeps_the_attempt()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var architectureId = await TestData.CreateArchitectureAsync(client);
        var id = (await StartAsync(client, new { challengeSlug = Slug, mode = "guided", architectureId })).GetProperty("id").GetGuid();

        await client.DeleteAsync($"/api/architectures/{architectureId}", Ct);

        var attempt = await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{id}", Ct);
        Assert.Equal(JsonValueKind.Null, attempt.GetProperty("architectureId").ValueKind);
    }
}
