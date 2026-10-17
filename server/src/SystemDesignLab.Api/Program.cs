using SystemDesignLab.Api.Features.Architectures;
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

var app = builder.Build();

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

app.Run();

public partial class Program;
