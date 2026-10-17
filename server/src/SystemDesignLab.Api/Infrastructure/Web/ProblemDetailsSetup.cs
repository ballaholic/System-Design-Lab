using System.Diagnostics;
using SystemDesignLab.Api.Common;

namespace SystemDesignLab.Api.Infrastructure.Web;

public static class ProblemDetailsSetup
{
    /// <summary>Every error response is RFC 9457 problem details with a stable type and a trace id.</summary>
    public static IServiceCollection AddApiProblemDetails(this IServiceCollection services) =>
        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
        {
            var problem = context.ProblemDetails;
            // A type set by the endpoint (e.g. mentor-quota-exceeded) wins over the generic one for its status.
            var generic = problem.Type is null || problem.Type.StartsWith("https://tools.ietf.org/", StringComparison.Ordinal);
            problem.Type = !generic ? problem.Type : problem.Status switch
            {
                StatusCodes.Status400BadRequest => ProblemTypes.Validation,
                StatusCodes.Status401Unauthorized => ProblemTypes.Unauthorized,
                StatusCodes.Status403Forbidden => ProblemTypes.Forbidden,
                StatusCodes.Status404NotFound => ProblemTypes.NotFound,
                StatusCodes.Status429TooManyRequests => ProblemTypes.RateLimited,
                >= 500 => ProblemTypes.Unexpected,
                _ => problem.Type,
            };
            problem.Extensions["traceId"] = Activity.Current?.Id ?? context.HttpContext.TraceIdentifier;
        });
}
