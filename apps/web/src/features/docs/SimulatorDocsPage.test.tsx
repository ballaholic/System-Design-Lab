import { ASSUMPTIONS, ENGINE_VERSION, ROLE_SEMANTICS } from "@sdl/simulation";
import { render, screen } from "@testing-library/react";
import { SimulatorDocsPage } from "./SimulatorDocsPage";

describe("SimulatorDocsPage", () => {
  it("is generated from the engine's registries", () => {
    render(<SimulatorDocsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "How the simulator works" })).toBeInTheDocument();
    expect(screen.getByText(`Simulation engine v${ENGINE_VERSION}`)).toBeInTheDocument();
    for (const role of ROLE_SEMANTICS)
      expect(screen.getByRole("heading", { name: role.title })).toBeInTheDocument();
    for (const a of ASSUMPTIONS) expect(screen.getByText(a.id)).toBeInTheDocument();
    expect(screen.getByText("Primary down")).toBeInTheDocument();
  });
});
