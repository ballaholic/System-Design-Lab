using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using SystemDesignLab.Api.Common;

namespace SystemDesignLab.Api.Infrastructure.Auth;

public sealed class SupabaseAuthOptions
{
    public const string Section = "Supabase";

    /// <summary>Project URL, e.g. https://abcd1234.supabase.co</summary>
    [Required, Url]
    public string ProjectUrl { get; init; } = "";

    public string Audience { get; init; } = "authenticated";

    /// <summary>Minimum time between JWKS refetches triggered by an unknown signing key id (key rotation).</summary>
    public TimeSpan JwksRefreshInterval { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>Periodic JWKS refresh; bounds how long a revoked key stays trusted. IdentityModel minimum: 5 minutes.</summary>
    public TimeSpan JwksAutomaticRefreshInterval { get; init; } = TimeSpan.FromMinutes(10);

    public string Issuer => $"{ProjectUrl.TrimEnd('/')}/auth/v1";

    public string JwksUri => $"{Issuer}/.well-known/jwks.json";
}

/// <summary>
/// Validates Supabase access tokens against the project's JWKS. Validated in Phase 0 (prototypes/auth-spike),
/// including against a live hosted project. The API holds no signing secret.
/// </summary>
public static partial class SupabaseAuthentication
{
    /// <summary>Asymmetric signing keys only; the legacy shared HS256 secret is deliberately not accepted.</summary>
    private static readonly string[] AllowedAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.RsaSha256];

    public static IServiceCollection AddSupabaseAuthentication(this IServiceCollection services)
    {
        services.AddOptions<SupabaseAuthOptions>()
            .BindConfiguration(SupabaseAuthOptions.Section)
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddSingleton<IDocumentRetriever>(new HttpDocumentRetriever { RequireHttps = true });
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureSupabaseJwtBearer>();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        return services;
    }

    private sealed class ConfigureSupabaseJwtBearer(IOptions<SupabaseAuthOptions> supabase, IDocumentRetriever documentRetriever)
        : IConfigureNamedOptions<JwtBearerOptions>
    {
        public void Configure(string? name, JwtBearerOptions options)
        {
            if (name != JwtBearerDefaults.AuthenticationScheme) return;
            var settings = supabase.Value;

            options.MapInboundClaims = false;
            // Key rotation: a token with an unknown kid makes IdentityModel refetch the JWKS and revalidate
            // (first refetch immediate, later ones throttled by RefreshInterval).
            options.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                settings.JwksUri, new JwksConfigurationRetriever(settings.Issuer), documentRetriever)
            {
                RefreshInterval = settings.JwksRefreshInterval,
                AutomaticRefreshInterval = settings.JwksAutomaticRefreshInterval,
            };
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = settings.Issuer,
                ValidAudience = settings.Audience,
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                RequireSignedTokens = true,
                RequireExpirationTime = true,
                ValidAlgorithms = AllowedAlgorithms,
                ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "sub",
                RoleClaimType = "role",
            };
            options.Events = new JwtBearerEvents
            {
                OnTokenValidated = OnTokenValidated,
                OnChallenge = WriteUnauthorizedProblem,
            };
        }

        public void Configure(JwtBearerOptions options) => Configure(JwtBearerDefaults.AuthenticationScheme, options);
    }

    private static Task OnTokenValidated(TokenValidatedContext context)
    {
        var principal = context.Principal!;
        if (principal.FindFirst("role")?.Value != "authenticated")
            context.Fail("Token role is not 'authenticated'.");
        else if (string.Equals(principal.FindFirst("is_anonymous")?.Value, "true", StringComparison.OrdinalIgnoreCase))
            context.Fail("Anonymous Supabase users are not accepted.");
        else if (!Guid.TryParse(principal.FindFirst("sub")?.Value, out _))
            context.Fail("Token subject is not a UUID.");
        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Rejected bearer token: {Reason}")]
    private static partial void LogRejectedToken(ILogger logger, string reason);

    private static async Task WriteUnauthorizedProblem(JwtBearerChallengeContext context)
    {
        context.HandleResponse();
        if (context.AuthenticateFailure is not null)
        {
            var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger(typeof(SupabaseAuthentication));
            LogRejectedToken(logger, context.AuthenticateFailure.Message);
        }

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers.WWWAuthenticate = "Bearer";
        var problems = context.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>();
        await problems.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context.HttpContext,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Type = ProblemTypes.Unauthorized,
                Title = "Authentication required",
                Detail = context.AuthenticateFailure is null
                    ? "A bearer token is required."
                    : "The bearer token is invalid or expired.",
            },
        });
    }
}

/// <summary>Builds signing-key configuration from a bare JWKS document (Supabase publishes JWKS, not full OIDC metadata).</summary>
public sealed class JwksConfigurationRetriever(string issuer) : IConfigurationRetriever<OpenIdConnectConfiguration>
{
    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(string address, IDocumentRetriever retriever, CancellationToken cancel)
    {
        var json = await retriever.GetDocumentAsync(address, cancel);
        var keySet = new JsonWebKeySet(json);
        var configuration = new OpenIdConnectConfiguration { Issuer = issuer, JwksUri = address, JsonWebKeySet = keySet };
        foreach (var key in keySet.GetSigningKeys()) configuration.SigningKeys.Add(key);
        return configuration;
    }
}
