import { readEvents } from "./mentor";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readEvents", () => {
  it("parses server-sent events split across chunks, including multi-byte characters", async () => {
    const events: Array<[string, unknown]> = [];
    const body =
      'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo — ✓"}\n\nevent: done\ndata: {"remainingPercent":97}\n\n';
    // Split mid-event and mid-character.
    const bytes = new TextEncoder().encode(body);
    const cut = body.indexOf("—") + 1;
    await readEvents(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 20));
          controller.enqueue(bytes.slice(20, cut + 1));
          controller.enqueue(bytes.slice(cut + 1));
          controller.close();
        },
      }),
      (event, payload) => events.push([event, payload]),
    );
    expect(events).toEqual([
      ["delta", { text: "Hel" }],
      ["delta", { text: "lo — ✓" }],
      ["done", { remainingPercent: 97 }],
    ]);
  });

  it("accepts CRLF line endings and ignores comments", async () => {
    const events: string[] = [];
    await readEvents(streamOf([': keep-alive\r\n\r\nevent: error\r\ndata: {"title":"x"}\r\n\r\n']), (event) =>
      events.push(event),
    );
    expect(events).toEqual(["error"]);
  });
});
