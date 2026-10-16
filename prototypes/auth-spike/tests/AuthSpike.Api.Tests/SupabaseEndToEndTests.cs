using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace AuthSpike.Api.Tests;

/// <summary>
/// Signs in to a real hosted Supabase project and calls the API with the issued access token.
/// Skipped unless SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD are set.
/// </summary>
public sealed class SupabaseEndToEndTests(ITestOutputHelper output)
{
    private sealed record Settings(string Url, string PublishableKey, string Email, string Password);

    private static Settings? LoadSettings()
    {
        string? Env(string name) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } v ? v : null;
        var url = Env("SUPABASE_URL");
        var key = Env("SUPABASE_PUBLISHABLE_KEY");
        var email = Env("SUPABASE_TEST_EMAIL");
        var password = Env("SUPABASE_TEST_PASSWORD");
        return url is null || key is null || email is null || password is null
            ? null
            : new Settings(url.TrimEnd('/'), key, email, password);
    }

    private sealed class RealSupabaseApi(string projectUrl) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.UseSetting("Supabase:ProjectUrl", projectUrl);
    }

    [Fact]
    public async Task Real_supabase_session_is_accepted_and_maps_to_the_same_user()
    {
        var settings = LoadSettings();
        if (settings is null)
        {
            Assert.Skip("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD to run.");
            return;
        }
        var cancel = TestContext.Current.CancellationToken;

        // 1. Password sign-in against Supabase Auth (what supabase-js does in the browser).
        using var supabase = new HttpClient();
        supabase.DefaultRequestHeaders.Add("apikey", settings.PublishableKey);
        var signIn = await supabase.PostAsJsonAsync(
            $"{settings.Url}/auth/v1/token?grant_type=password",
            new { email = settings.Email, password = settings.Password },
            cancel);
        var session = await signIn.Content.ReadFromJsonAsync<JsonElement>(cancel);
        Assert.True(signIn.IsSuccessStatusCode, $"Supabase sign-in failed: {session}");
        var accessToken = session.GetProperty("access_token").GetString()!;
        var supabaseUserId = session.GetProperty("user").GetProperty("id").GetGuid();

        // 2. Call our API with the Supabase-issued token.
        using var api = new RealSupabaseApi(settings.Url);
        var client = api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        var me = await client.GetAsync("/me", cancel);
        var body = await me.Content.ReadAsStringAsync(cancel);
        output.WriteLine($"/me → {(int)me.StatusCode}: {body}");

        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var json = JsonDocument.Parse(body).RootElement;
        Assert.Equal(supabaseUserId, json.GetProperty("id").GetGuid());
        Assert.Equal(settings.Email, json.GetProperty("email").GetString(), ignoreCase: true);

        // 3. The same token with one character changed in the signature must be rejected.
        var tampered = accessToken[..^2] + (accessToken[^2] == 'A' ? 'B' : 'A') + accessToken[^1];
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tampered);
        var rejected = await client.GetAsync("/me", cancel);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
    }
}
