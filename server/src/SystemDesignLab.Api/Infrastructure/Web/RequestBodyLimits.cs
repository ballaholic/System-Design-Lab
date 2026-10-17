using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Metadata;

namespace SystemDesignLab.Api.Infrastructure.Web;

/// <summary>
/// Per-endpoint request body limits. Kestrel's global limit stays small; endpoints that accept documents raise
/// it through metadata. Bodies over the limit fail with 413 while being read.
/// </summary>
public static class RequestBodyLimits
{
    /// <summary>Default for endpoints without their own limit.</summary>
    public const long Default = 64 * 1024;

    public static TBuilder WithRequestBodyLimit<TBuilder>(this TBuilder builder, long maxBytes)
        where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new BodyLimit(maxBytes));

    public static IApplicationBuilder UseRequestBodyLimits(this IApplicationBuilder app) =>
        app.Use((context, next) =>
        {
            var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (feature is { IsReadOnly: false })
            {
                var limit = context.GetEndpoint()?.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize;
                feature.MaxRequestBodySize = limit ?? Default;
            }
            return next(context);
        });

    private sealed record BodyLimit(long? MaxRequestBodySize) : IRequestSizeLimitMetadata;
}
