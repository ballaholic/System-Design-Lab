import type { FlowStep } from "@sdl/architecture";
import { appendStep, moveStepAt, removeStepAt, updateStepAt } from "./stepPaths";

const call = (edge: string): FlowStep => ({ type: "call", edge });
const flow: FlowStep[] = [
  { type: "cache-lookup", edge: "cache", onMiss: [call("db"), call("db2")] },
  call("other"),
];

describe("step path helpers", () => {
  it("updates top-level and nested steps without mutating", () => {
    const copy = structuredClone(flow);
    const next = updateStepAt(flow, [0, 1], (s) => ({ ...s, optional: true }) as FlowStep);
    expect(next[0]).toEqual({
      type: "cache-lookup",
      edge: "cache",
      onMiss: [call("db"), { ...call("db2"), optional: true }],
    });
    expect(updateStepAt(flow, [1], () => call("x"))[1]).toEqual(call("x"));
    expect(flow).toEqual(copy);
  });

  it("removes, moves and appends", () => {
    expect(removeStepAt(flow, [0, 0])[0]).toMatchObject({ onMiss: [call("db2")] });
    expect(moveStepAt(flow, [1], -1).map((s) => s.edge)).toEqual(["other", "cache"]);
    expect(moveStepAt(flow, [0, 0], 1)[0]).toMatchObject({ onMiss: [call("db2"), call("db")] });
    expect(moveStepAt(flow, [0], -1)).toEqual(flow);
    expect(moveStepAt(flow, [1], 1)).toEqual(flow);
    expect(appendStep(flow, [], call("z"))).toHaveLength(3);
    expect(appendStep(flow, [0], call("z"))[0]).toMatchObject({
      onMiss: [call("db"), call("db2"), call("z")],
    });
  });

  it("ignores paths through non-lookup steps", () => {
    expect(appendStep(flow, [1], call("z"))).toEqual(flow);
  });
});
