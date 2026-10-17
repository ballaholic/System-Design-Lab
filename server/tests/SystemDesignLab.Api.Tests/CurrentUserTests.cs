using System.Security.Claims;
using SystemDesignLab.Api.Infrastructure.Auth;

namespace SystemDesignLab.Api.Tests;

public sealed class CurrentUserTests
{
    private static readonly Guid UserId = Guid.Parse("8f14e45f-ceea-467f-a8f0-6b8b2a3f9c11");

    private static CurrentUser Parse(string? userMetadataJson, string? email = "ada@example.com")
    {
        var claims = new List<Claim> { new("sub", UserId.ToString()) };
        if (email is not null) claims.Add(new Claim("email", email));
        if (userMetadataJson is not null) claims.Add(new Claim("user_metadata", userMetadataJson, "JSON"));
        return CurrentUser.FromPrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, "test")));
    }

    [Theory]
    [InlineData("""{"display_name":"Ada L."}""", "Ada L.")] // our sign-up form
    [InlineData("""{"full_name":"Ada Lovelace","name":"ada"}""", "Ada Lovelace")] // Google
    [InlineData("""{"name":"  Grace  "}""", "Grace")]
    [InlineData("""{"display_name":"   "}""", "ada")] // blank → email local part
    [InlineData(null, "ada")]
    public void Suggests_a_display_name(string? metadata, string expected) =>
        Assert.Equal(expected, Parse(metadata).SuggestedDisplayName);

    [Fact]
    public void Display_name_falls_back_to_learner_without_email() =>
        Assert.Equal("Learner", Parse(null, email: null).SuggestedDisplayName);

    [Fact]
    public void Display_name_is_truncated_to_the_column_length() =>
        Assert.Equal(60, Parse($$"""{"full_name":"{{new string('x', 100)}}"}""").SuggestedDisplayName.Length);

    [Theory]
    [InlineData("""{"avatar_url":"https://lh3.googleusercontent.com/a/abc"}""", "https://lh3.googleusercontent.com/a/abc")]
    [InlineData("""{"picture":"https://example.com/p.png"}""", "https://example.com/p.png")]
    [InlineData("""{"avatar_url":"http://insecure.example/p.png"}""", null)]
    [InlineData("""{"avatar_url":"javascript:alert(1)"}""", null)]
    public void Accepts_only_https_avatar_urls(string metadata, string? expected) =>
        Assert.Equal(expected, Parse(metadata).SuggestedAvatarUrl);

    [Theory]
    [InlineData("""{"email_verified":true}""", true)]
    [InlineData("""{"email_verified":false}""", false)]
    [InlineData("""{}""", null)]
    [InlineData("not json", null)]
    public void Reads_email_verified_from_user_metadata(string metadata, bool? expected) =>
        Assert.Equal(expected, Parse(metadata).EmailVerified);

    [Fact]
    public void Identity_comes_from_sub() => Assert.Equal(UserId, Parse(null).Id);
}
