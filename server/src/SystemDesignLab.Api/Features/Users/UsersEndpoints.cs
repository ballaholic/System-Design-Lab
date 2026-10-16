using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Common;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;

namespace SystemDesignLab.Api.Features.Users;

public sealed record MeResponse(
    Guid Id,
    string? Email,
    string DisplayName,
    string? AvatarUrl,
    bool? EmailVerified,
    DateTimeOffset CreatedAt);

public sealed record UpdateProfileRequest(string? DisplayName);

public static class UsersEndpoints
{
    public static IServiceCollection AddUsersFeature(this IServiceCollection services) =>
        services.AddScoped<UserProfileProvisioner>();

    public static RouteGroupBuilder MapUsersEndpoints(this RouteGroupBuilder api)
    {
        var me = api.MapGroup("/me").WithTags("Users");
        me.MapGet("/", GetMe).WithName("GetMe");
        me.MapPatch("/", UpdateMe).WithName("UpdateMe");
        return api;
    }

    private static async Task<Ok<MeResponse>> GetMe(CurrentUser user, AppDbContext db, CancellationToken ct)
    {
        // The group filter guarantees the profile exists.
        var profile = await db.UserProfiles.AsNoTracking().SingleAsync(p => p.Id == user.Id, ct);
        return TypedResults.Ok(ToResponse(profile, user));
    }

    private static async Task<Results<Ok<MeResponse>, ValidationProblem>> UpdateMe(
        UpdateProfileRequest request, CurrentUser user, AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var displayName = request.DisplayName?.Trim() ?? "";
        var error = ValidateDisplayName(displayName);
        if (error is not null)
        {
            return TypedResults.ValidationProblem(
                new Dictionary<string, string[]> { ["displayName"] = [error] },
                title: "The profile update is invalid.",
                type: ProblemTypes.Validation);
        }

        var profile = await db.UserProfiles.SingleAsync(p => p.Id == user.Id, ct);
        profile.DisplayName = displayName;
        profile.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToResponse(profile, user));
    }

    internal static string? ValidateDisplayName(string displayName)
    {
        if (displayName.Length == 0) return "Display name is required.";
        if (displayName.Length > CurrentUser.MaxDisplayNameLength)
            return $"Display name must be at most {CurrentUser.MaxDisplayNameLength} characters.";
        if (displayName.Any(char.IsControl)) return "Display name cannot contain control characters.";
        return null;
    }

    private static MeResponse ToResponse(UserProfile profile, CurrentUser user) =>
        new(profile.Id, user.Email, profile.DisplayName, profile.AvatarUrl, user.EmailVerified, profile.CreatedAt);
}
