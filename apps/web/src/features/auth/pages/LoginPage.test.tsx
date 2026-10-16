import { AuthApiError } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { LoginPage } from "@/features/auth/pages/LoginPage";

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: (v: unknown) => signInWithPassword(v), resend: vi.fn() } },
}));

function renderLogin(path = "/login") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/", element: <p>Home</p> },
      { path: "/profile", element: <p>Profile</p> },
    ],
    { initialEntries: [path] },
  );
  const auth: AuthContextValue = {
    status: "anonymous",
    session: null,
    lastEvent: null,
    signOut: async () => {},
  };
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

describe("LoginPage", () => {
  beforeEach(() => signInWithPassword.mockReset());

  it("validates fields before calling Supabase", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("returns to the requested page after signing in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const router = renderLogin(`/login?next=${encodeURIComponent("/profile")}`);

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Profile")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/profile");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.com", password: "correct horse" });
  });

  it("offers to resend the confirmation email for unconfirmed accounts", async () => {
    signInWithPassword.mockResolvedValue({
      error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
    });
    renderLogin();

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "whatever1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/confirm your email/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend confirmation email" })).toBeInTheDocument();
  });

  it("ignores external redirect targets", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const router = renderLogin(`/login?next=${encodeURIComponent("https://evil.example")}`);

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });
});
