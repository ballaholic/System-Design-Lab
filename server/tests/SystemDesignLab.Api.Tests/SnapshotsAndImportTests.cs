using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

[Collection(DatabaseTestGroup.Name)]
public sealed class SnapshotsAndImportTests(PostgresFixture db)
{
    private const string Slug = "url-shortener";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private HttpClient NewUser() => db.Api.CreateClientFor(Guid.NewGuid());

    // ---- Snapshots ----

    [Fact]
    public async Task Snapshots_copy_the_stored_or_the_given_document_and_list_newest_first()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = await TestData.CreateArchitectureAsync(client, nodes: 2);

        var stored = await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = "  Before the cache " }, Ct);
        Assert.Equal(HttpStatusCode.Created, stored.StatusCode);
        var first = await stored.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("Before the cache", first.GetProperty("label").GetString());
        Assert.Equal(2, first.GetProperty("nodeCount").GetInt32());

        var given = await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots",
            new { label = "Stage 1 passed", document = TestData.Document(5) }, Ct);
        Assert.Equal(HttpStatusCode.Created, given.StatusCode);
        Assert.Equal(5, (await given.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("nodeCount").GetInt32());

        var list = (await client.GetFromJsonAsync<JsonElement>($"/api/architectures/{id}/snapshots", Ct)).GetProperty("items");
        Assert.Equal(["Stage 1 passed", "Before the cache"], list.EnumerateArray().Select(s => s.GetProperty("label").GetString()));
        Assert.All(list.EnumerateArray(), s => Assert.False(s.TryGetProperty("document", out _)));
    }

    [Fact]
    public async Task Only_the_newest_20_snapshots_are_kept()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = await TestData.CreateArchitectureAsync(client);
        for (var i = 1; i <= 22; i++)
        {
            var response = await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = $"Snapshot {i}" }, Ct);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var labels = (await client.GetFromJsonAsync<JsonElement>($"/api/architectures/{id}/snapshots", Ct))
            .GetProperty("items").EnumerateArray().Select(s => s.GetProperty("label").GetString()).ToList();

        Assert.Equal(20, labels.Count);
        Assert.Equal("Snapshot 22", labels[0]);
        Assert.Equal("Snapshot 3", labels[^1]);
        Assert.Equal(20, await db.QueryAsync(c => c.ArchitectureSnapshots.CountAsync(s => s.ArchitectureId == id, Ct)));
    }

    [Fact]
    public async Task Snapshots_validate_input_and_are_owner_scoped()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = await TestData.CreateArchitectureAsync(client);

        await TestData.AssertInvalidAsync(await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = " " }, Ct), "label");
        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = new string('x', 101) }, Ct), "label");
        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = "Bad", document = new { schemaVersion = 1 } }, Ct),
            "document");

        var other = NewUser();
        await TestData.ProblemAsync(await other.GetAsync($"/api/architectures/{id}/snapshots", Ct), HttpStatusCode.NotFound, "not-found");
        await TestData.ProblemAsync(
            await other.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = "Mine now" }, Ct), HttpStatusCode.NotFound, "not-found");
    }

    [Fact]
    public async Task Deleting_a_design_deletes_its_snapshots()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = await TestData.CreateArchitectureAsync(client);
        await client.PostAsJsonAsync($"/api/architectures/{id}/snapshots", new { label = "One" }, Ct);

        await client.DeleteAsync($"/api/architectures/{id}", Ct);

        Assert.Equal(0, await db.QueryAsync(c => c.ArchitectureSnapshots.CountAsync(s => s.ArchitectureId == id, Ct)));
    }

    // ---- Guest import with attempts ----

    private static object GuestAttempt(Guid importKey, Guid? architectureImportKey, string status = "in_progress", string lastActivityAt = "2026-10-17T10:00:00Z") => new
    {
        importKey,
        challengeSlug = Slug,
        challengeVersion = 1,
        mode = "guided",
        status,
        currentStageId = "s2-viral",
        architectureImportKey,
        stageResults = new Dictionary<string, object>
        {
            ["s1-baseline"] = new { passedAt = "2026-10-17T09:00:00Z", criteria = new[] { new { id = "s1-path", passed = true, detail = "Connected." } }, engineVersion = "1.0.0" },
        },
        exerciseAnswers = new Dictionary<string, object> { ["id-generation"] = new { kind = "decision", optionId = "random", answeredAt = "2026-10-17T09:00:00Z" } },
        hintsRevealed = new[] { "s1-path" },
        startedAt = "2026-10-17T08:00:00Z",
        lastActivityAt,
    };

    [Fact]
    public async Task Import_brings_guest_attempts_linked_to_their_designs_and_is_idempotent()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var designKey = Guid.NewGuid();
        var attemptKey = Guid.NewGuid();
        var body = new
        {
            designs = new[] { new { importKey = designKey, title = "URL Shortener", document = TestData.Document(), challengeSlug = Slug } },
            attempts = new[] { GuestAttempt(attemptKey, designKey) },
        };

        var first = await (await client.PostAsJsonAsync("/api/architectures/import", body, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct);
        var second = await (await client.PostAsJsonAsync("/api/architectures/import", body, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct);

        var designId = first.GetProperty("results")[0].GetProperty("id").GetGuid();
        var created = first.GetProperty("attemptResults")[0];
        Assert.True(created.GetProperty("created").GetBoolean());
        Assert.False(second.GetProperty("attemptResults")[0].GetProperty("created").GetBoolean());
        Assert.Equal(created.GetProperty("id").GetGuid(), second.GetProperty("attemptResults")[0].GetProperty("id").GetGuid());

        var attempt = await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{created.GetProperty("id").GetGuid()}", Ct);
        Assert.Equal(designId, attempt.GetProperty("architectureId").GetGuid());
        Assert.Equal("s2-viral", attempt.GetProperty("currentStageId").GetString());
        Assert.Equal("in_progress", attempt.GetProperty("status").GetString());
        Assert.Equal("random", attempt.GetProperty("exerciseAnswers").GetProperty("id-generation").GetProperty("optionId").GetString());
        Assert.Equal(["s1-path"], attempt.GetProperty("hintsRevealed").EnumerateArray().Select(h => h.GetString()));
    }

    [Fact]
    public async Task Importing_attempts_alone_links_designs_from_an_earlier_import()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var designKey = Guid.NewGuid();
        var designs = await (await client.PostAsJsonAsync("/api/architectures/import",
            new { designs = new[] { new { importKey = designKey, title = "Earlier", document = TestData.Document() } } }, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct);

        var response = await client.PostAsJsonAsync("/api/architectures/import",
            new { attempts = new[] { GuestAttempt(Guid.NewGuid(), designKey), GuestAttempt(Guid.NewGuid(), Guid.NewGuid(), status: "completed") } }, Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var results = (await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("attemptResults");
        var linked = await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{results[0].GetProperty("id").GetGuid()}", Ct);
        Assert.Equal(designs.GetProperty("results")[0].GetProperty("id").GetGuid(), linked.GetProperty("architectureId").GetGuid());
        var unknownDesign = await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{results[1].GetProperty("id").GetGuid()}", Ct);
        Assert.Equal(JsonValueKind.Null, unknownDesign.GetProperty("architectureId").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, unknownDesign.GetProperty("completedAt").ValueKind);
    }

    [Fact]
    public async Task On_an_in_progress_collision_the_more_recent_attempt_stays_in_progress()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId);
        var serverAttempt = (await (await client.PostAsJsonAsync("/api/attempts", new { challengeSlug = Slug, mode = "guided" }, Ct))
            .Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();

        // Older guest progress: imported, but abandoned.
        var older = await client.PostAsJsonAsync("/api/architectures/import",
            new { attempts = new[] { GuestAttempt(Guid.NewGuid(), null, lastActivityAt: "2020-01-01T00:00:00Z") } }, Ct);
        var olderId = (await older.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("attemptResults")[0].GetProperty("id").GetGuid();
        Assert.Equal("abandoned", (await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{olderId}", Ct)).GetProperty("status").GetString());
        Assert.Equal("in_progress", (await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{serverAttempt}", Ct)).GetProperty("status").GetString());

        // Newer guest progress wins and the server attempt is abandoned.
        var newer = await client.PostAsJsonAsync("/api/architectures/import",
            new { attempts = new[] { GuestAttempt(Guid.NewGuid(), null, lastActivityAt: "2099-01-01T00:00:00Z") } }, Ct);
        var newerId = (await newer.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("attemptResults")[0].GetProperty("id").GetGuid();
        Assert.Equal("in_progress", (await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{newerId}", Ct)).GetProperty("status").GetString());
        Assert.Equal("abandoned", (await client.GetFromJsonAsync<JsonElement>($"/api/attempts/{serverAttempt}", Ct)).GetProperty("status").GetString());
        Assert.Equal(1, await db.QueryAsync(c => c.Attempts.CountAsync(a => a.UserId == userId && a.Status == "in_progress", Ct)));
    }

    [Fact]
    public async Task Import_validates_attempts_like_patch()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var bad = new
        {
            importKey = Guid.Empty,
            challengeSlug = Slug,
            challengeVersion = 1,
            mode = "interview",
            status = "paused",
            currentStageId = "s9",
            hintsRevealed = new[] { "not-a-hint" },
            startedAt = "2026-10-17T08:00:00Z",
            lastActivityAt = "2026-10-17T08:00:00Z",
        };

        var response = await client.PostAsJsonAsync("/api/architectures/import", new { attempts = new[] { bad } }, Ct);

        var errors = (await TestData.ProblemAsync(response, HttpStatusCode.BadRequest, "validation")).GetProperty("errors");
        foreach (var field in new[] { "importKey", "mode", "status", "currentStageId", "hintsRevealed" })
            Assert.True(errors.TryGetProperty($"attempts[0].{field}", out _), $"missing attempts[0].{field} in {errors}");

        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync("/api/architectures/import", new { attempts = new[] { new { importKey = Guid.NewGuid(), challengeSlug = "nope" } } }, Ct),
            "attempts[0].challengeSlug");
        await TestData.AssertInvalidAsync(
            await client.PostAsJsonAsync("/api/architectures/import",
                new { attempts = Enumerable.Range(0, 11).Select(_ => GuestAttempt(Guid.NewGuid(), null)).ToArray() }, Ct),
            "attempts");
    }
}
