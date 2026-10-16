using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace SystemDesignLab.Api.Infrastructure.Web;

public sealed class RateLimitingOptions
{
    public const string Section = "RateLimiting";

    /// <summary>Requests per minute per signed-in user (or per IP address for anonymous requests).</summary>
    public int PermitsPerMinute { get; init; } = 300;
}

public static class RateLimitingSetup
{
    /// <summary>
    /// A generous global limiter against runaway clients. Stricter per-feature policies (e.g. the AI mentor)
    /// are added with their features. In-process: limits are per API instance (ADR-001).
    /// </summary>
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var settings = configuration.GetSection(RateLimitingOptions.Section).Get<RateLimitingOptions>() ?? new();

        return services.AddRateLimiter(options =>
        {
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                var userId = context.User.FindFirst("sub")?.Value;
                var key = userId is not null ? $"user:{userId}" : $"ip:{context.Connection.RemoteIpAddress}";
                return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = settings.PermitsPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                });
            });

            options.OnRejected = async (context, cancellationToken) =>
            {
                var response = context.HttpContext.Response;
                response.StatusCode = StatusCodes.Status429TooManyRequests;
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                }

                var problems = context.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>();
                await problems.WriteAsync(new ProblemDetailsContext
                {
                    HttpContext = context.HttpContext,
                    ProblemDetails = new ProblemDetails
                    {
                        Status = StatusCodes.Status429TooManyRequests,
                        Title = "Too many requests",
                        Detail = "The request rate limit was exceeded. Retry after the time given in the Retry-After header.",
                    },
                });
            };
        });
    }
}
