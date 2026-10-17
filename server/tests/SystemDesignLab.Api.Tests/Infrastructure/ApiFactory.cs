using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;

namespace SystemDesignLab.Api.Tests.Infrastructure;

/// <summary>The real API pipeline with test Supabase keys and a configurable database and rate limit.</summary>
public class ApiFactory(string? connectionString = null, int permitsPerMinute = 10_000, Action<IWebHostBuilder>? configure = null)
    : WebApplicationFactory<Program>
{
    public const string WebOrigin = "http://localhost:5173";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Supabase:ProjectUrl", TestTokens.ProjectUrl);
        // Never used by tests that stop at authentication; a real one is passed for database tests.
        builder.UseSetting("ConnectionStrings:Database", connectionString ?? "Host=unused.invalid;Database=unused");
        builder.UseSetting("RateLimiting:PermitsPerMinute", permitsPerMinute.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.UseSetting("Cors:AllowedOrigins:0", WebOrigin);
        builder.ConfigureTestServices(services => services.AddSingleton<IDocumentRetriever>(new TestTokens.JwksRetriever()));
        configure?.Invoke(builder);
    }

    public HttpClient CreateClientFor(Guid userId, Dictionary<string, object>? userMetadata = null, string email = "learner@example.com")
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", TestTokens.Create(userId, email, userMetadata));
        return client;
    }
}

/// <summary>Default factory for class fixtures (xUnit needs a parameterless constructor).</summary>
public sealed class DefaultApiFactory : ApiFactory;
