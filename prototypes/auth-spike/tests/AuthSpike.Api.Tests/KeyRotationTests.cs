using System.Net;
using System.Net.Http.Headers;
using Microsoft.IdentityModel.Tokens;

namespace AuthSpike.Api.Tests;

/// <summary>
/// Supabase rotation: a standby key is published in the JWKS, then becomes the signing key. The API must accept
/// tokens signed by the new key without a restart, and keep accepting unexpired tokens signed by the previous key
/// while it is still published.
/// </summary>
public sealed class KeyRotationTests
{
    private static async Task<HttpStatusCode> GetMe(HttpClient client, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        return response.StatusCode;
    }

    /// <summary>JWKS refetch on an unknown kid can complete in the background, so the first request may still fail.</summary>
    private static async Task<HttpStatusCode> GetMeEventually(HttpClient client, string token, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        HttpStatusCode status;
        do
        {
            status = await GetMe(client, token);
            if (status == HttpStatusCode.OK) return status;
            await Task.Delay(250, TestContext.Current.CancellationToken);
        } while (DateTime.UtcNow < deadline);
        return status;
    }

    [Fact]
    public async Task Token_signed_by_a_newly_rotated_key_is_accepted_without_restart()
    {
        await using var server = new TestAuthServer { JwksRefreshInterval = TimeSpan.FromSeconds(1) };
        var client = server.CreateClient();
        var oldToken = server.CreateToken();
        Assert.Equal(HttpStatusCode.OK, await GetMe(client, oldToken)); // JWKS with the old key is now cached

        var rotated = TestAuthServer.NewKey("rotated-key");
        lock (server.PublishedKeys) server.PublishedKeys.Add(rotated);
        var newToken = server.CreateToken(credentials: new SigningCredentials(rotated, SecurityAlgorithms.EcdsaSha256));

        Assert.Equal(HttpStatusCode.OK, await GetMeEventually(client, newToken, TimeSpan.FromSeconds(10)));
        Assert.Equal(HttpStatusCode.OK, await GetMe(client, oldToken)); // previous key still published ⇒ still valid
        Assert.True(server.RequestedJwksAddresses.Count >= 2, "the JWKS should have been refetched after rotation");
    }

    [Fact]
    public async Task Unknown_kid_never_published_stays_rejected()
    {
        await using var server = new TestAuthServer { JwksRefreshInterval = TimeSpan.FromSeconds(1) };
        var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, await GetMe(client, server.CreateToken()));

        var rogue = TestAuthServer.NewKey("rogue-key");
        var token = server.CreateToken(credentials: new SigningCredentials(rogue, SecurityAlgorithms.EcdsaSha256));

        Assert.Equal(HttpStatusCode.Unauthorized, await GetMeEventually(client, token, TimeSpan.FromSeconds(3)));
    }
}
