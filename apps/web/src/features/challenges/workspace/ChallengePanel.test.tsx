import type { ArchitectureDocument } from "@sdl/architecture";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { renderEditor } from "@/features/playground/test/renderEditor";
import type { Attempt, AttemptPatch } from "@/lib/api/attempts";
import solution from "../../../../../../content/challenges/url-shortener/solutions/s1-baseline.json";
import { starterDocument } from "../attempts/attempts";
import { createGuestAttempt } from "../attempts/guestAttempts";
import { CHALLENGES } from "../content";
import { ChallengePanel } from "./ChallengePanel";

const challenge = CHALLENGES[0]!;

/** Applies patches like useAttemptState, without storage. */
function Harness({
  initial,
  onPatch,
  saveCheckpoint,
}: {
  initial: Attempt;
  onPatch(patch: AttemptPatch): void;
  saveCheckpoint(label: string): Promise<boolean>;
}) {
  const [attempt, setAttempt] = useState(initial);
  return (
    <MemoryRouter>
      <ChallengePanel
        challenge={challenge}
        attempt={attempt}
        update={(change) =>
          setAttempt((a) => {
            const patch = change(a);
            onPatch(patch);
            return { ...a, ...patch };
          })
        }
        saveCheckpoint={saveCheckpoint}
      />
    </MemoryRouter>
  );
}

function setup(doc: ArchitectureDocument, attempt: Attempt = createGuestAttempt(challenge, "local-d")) {
  const onPatch = vi.fn<(patch: AttemptPatch) => void>();
  const saveCheckpoint = vi.fn(async () => true);
  const editor = renderEditor(
    <Harness initial={attempt} onPatch={onPatch} saveCheckpoint={saveCheckpoint} />,
    doc,
  );
  return { ...editor, onPatch, saveCheckpoint };
}

const allAnswered: Attempt["exerciseAnswers"] = {
  "est-redirect-rate": {
    kind: "estimate",
    value: 116,
    correct: true,
    attempts: 1,
    revealed: false,
    answeredAt: "x",
  },
  "est-storage": {
    kind: "estimate",
    value: 900,
    correct: true,
    attempts: 1,
    revealed: false,
    answeredAt: "x",
  },
  "id-generation": { kind: "decision", optionId: "random", answeredAt: "x" },
};

beforeEach(() => localStorage.clear());

describe("ChallengePanel", () => {
  it("checks the stage live and switches the sandbox to the stage's traffic", () => {
    const { s } = setup({ ...starterDocument(challenge), traffic: { totalRps: 5 } });
    expect(s().doc.traffic).toEqual({ totalRps: 128 });
    const checklist = screen.getByRole("region", { name: "Checklist" });
    expect(checklist).toHaveTextContent("0 of 7 done");
    expect(checklist).toHaveTextContent("No connected path from a client to a SQL database");
    expect(screen.getByRole("list", { name: "Stages" })).toHaveTextContent(
      "1: A working baseline (current stage)",
    );
  });

  it("records the pass with its evidence, saves a checkpoint and offers the next stage", async () => {
    const attempt = { ...createGuestAttempt(challenge, "local-d"), exerciseAnswers: allAnswered };
    const { onPatch, saveCheckpoint, s } = setup(solution as ArchitectureDocument, attempt);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Stage 1 passed");
    expect(dialog).toHaveTextContent("A checkpoint of this design was saved.");
    expect(saveCheckpoint).toHaveBeenCalledWith("Stage 1 passed: A working baseline");
    const recorded = onPatch.mock.calls[0]![0].stageResults!["s1-baseline"]!;
    expect(recorded.passedAt).toBeTruthy();
    expect(recorded.criteria.every((c) => c.passed)).toBe(true);

    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to stage 2" }));
    expect(onPatch).toHaveBeenLastCalledWith({ currentStageId: "s2-viral" });
    expect(s().doc.traffic).toEqual({ totalRps: 11_000 });
    expect(screen.getByRole("region", { name: "Stage 2: Going viral" })).toBeInTheDocument();
  });

  it("finishes the attempt on the last stage, with the stage's failure applied to the sandbox", async () => {
    const stage2 =
      await import("../../../../../../content/challenges/url-shortener/solutions/s3-outage.json");
    const attempt: Attempt = {
      ...createGuestAttempt(challenge, "local-d"),
      currentStageId: "s3-outage",
      exerciseAnswers: {
        ...allAnswered,
        "write-availability": { kind: "decision", optionId: "fail-fast", answeredAt: "x" },
      },
    };
    const { onPatch, s } = setup(stage2.default as ArchitectureDocument, attempt);
    expect(s().scenario.failures).toEqual([{ kind: "database-primary-down", nodeId: "db" }]);
    expect(await screen.findByRole("dialog")).toHaveTextContent("URL Shortener complete");
    expect(onPatch.mock.calls[0]![0]).toMatchObject({ status: "completed" });
  });

  it("answers exercises and reveals hints one at a time", async () => {
    const { onPatch } = setup(starterDocument(challenge));
    await userEvent.type(screen.getByLabelText("Your estimate (redirects/s)"), "116");
    await userEvent.click(screen.getAllByRole("button", { name: "Check" })[0]!);
    expect(onPatch).toHaveBeenLastCalledWith({
      exerciseAnswers: {
        "est-redirect-rate": expect.objectContaining({ value: 116, correct: true, attempts: 1 }),
      },
    });
    expect(screen.getByText(/Close enough/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show hint 1 of 3" }));
    expect(onPatch).toHaveBeenLastCalledWith({ hintsRevealed: ["s1-path"] });
    expect(screen.getByRole("button", { name: "Show hint 2 of 3" })).toBeInTheDocument();
    await act(async () => {});
  });

  it("explains a wrong estimate and reveals the worked solution on request", async () => {
    const { onPatch } = setup(starterDocument(challenge));
    await userEvent.type(screen.getByLabelText("Your estimate (GB)"), "5000");
    await userEvent.click(screen.getAllByRole("button", { name: "Check" })[1]!);
    expect(screen.getByText(/Not quite \(1 attempt\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show the worked solution" }));
    expect(onPatch).toHaveBeenLastCalledWith({
      exerciseAnswers: { "est-storage": expect.objectContaining({ correct: false, revealed: true }) },
    });
    expect(screen.getByText(/a little under a terabyte/)).toBeInTheDocument();
  });

  it("shows decision feedback and marks the recommended option", async () => {
    setup(starterDocument(challenge));
    await userEvent.click(screen.getByLabelText(/^Pick 7 random characters/));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText(/Simple and hard to guess/)).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });
});
