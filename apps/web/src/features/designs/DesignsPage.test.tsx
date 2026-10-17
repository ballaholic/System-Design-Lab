import { createEmptyDocument } from "@sdl/architecture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { architecturesApi } from "@/lib/api/architectures";
import { listGuestDesigns, newGuestId, saveGuestDesign } from "../playground/persistence/guestDesigns";
import { DesignsPage } from "./DesignsPage";

function renderPage(auth: Partial<AuthContextValue>) {
  const value: AuthContextValue = {
    status: "anonymous",
    session: null,
    lastEvent: null,
    signOut: async () => {},
    ...auth,
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={value}>
        <MemoryRouter>
          <DesignsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("DesignsPage", () => {
  it("shows guest designs from this browser and deletes after confirmation", async () => {
    const id = newGuestId();
    saveGuestDesign(id, "Chat system", createEmptyDocument());
    renderPage({ status: "anonymous" });
    expect(screen.getByText(/saved in this browser only/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat system" })).toHaveAttribute("href", `/playground/${id}`);

    await userEvent.click(screen.getByRole("button", { name: "Actions for Chat system" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(listGuestDesigns()).toEqual([]);
    expect(await screen.findByText("No designs yet")).toBeInTheDocument();
  });

  it("lists account designs for signed-in users", async () => {
    vi.spyOn(architecturesApi, "list").mockResolvedValue({
      items: [
        {
          id: "a1",
          title: "URL shortener",
          description: null,
          challengeSlug: null,
          nodeCount: 5,
          version: 2,
          createdAt: "2026-10-16T10:00:00Z",
          updatedAt: "2026-10-17T10:00:00Z",
        },
      ],
      nextCursor: null,
    });
    renderPage({ status: "authenticated", session: { user: { id: "u1" } } as AuthContextValue["session"] });
    expect(await screen.findByRole("link", { name: "URL shortener" })).toHaveAttribute(
      "href",
      "/playground/a1",
    );
    expect(screen.getByText(/5 components/)).toBeInTheDocument();
  });

  it("renames an account design", async () => {
    vi.spyOn(architecturesApi, "list").mockResolvedValue({
      items: [
        {
          id: "a1",
          title: "Old",
          description: null,
          challengeSlug: null,
          nodeCount: 0,
          version: 1,
          createdAt: "2026-10-17T10:00:00Z",
          updatedAt: "2026-10-17T10:00:00Z",
        },
      ],
      nextCursor: null,
    });
    const rename = vi.spyOn(architecturesApi, "rename").mockResolvedValue({} as never);
    renderPage({ status: "authenticated", session: { user: { id: "u1" } } as AuthContextValue["session"] });
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Old" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Title");
    await userEvent.clear(input);
    await userEvent.type(input, "New title{Enter}");
    expect(rename).toHaveBeenCalledWith("a1", { title: "New title" });
  });
});
