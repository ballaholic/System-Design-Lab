using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using SystemDesignLab.Api.Common;

namespace SystemDesignLab.Api.Features.Challenges;

/// <summary>The challenge catalog, served anonymously so guests can play (ADR-008).</summary>
public static class ChallengesEndpoints
{
    private const string CacheControl = "public, max-age=300";

    public static IServiceCollection AddChallengesFeature(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<ChallengeCatalogOptions>(configuration.GetSection(ChallengeCatalogOptions.Section));
        services.AddSingleton(provider =>
            ChallengeCatalog.Load(provider.GetRequiredService<IOptions<ChallengeCatalogOptions>>().Value.ResolvedContentPath));
        return services;
    }

    public static IEndpointRouteBuilder MapChallengesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/challenges").AllowAnonymous().WithTags("Challenges");
        group.MapGet("/", List).WithName("ListChallenges");
        group.MapGet("/{slug}", Get).WithName("GetChallenge");
        return app;
    }

    private static IResult List(ChallengeCatalog catalog, HttpResponse response)
    {
        response.Headers.CacheControl = CacheControl;
        var items = new JsonArray(catalog.Items.Select(e => (JsonNode)e.Summary.DeepClone()).ToArray());
        return Results.Content(new JsonObject { ["items"] = items }.ToJsonString(), "application/json");
    }

    private static IResult Get(string slug, ChallengeCatalog catalog, HttpResponse response)
    {
        var entry = catalog.Find(slug);
        if (entry is null)
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Challenge not found.", type: ProblemTypes.NotFound);
        }
        response.Headers.CacheControl = CacheControl;
        return Results.Content(entry.DetailJson, "application/json");
    }
}
