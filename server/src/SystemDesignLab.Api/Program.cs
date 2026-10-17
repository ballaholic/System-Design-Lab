using SystemDesignLab.Api.Features.Architectures;
using SystemDesignLab.Api.Features.Attempts;
using SystemDesignLab.Api.Features.Challenges;
using SystemDesignLab.Api.Features.Mentor;
using SystemDesignLab.Api.Features.Users;
using SystemDesignLab.Api.Infrastructure.Auth;
using SystemDesignLab.Api.Infrastructure.Persistence;
using SystemDesignLab.Api.Infrastructure.Web;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddMemoryCache();
builder.Services.AddApiProblemDetails();
builder.Services.AddSupabaseAuthentication();
builder.Services.AddAuthorization();
builder.Services.AddApiCors(builder.Configuration);
builder.Services.AddApiRateLimiting(builder.Configuration);
builder.Services.AddPersistence(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.AddUsersFeature();
builder.Services.AddArchitecturesFeature();
builder.Services.AddChallengesFeature(builder.Configuration);
builder.Services.AddMentorFeature(builder.Configuration);

var app = builder.Build();

// Fail at startup, not on the first request, when challenge content is invalid (ADR-008).
app.Services.GetRequiredService<ChallengeCatalog>();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseAuthentication();
app.UseRateLimiter(); // after authentication so limits partition by user
app.UseAuthorization();
app.UseRequestBodyLimits();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }))
    .AllowAnonymous()
    .DisableRateLimiting()
    .WithTags("Health");

var api = app.MapGroup("/api")
    .RequireAuthorization()
    .AddEndpointFilter<EnsureUserProfileFilter>();

api.MapUsersEndpoints();
api.MapArchitecturesEndpoints();
api.MapAttemptsEndpoints();
api.MapMentorEndpoints();

app.MapChallengesEndpoints();

app.Run();

public partial class Program;
