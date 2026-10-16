using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;

namespace SystemDesignLab.Api.Features.Users;

/// <summary>
/// Lazily creates the app profile on a user's first authenticated request (DATA_MODEL §4). The insert is an
/// idempotent upsert, so concurrent first requests cannot create duplicates; a short-lived cache avoids a
/// database round trip on every later request.
/// </summary>
public sealed class UserProfileProvisioner(AppDbContext db, IMemoryCache cache, TimeProvider clock)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

    public async Task EnsureAsync(CurrentUser user, CancellationToken cancellationToken)
    {
        var cacheKey = $"profile-provisioned:{user.Id}";
        if (cache.TryGetValue(cacheKey, out _)) return;

        var now = clock.GetUtcNow();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO app.user_profiles (id, display_name, avatar_url, created_at, updated_at)
            VALUES ({user.Id}, {user.SuggestedDisplayName}, {user.SuggestedAvatarUrl}, {now}, {now})
            ON CONFLICT (id) DO NOTHING
            """,
            cancellationToken);

        cache.Set(cacheKey, true, CacheDuration);
    }

    /// <summary>Forget the cached "exists" flag, e.g. after the profile is deleted.</summary>
    public void Invalidate(Guid userId) => cache.Remove($"profile-provisioned:{userId}");
}

/// <summary>Runs provisioning before every endpoint in the authenticated /api group.</summary>
public sealed class EnsureUserProfileFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated == true)
        {
            var provisioner = http.RequestServices.GetRequiredService<UserProfileProvisioner>();
            await provisioner.EnsureAsync(CurrentUser.FromPrincipal(http.User), http.RequestAborted);
        }
        return await next(context);
    }
}
