using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

[Collection(DatabaseTestGroup.Name)]
public sealed class UsersEndpointsTests(PostgresFixture db)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static Dictionary<string, object> Metadata(params (string Key, object Value)[] entries) =>
        entries.ToDictionary(e => e.Key, e => e.Value);

    [Fact]
    public async Task First_request_provisions_a_profile_from_the_token()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        var client = db.Api.CreateClientFor(userId, Metadata(("display_name", "Ada"), ("email_verified", true)), "ada@example.com");

        var me = await client.GetFromJsonAsync<JsonElement>("/api/me", Ct);

        Assert.Equal(userId, me.GetProperty("id").GetGuid());
        Assert.Equal("Ada", me.GetProperty("displayName").GetString());
        Assert.Equal("ada@example.com", me.GetProperty("email").GetString());
        Assert.True(me.GetProperty("emailVerified").GetBoolean());
        Assert.Equal(1, await db.QueryAsync(c => c.UserProfiles.CountAsync(p => p.Id == userId, Ct)));
    }

    [Fact]
    public async Task Later_requests_reuse_the_same_profile()
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid());

        var first = await client.GetFromJsonAsync<JsonElement>("/api/me", Ct);
        var second = await client.GetFromJsonAsync<JsonElement>("/api/me", Ct);

        Assert.Equal(first.GetProperty("createdAt").GetDateTimeOffset(), second.GetProperty("createdAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Concurrent_first_requests_create_exactly_one_profile()
    {
        db.SkipIfUnavailable();
        var userId = Guid.NewGuid();
        // Separate factories have separate memory caches, so every request really attempts the insert.
        await using var otherApi = new ApiFactory(db.ConnectionString);
        var clients = Enumerable.Range(0, 8).Select(i => (i % 2 == 0 ? db.Api : otherApi).CreateClientFor(userId)).ToList();

        var responses = await Task.WhenAll(clients.Select(c => c.GetAsync("/api/me", Ct)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await db.QueryAsync(c => c.UserProfiles.CountAsync(p => p.Id == userId, Ct)));
    }

    [Fact]
    public async Task Google_profile_name_and_avatar_are_used()
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid(),
            Metadata(("full_name", "Grace Hopper"), ("avatar_url", "https://lh3.googleusercontent.com/a/xyz")));

        var me = await client.GetFromJsonAsync<JsonElement>("/api/me", Ct);

        Assert.Equal("Grace Hopper", me.GetProperty("displayName").GetString());
        Assert.Equal("https://lh3.googleusercontent.com/a/xyz", me.GetProperty("avatarUrl").GetString());
    }

    [Fact]
    public async Task Display_name_can_be_updated_and_persists()
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid());

        var patch = await client.PatchAsJsonAsync("/api/me", new { displayName = "  New Name  " }, Ct);
        var me = await client.GetFromJsonAsync<JsonElement>("/api/me", Ct);

        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);
        Assert.Equal("New Name", me.GetProperty("displayName").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("tab\tinside")]
    public async Task Invalid_display_names_return_field_errors(string displayName)
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid());

        var response = await client.PatchAsJsonAsync("/api/me", new { displayName }, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("https://systemdesignlab.dev/problems/validation", problem.GetProperty("type").GetString());
        Assert.True(problem.GetProperty("errors").TryGetProperty("displayName", out _));
    }

    [Fact]
    public async Task Display_name_longer_than_60_characters_is_rejected()
    {
        db.SkipIfUnavailable();
        var client = db.Api.CreateClientFor(Guid.NewGuid());

        var response = await client.PatchAsJsonAsync("/api/me", new { displayName = new string('x', 61) }, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Users_only_ever_see_and_change_their_own_profile()
    {
        db.SkipIfUnavailable();
        var (alice, bob) = (Guid.NewGuid(), Guid.NewGuid());
        var aliceClient = db.Api.CreateClientFor(alice, Metadata(("display_name", "Alice")));
        var bobClient = db.Api.CreateClientFor(bob, Metadata(("display_name", "Bob")));

        await aliceClient.PatchAsJsonAsync("/api/me", new { displayName = "Alice Updated" }, Ct);
        var bobMe = await bobClient.GetFromJsonAsync<JsonElement>("/api/me", Ct);

        Assert.Equal(bob, bobMe.GetProperty("id").GetGuid());
        Assert.Equal("Bob", bobMe.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Migration_enables_row_level_security_on_app_tables()
    {
        db.SkipIfUnavailable();
        var rls = await db.QueryAsync(c => c.Database
            .SqlQuery<bool>($"SELECT relrowsecurity AS \"Value\" FROM pg_class WHERE oid = 'app.user_profiles'::regclass")
            .SingleAsync(Ct));

        Assert.True(rls);
    }
}
