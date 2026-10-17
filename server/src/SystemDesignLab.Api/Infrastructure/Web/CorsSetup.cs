namespace SystemDesignLab.Api.Infrastructure.Web;

public static class CorsSetup
{
    /// <summary>Only the configured web app origins may call the API from a browser.</summary>
    public static IServiceCollection AddApiCors(this IServiceCollection services, IConfiguration configuration)
    {
        var origins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

        return services.AddCors(options => options.AddDefaultPolicy(policy => policy
            .WithOrigins(origins)
            .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
            .WithHeaders("Authorization", "Content-Type", "If-Match")
            .WithExposedHeaders("ETag", "Location", "Retry-After")
            .SetPreflightMaxAge(TimeSpan.FromHours(1))));
    }
}
