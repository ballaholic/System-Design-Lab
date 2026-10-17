import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { architecturesApi } from "@/lib/api/architectures";
import { type Attempt, attemptsApi } from "@/lib/api/attempts";
import { DashboardPage } from "./DashboardPage";

vi.mock("@/lib/api/me", () => ({
  useMe: () => ({ isPending: false, data: { displayName: "Ada" }, error: null }),
}));

const auth: AuthContextValue = {
  status: "authenticated",
  session: { user: { id: "u1" } } as AuthContextValue["session"],
  lastEvent: null,
  signOut: async () => {},
};

function renderDashboard() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function attempt(overrides: Partial<Attempt>): Attempt {
  return {
    id: "a1",
    challengeSlug: "url-shortener",
    challengeVersion: 1,
    mode: "guided",
    status: "in_progress",
    currentStageId: "s2-viral",
    architectureId: "d1",
    stageResults: {
      "s1-baseline": { passedAt: "2026-10-17T10:00:00Z", criteria: [], engineVersion: "1.0.0" },
    },
    exerciseAnswers: {},
    hintsRevealed: [],
    startedAt: "2026-10-17T09:00:00Z",
    lastActivityAt: "2026-10-17T10:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("DashboardPage", () => {
  it("shows a new user only an empty state with one call to action, and no numbers", async () => {
    vi.spyOn(attemptsApi, "list").mockResolvedValue({ items: [] });
    vi.spyOn(architecturesApi, "list").mockResolvedValue({ items: [], nextCursor: null });
    renderDashboard();
    const cta = await screen.findByRole("link", { name: /Start the URL Shortener challenge/ });
    expect(cta).toHaveAttribute("href", "/challenges/url-shortener");
    expect(screen.getAllByRole("link")).toEqual([cta]);
    expect(screen.queryByText(/stages$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue:/)).not.toBeInTheDocument();
  });

  it("continues the latest attempt, shows progress from saved data, and recent designs", async () => {
    vi.spyOn(attemptsApi, "list").mockResolvedValue({ items: [attempt({})] });
    vi.spyOn(architecturesApi, "list").mockResolvedValue({
      items: [
        {
          id: "d1",
          title: "URL Shortener",
          description: null,
          challengeSlug: "url-shortener",
          nodeCount: 5,
          version: 3,
          createdAt: "2026-10-17T09:00:00Z",
          updatedAt: "2026-10-17T10:00:00Z",
        },
      ],
      nextCursor: null,
    });
    renderDashboard();
    expect(
      await screen.findByRole("heading", { name: "Continue: URL Shortener — Stage 2" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute(
      "href",
      "/challenges/url-shortener/attempt/a1",
    );
    expect(screen.getByRole("progressbar", { name: "Stages passed" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1/3 stages")).toBeInTheDocument();
    expect(screen.getByText("In progress · stage 2 of 3")).toBeInTheDocument();
    expect(screen.getByText(/started every challenge available/)).toBeInTheDocument();
    expect(screen.getByText("5 components")).toBeInTheDocument();
  });

  it("recommends the next challenge when none is under way", async () => {
    vi.spyOn(attemptsApi, "list").mockResolvedValue({ items: [] });
    vi.spyOn(architecturesApi, "list").mockResolvedValue({
      items: [
        {
          id: "d1",
          title: "Sketch",
          description: null,
          challengeSlug: null,
          nodeCount: 1,
          version: 1,
          createdAt: "2026-10-17T09:00:00Z",
          updatedAt: "2026-10-17T10:00:00Z",
        },
      ],
      nextCursor: null,
    });
    renderDashboard();
    expect(await screen.findByText("Recommended next:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "URL Shortener" })).toHaveAttribute(
      "href",
      "/challenges/url-shortener",
    );
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });
});
