using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

[Collection(DatabaseTestGroup.Name)]
public sealed class ArchitecturesEndpointsTests(PostgresFixture db)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static JsonObject Document(int nodes = 1)
    {
        var nodeArray = new JsonArray();
        var layout = new JsonObject();
        for (var i = 0; i < nodes; i++)
        {
            nodeArray.Add(new JsonObject
            {
                ["id"] = $"n{i}",
                ["type"] = "load-balancer",
                ["label"] = $"LB {i}",
                ["config"] = new JsonObject { ["capacityRps"] = 50000 },
            });
            layout[$"n{i}"] = new JsonObject { ["x"] = i * 10, ["y"] = 0 };
        }
        return new JsonObject
        {
            ["schemaVersion"] = 1,
            ["operations"] = new JsonArray(new JsonObject { ["id"] = "read", ["name"] = "Read", ["kind"] = "read", ["share"] = 1 }),
            ["nodes"] = nodeArray,
            ["edges"] = new JsonArray(),
            ["layout"] = layout,
        };
    }

    private HttpClient NewUser() => db.Api.CreateClientFor(Guid.NewGuid());

    private static async Task<JsonElement> CreateAsync(HttpClient client, string title = "My design", int nodes = 1)
    {
        var response = await client.PostAsJsonAsync("/api/architectures", new { title, document = Document(nodes) }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, Guid id, JsonObject document, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/architectures/{id}") { Content = JsonContent.Create(new { document }) };
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal($"https://systemdesignlab.dev/problems/{type}", problem.GetProperty("type").GetString());
        return problem;
    }

    [Fact]
    public async Task Create_returns_201_with_location_etag_and_the_document()
    {
        db.SkipIfUnavailable();
        var client = NewUser();

        var response = await client.PostAsJsonAsync("/api/architectures",
            new { title = "  URL shortener ", description = "", document = Document(2), challengeSlug = "url-shortener" }, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("\"1\"", response.Headers.ETag?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var id = body.GetProperty("id").GetGuid();
        Assert.Equal($"/api/architectures/{id}", response.Headers.Location?.ToString());
        Assert.Equal("URL shortener", body.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("description").ValueKind);
        Assert.Equal("url-shortener", body.GetProperty("challengeSlug").GetString());
        Assert.Equal(1, body.GetProperty("version").GetInt32());
        Assert.Equal(2, body.GetProperty("document").GetProperty("nodes").GetArrayLength());
    }

    [Fact]
    public async Task Get_returns_the_design_with_its_etag()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var created = await CreateAsync(client);
        var id = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/api/architectures/{id}", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"1\"", response.Headers.ETag?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(created.GetProperty("updatedAt").GetDateTimeOffset(), body.GetProperty("updatedAt").GetDateTimeOffset());
        Assert.Equal("LB 0", body.GetProperty("document").GetProperty("nodes")[0].GetProperty("label").GetString());
    }

    [Fact]
    public async Task List_is_paginated_newest_first_without_documents()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++) ids.Add((await CreateAsync(client, $"Design {i}", nodes: i)).GetProperty("id").GetGuid());

        var seen = new List<JsonElement>();
        string? cursor = null;
        do
        {
            var url = "/api/architectures?limit=2" + (cursor is null ? "" : $"&cursor={cursor}");
            var page = await client.GetFromJsonAsync<JsonElement>(url, Ct);
            var items = page.GetProperty("items").EnumerateArray().ToList();
            Assert.True(items.Count <= 2);
            seen.AddRange(items);
            cursor = page.GetProperty("nextCursor").GetString();
        } while (cursor is not null);

        Assert.Equal(ids.AsEnumerable().Reverse(), seen.Select(s => s.GetProperty("id").GetGuid()));
        Assert.Equal([4, 3, 2, 1, 0], seen.Select(s => s.GetProperty("nodeCount").GetInt32()));
        Assert.All(seen, s => Assert.False(s.TryGetProperty("document", out _)));
    }

    [Theory]
    [InlineData("?limit=0")]
    [InlineData("?limit=101")]
    [InlineData("?cursor=garbage")]
    public async Task Invalid_list_parameters_return_400(string query)
    {
        db.SkipIfUnavailable();
        var response = await NewUser().GetAsync($"/api/architectures{query}", Ct);
        await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Put_with_matching_if_match_saves_and_bumps_the_version()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var response = await PutAsync(client, id, Document(3), "\"1\"");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"2\"", response.Headers.ETag?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(2, body.GetProperty("version").GetInt32());
        var summary = (await client.GetFromJsonAsync<JsonElement>("/api/architectures", Ct)).GetProperty("items")[0];
        Assert.Equal(3, summary.GetProperty("nodeCount").GetInt32());
    }

    [Fact]
    public async Task Put_with_a_stale_version_returns_412_with_the_current_version()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();
        await PutAsync(client, id, Document(2), "\"1\"");

        var response = await PutAsync(client, id, Document(3), "\"1\"");

        var problem = await ProblemAsync(response, HttpStatusCode.PreconditionFailed, "conflict");
        Assert.Equal(2, problem.GetProperty("currentVersion").GetInt32());
        var stored = await client.GetFromJsonAsync<JsonElement>($"/api/architectures/{id}", Ct);
        Assert.Equal(2, stored.GetProperty("document").GetProperty("nodes").GetArrayLength());
    }

    [Fact]
    public async Task Concurrent_puts_with_the_same_version_only_let_one_win()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => PutAsync(client, id, Document(i + 2), "\"1\"")));

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(5, responses.Count(r => r.StatusCode == HttpStatusCode.PreconditionFailed));
    }

    [Fact]
    public async Task Put_without_if_match_returns_428()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var response = await PutAsync(client, id, Document(), ifMatch: null);

        await ProblemAsync(response, (HttpStatusCode)428, "precondition-required");
    }

    [Fact]
    public async Task Patch_renames_without_changing_the_version()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var created = await CreateAsync(client);
        var id = created.GetProperty("id").GetGuid();

        var response = await client.PatchAsJsonAsync($"/api/architectures/{id}", new { title = "Renamed", description = "About it" }, Ct);
        var cleared = await client.PatchAsJsonAsync($"/api/architectures/{id}", new { description = (string?)null }, Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await cleared.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("Renamed", body.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("description").ValueKind);
        Assert.Equal(1, body.GetProperty("version").GetInt32());
        Assert.True(body.GetProperty("updatedAt").GetDateTimeOffset() > created.GetProperty("updatedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Patch_validates_the_title()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var response = await client.PatchAsJsonAsync($"/api/architectures/{id}", new { title = "  " }, Ct);

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("title", out _));
    }

    [Fact]
    public async Task Delete_removes_the_design()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var deleted = await client.DeleteAsync($"/api/architectures/{id}", Ct);
        var again = await client.GetAsync($"/api/architectures/{id}", Ct);

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        await ProblemAsync(again, HttpStatusCode.NotFound, "not-found");
    }

    [Fact]
    public async Task Duplicate_creates_a_copy_at_version_1()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var id = (await CreateAsync(client, new string('t', 100), nodes: 2)).GetProperty("id").GetGuid();
        await PutAsync(client, id, Document(4), "\"1\"");

        var response = await client.PostAsync($"/api/architectures/{id}/duplicate", null, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var copy = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.NotEqual(id, copy.GetProperty("id").GetGuid());
        Assert.Equal(1, copy.GetProperty("version").GetInt32());
        Assert.StartsWith("Copy of ", copy.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.True(copy.GetProperty("title").GetString()!.Length <= 100);
        Assert.Equal(4, copy.GetProperty("document").GetProperty("nodes").GetArrayLength());
    }

    [Fact]
    public async Task Other_users_get_404_on_every_route_and_dont_see_the_design()
    {
        db.SkipIfUnavailable();
        var owner = NewUser();
        var other = NewUser();
        var id = (await CreateAsync(owner)).GetProperty("id").GetGuid();
        var url = $"/api/architectures/{id}";

        var responses = new[]
        {
            await other.GetAsync(url, Ct),
            await PutAsync(other, id, Document(), "\"1\""),
            await other.PatchAsJsonAsync(url, new { title = "Mine now" }, Ct),
            await other.DeleteAsync(url, Ct),
            await other.PostAsync($"{url}/duplicate", null, Ct),
        };

        foreach (var response in responses) await ProblemAsync(response, HttpStatusCode.NotFound, "not-found");
        var list = await other.GetFromJsonAsync<JsonElement>("/api/architectures", Ct);
        Assert.Equal(0, list.GetProperty("items").GetArrayLength());
        var stillThere = await owner.GetFromJsonAsync<JsonElement>(url, Ct);
        Assert.Equal("My design", stillThere.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Documents_over_256_KB_return_400()
    {
        db.SkipIfUnavailable();
        var document = Document();
        document["notes"] = new string('x', 4000);
        // Valid-looking but huge: pad labels across many layout entries to exceed the byte limit.
        var layout = (JsonObject)document["layout"]!;
        for (var i = 0; i < 6000; i++) layout[$"pad-{i:D5}-{new string('p', 40)}"] = new JsonObject { ["x"] = i, ["y"] = i };

        var response = await NewUser().PostAsJsonAsync("/api/architectures", new { title = "Huge", document }, Ct);

        await ProblemAsync(response, HttpStatusCode.BadRequest, "document-too-large");
    }

    [Fact]
    public async Task More_than_150_nodes_returns_400()
    {
        db.SkipIfUnavailable();

        var response = await NewUser().PostAsJsonAsync("/api/architectures", new { title = "Big", document = Document(151) }, Ct);

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("document", out _));
    }

    [Fact]
    public async Task Schema_invalid_documents_return_400_with_document_errors()
    {
        db.SkipIfUnavailable();
        var document = Document();
        document["schemaVersion"] = 2;

        var response = await NewUser().PostAsJsonAsync("/api/architectures", new { title = "Bad", document }, Ct);

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").GetProperty("document").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Import_is_idempotent_per_key()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId);
        var (key1, key2) = (Guid.NewGuid(), Guid.NewGuid());
        var body = new
        {
            designs = new object[]
            {
                new { importKey = key1, title = "Guest design", document = Document() },
                new { importKey = key2, title = "Another", document = Document(2) },
                new { importKey = key1, title = "Same key again", document = Document() },
            },
        };

        var first = await (await client.PostAsJsonAsync("/api/architectures/import", body, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct);
        var second = await (await client.PostAsJsonAsync("/api/architectures/import", body, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct);

        var firstResults = first.GetProperty("results").EnumerateArray().ToList();
        var secondResults = second.GetProperty("results").EnumerateArray().ToList();
        Assert.Equal(2, firstResults.Count);
        Assert.All(firstResults, r => Assert.True(r.GetProperty("created").GetBoolean()));
        Assert.All(secondResults, r => Assert.False(r.GetProperty("created").GetBoolean()));
        Assert.Equal(firstResults.Select(r => r.GetProperty("id").GetGuid()), secondResults.Select(r => r.GetProperty("id").GetGuid()));
        Assert.Equal(2, await db.QueryAsync(c => c.Architectures.CountAsync(a => a.OwnerId == userId, Ct)));
    }

    [Fact]
    public async Task Concurrent_imports_of_the_same_key_create_one_design()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId);
        await client.GetAsync("/api/me", Ct); // provision first so the requests race only on the import
        var body = new { designs = new[] { new { importKey = Guid.NewGuid(), title = "Guest design", document = Document() } } };

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => client.PostAsJsonAsync("/api/architectures/import", body, Ct)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await db.QueryAsync(c => c.Architectures.CountAsync(a => a.OwnerId == userId, Ct)));
    }

    [Fact]
    public async Task Import_validates_each_design()
    {
        db.SkipIfUnavailable();
        var body = new { designs = new object[] { new { importKey = Guid.Empty, title = "", document = new { } } } };

        var response = await NewUser().PostAsJsonAsync("/api/architectures/import", body, Ct);

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("designs[0].importKey", out _));
        Assert.True(errors.TryGetProperty("designs[0].title", out _));
        Assert.True(errors.TryGetProperty("designs[0].document", out _));
    }

    [Fact]
    public async Task Import_requires_one_to_ten_designs()
    {
        db.SkipIfUnavailable();
        var client = NewUser();
        var tooMany = Enumerable.Range(0, 11).Select(_ => new { importKey = Guid.NewGuid(), title = "x", document = Document() }).ToArray();

        await ProblemAsync(await client.PostAsJsonAsync("/api/architectures/import", new { designs = Array.Empty<object>() }, Ct),
            HttpStatusCode.BadRequest, "validation");
        await ProblemAsync(await client.PostAsJsonAsync("/api/architectures/import", new { designs = tooMany }, Ct),
            HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Migration_enables_row_level_security_on_architectures()
    {
        db.SkipIfUnavailable();
        var rls = await db.QueryAsync(c => c.Database
            .SqlQuery<bool>($"SELECT relrowsecurity AS \"Value\" FROM pg_class WHERE oid = 'app.architectures'::regclass")
            .SingleAsync(Ct));

        Assert.True(rls);
    }
}
