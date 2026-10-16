import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { RequireAuth } from "@/features/auth/RequireAuth";

function renderAt(path: string, auth: Partial<AuthContextValue>) {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <p>Login page</p> },
      {
        path: "/profile",
        element: (
          <RequireAuth>
            <p>Private profile</p>
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const value: AuthContextValue = {
    status: "anonymous",
    session: null,
    lastEvent: null,
    signOut: async () => {},
    ...auth,
  };
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

describe("RequireAuth", () => {
  it("redirects anonymous users to login and remembers where they were going", () => {
    const router = renderAt("/profile?tab=security", { status: "anonymous" });

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/profile?tab=security")}`);
  });

  it("renders the page for signed-in users", () => {
    renderAt("/profile", { status: "authenticated" });
    expect(screen.getByText("Private profile")).toBeInTheDocument();
  });

  it("waits while the session is being restored", () => {
    renderAt("/profile", { status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent(/Checking your session/);
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});
