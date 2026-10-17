import type { ArchitectureDocument } from "@sdl/architecture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { renderEditor } from "@/features/playground/test/renderEditor";
import { ApiError } from "@/lib/api/client";
import * as mentor from "@/lib/api/mentor";
import solution from "../../../../../content/challenges/url-shortener/solutions/s2-viral.json";
import { type MentorLink, MentorPanel } from "./MentorPanel";

const signedIn: AuthContextValue = {
  status: "authenticated",
  session: { user: { id: "u1" } } as AuthContextValue["session"],
  lastEvent: null,
  signOut: async () => {},
};
const LINK: MentorLink = { architectureId: "d1", attemptId: null, interview: false };
const QUOTA: mentor.Quota = {
  available: true,
  emailVerified: true,
  remainingPercent: 80,
  resetsAt: "2026-10-19T00:00:00Z",
};

function conversation(overrides: Partial<mentor.Conversation> = {}): mentor.Conversation {
  return {
    id: "c1",
    mode: "tutor",
    title: "Why?",
    architectureId: "d1",
    attemptId: null,
    metadata: {},
    createdAt: "2026-10-18T10:00:00Z",
    updatedAt: "2026-10-18T10:00:00Z",
    ...overrides,
  };
}

function setup({
  auth = signedIn,
  quota = QUOTA,
  link = LINK,
  conversations = [] as mentor.Conversation[],
}: {
  auth?: AuthContextValue;
  quota?: mentor.Quota;
  link?: MentorLink;
  conversations?: mentor.Conversation[];
} = {}) {
  vi.spyOn(mentor.mentorApi, "quota").mockResolvedValue(quota);
  vi.spyOn(mentor.mentorApi, "list").mockResolvedValue({ items: conversations });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderEditor(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/playground/d1"]}>
          <MentorPanel link={link} />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
    { ...(solution as ArchitectureDocument), traffic: { totalRps: 11_000 } },
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("MentorPanel", () => {
  it("asks guests to sign in, keeping them on this page afterwards", () => {
    setup({ auth: { ...signedIn, status: "anonymous", session: null } });
    expect(screen.getByText("The AI mentor needs an account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent("/playground/d1")}`,
    );
  });

  it("asks unverified users to verify, and explains when the mentor is switched off", async () => {
    setup({ quota: { ...QUOTA, emailVerified: false } });
    expect(await screen.findByText("Verify your email to use the AI mentor")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("explains when the mentor is switched off", async () => {
    setup({ quota: { ...QUOTA, available: false } });
    expect(await screen.findByText("The AI mentor is turned off right now")).toBeInTheDocument();
  });

  it("streams a Tutor answer, sending the current design and a fresh simulation", async () => {
    const created = { conversation: conversation(), messages: [] };
    vi.spyOn(mentor.mentorApi, "create").mockResolvedValue(created);
    const get = vi.spyOn(mentor.mentorApi, "get").mockResolvedValue(created);
    let finish: () => void = () => {};
    const send = vi
      .spyOn(mentor, "sendMessage")
      .mockImplementation(async (_id, _content, _context, handlers) => {
        handlers.onDelta("The API server is ");
        await new Promise<void>((resolve) => (finish = resolve));
        handlers.onDelta("at 69% utilization.");
        handlers.onDone({ id: "m2", role: "assistant", content: "", status: "complete", createdAt: "" }, 79);
      });
    setup();

    expect(await screen.findByText(/Why is my database saturated/)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Mentor allowance left today" })).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    await userEvent.click(screen.getByText("Context included with each message"));
    expect(screen.getByText(/Your current design: 5 components, 4 connections/)).toBeInTheDocument();
    expect(screen.getByText(/Simulation \(engine 1\.0\.0\): 11,000 requests\/s/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message the mentor"), "Is the API OK?{Enter}");

    expect(await screen.findByText("The API server is")).toBeInTheDocument();
    expect(screen.getByText("Is the API OK?")).toBeInTheDocument();
    expect(screen.getByLabelText("Message the mentor")).toBeDisabled();
    const [id, content, context] = send.mock.calls[0]!;
    expect(id).toBe("c1");
    expect(content).toBe("Is the API OK?");
    expect(context.architecture.nodes).toHaveLength(5);
    expect(context.simulation).toMatchObject({ engineVersion: "1.0.0", traffic: { totalRps: 11_000 } });
    expect(mentor.mentorApi.create).toHaveBeenCalledWith({
      mode: "tutor",
      architectureId: "d1",
      attemptId: null,
    });

    get.mockResolvedValue({
      conversation: conversation(),
      messages: [
        { id: "m1", role: "user", content: "Is the API OK?", status: "complete", createdAt: "" },
        {
          id: "m2",
          role: "assistant",
          content: "The API server is at 69% utilization.",
          status: "complete",
          createdAt: "",
        },
      ],
    });
    await act(async () => finish());
    expect(await screen.findByText("The API server is at 69% utilization.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message the mentor")).toBeEnabled());
    expect(screen.getByText("AI mentor · can be wrong")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Mentor allowance left today" })).toHaveAttribute(
      "aria-valuenow",
      "79",
    );
  });

  it("shows review findings that point out and select their components", async () => {
    const review = conversation({ id: "r1", mode: "reviewer", title: "Design review" });
    vi.spyOn(mentor.mentorApi, "get").mockResolvedValue({
      conversation: review,
      messages: [
        {
          id: "m2",
          role: "assistant",
          content: "Handles the load.",
          review: {
            summary: "Handles the load.",
            findings: [
              {
                id: "f1",
                category: "availability",
                severity: "high",
                confidence: "medium",
                nodeIds: ["db"],
                title: "Single database",
                explanation: "If **SQL database** fails, creates fail.",
                suggestion: "Add a replica.",
              },
            ],
          },
          status: "complete",
          createdAt: "",
        },
      ],
    });
    const { s } = setup({ conversations: [review] });
    await userEvent.click(await screen.findByRole("radio", { name: "Reviewer" }));

    const card = await screen.findByRole("article", { name: "Single database" });
    expect(within(card).getByText("High severity")).toBeInTheDocument();
    expect(within(card).getByText("Confidence: medium")).toBeInTheDocument();
    const chip = within(card).getByRole("button", { name: "SQL database" });
    await userEvent.hover(chip);
    expect(s().highlight).toEqual(["db"]);
    await userEvent.unhover(chip);
    expect(s().highlight).toEqual([]);
    await userEvent.click(within(card).getByRole("button", { name: /Show on canvas/ }));
    expect(s().selection.nodeIds).toEqual(["db"]);
    expect(screen.getByRole("button", { name: /Review my design/ })).toBeEnabled();
  });

  it("explains a rate limit in plain words and keeps the message", async () => {
    vi.spyOn(mentor.mentorApi, "get").mockResolvedValue({ conversation: conversation(), messages: [] });
    vi.spyOn(mentor, "sendMessage").mockRejectedValue(
      new ApiError(429, {
        status: 429,
        type: "https://systemdesignlab.dev/problems/rate-limited",
        title: "Too many requests",
      }),
    );
    setup({ conversations: [conversation()] });

    await userEvent.type(await screen.findByLabelText("Message the mentor"), "Hello{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("You're sending messages quickly");
    expect(screen.getByLabelText("Message the mentor")).toHaveValue("Hello");
  });

  it("disables input when today's allowance is used up, saying when it resets", async () => {
    setup({ quota: { ...QUOTA, remainingPercent: 0 } });
    expect(await screen.findByText(/You've used today's mentor allowance. It resets at/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message the mentor")).toBeDisabled();
  });

  it("starts an interview for free and moves through its steps", async () => {
    const interview = conversation({
      id: "i1",
      mode: "interviewer",
      attemptId: "a1",
      metadata: { step: "requirements" },
    });
    const opening = {
      id: "m1",
      role: "assistant" as const,
      content: "Welcome! Let's start with requirements.",
      status: "complete" as const,
      createdAt: "",
    };
    vi.spyOn(mentor.mentorApi, "create").mockResolvedValue({ conversation: interview, messages: [opening] });
    const get = vi
      .spyOn(mentor.mentorApi, "get")
      .mockResolvedValue({ conversation: interview, messages: [opening] });
    const update = vi
      .spyOn(mentor.mentorApi, "update")
      .mockResolvedValue({ ...interview, metadata: { step: "estimation" } });
    setup({ link: { architectureId: "d1", attemptId: "a1", interview: true } });

    expect(await screen.findByRole("radio", { name: "Interviewer" })).toBeChecked();
    await userEvent.click(await screen.findByRole("button", { name: "Start the interview" }));
    expect(mentor.mentorApi.create).toHaveBeenCalledWith({
      mode: "interviewer",
      architectureId: "d1",
      attemptId: "a1",
    });
    expect(await screen.findByText("Welcome! Let's start with requirements.")).toBeInTheDocument();
    expect(screen.getByText("Requirements", { selector: "span" })).toBeInTheDocument();

    get.mockResolvedValue({
      conversation: { ...interview, metadata: { step: "estimation" } },
      messages: [opening],
    });
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(update).toHaveBeenCalledWith("i1", { step: "estimation" });
    expect(await screen.findByText("Estimation", { selector: "span" })).toBeInTheDocument();
  });
});
