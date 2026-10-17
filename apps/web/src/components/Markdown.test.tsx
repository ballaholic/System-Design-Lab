import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders paragraphs, lists and inline emphasis as elements", () => {
    const { container } = render(
      <Markdown>{"First **bold** and *soft* with `code`.\n\n- one\n- two\n\nLast <b>raw</b>"}</Markdown>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("soft").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["one", "two"]);
    // Markup in content is shown as text, never parsed.
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent("Last <b>raw</b>");
  });
});
