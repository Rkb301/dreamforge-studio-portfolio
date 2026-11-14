import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLocalAI, validateEndpoint } from "../../js/local-ai.js";
import { validateAIDraft } from "../../js/ai-draft.js";

afterEach(() => vi.unstubAllGlobals());
const settings = { endpoint: "http://127.0.0.1:11435", model: "local-test" };
const seed = () => ({
  entries: [
    {
      key: "e1",
      kind: "characters",
      name: "Lena",
      description: "An archivist with a dangerous secret.",
    },
    {
      key: "e2",
      kind: "locations",
      name: "The archive",
      description: "Its empty shelves remember their books.",
    },
  ],
  relationships: [
    {
      source: "e1",
      target: "e2",
      type: "Located In",
      description: "Lena guards the archive.",
    },
  ],
});

describe("private inference boundary", () => {
  it.each([
    "https://example.com",
    "http://192.168.1.5:11434",
    "http://127.0.0.1.evil.example",
    "https://localhost",
    "http://user:pass@localhost",
    "http://localhost/proxy",
    "http://localhost?remote=1",
    "http://localhost/#remote",
  ])("rejects %s", (endpoint) => {
    expect(() => validateEndpoint(endpoint)).toThrow();
  });
  it("accepts loopback only", () => {
    expect(validateEndpoint("http://[::1]:11434")).toBe("http://[::1]:11434");
    expect(validateEndpoint(settings.endpoint)).toBe(settings.endpoint);
  });
  it("rejects cloud aliases before making any request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestLocalAI({ ...settings, model: "foo:cloud" }, []),
    ).rejects.toThrow("locally installed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("inspects metadata before sending any manuscript", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ remote_host: "https://example.com" }),
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestLocalAI(settings, [
        { role: "user", content: "private manuscript" },
      ]),
    ).rejects.toThrow("remote server");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].body).not.toContain("private manuscript");
  });
  it("never follows redirects or retries a failed request at another provider", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new TypeError("redirect refused"));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestLocalAI(settings, [])).rejects.toThrow(
      "redirect refused",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url.startsWith(settings.endpoint)).toBe(true);
      expect(options.redirect).toBe("error");
    }
  });
  it("passes fictional subject matter without a keyword filter or moderation service", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "A tragic scene." } }),
      });
    vi.stubGlobal("fetch", fetcher);
    const messages = [
      {
        role: "user",
        content:
          "Write a villain's betrayal in a morally dark political tragedy.",
      },
    ];
    await requestLocalAI(settings, messages);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).messages).toEqual(
      messages,
    );
  });
});
describe("untrusted local AI drafts", () => {
  it("creates fresh IDs, copies only permitted fields, and links only inside the draft", () => {
    const raw = seed();
    raw.entries[0].id = "existing-canon-id";
    raw.entries[0].canon = "canon";
    const d = validateAIDraft(raw, "A scene", "local-test");
    expect(d.characters[0].id).not.toBe("existing-canon-id");
    expect(d.characters[0].canon).toBe("draft");
    expect(d.relationships[0].sourceId).toBe(d.characters[0].id);
    expect(d.relationships[0].targetId).toBe(d.locations[0].id);
  });
  it.each(["duplicate", "dangling", "oversize", "unknown", "self", "missing"])(
    "rejects %s output",
    (mode) => {
      const raw = seed();
      if (mode === "duplicate") raw.entries[1].key = "e1";
      if (mode === "dangling")
        raw.relationships[0].target = "existing-canon-id";
      if (mode === "oversize") raw.entries[0].description = "x".repeat(1601);
      if (mode === "unknown") raw.entries[0].kind = "__proto__";
      if (mode === "self") raw.relationships[0].target = "e1";
      if (mode === "missing") delete raw.entries[0].name;
      expect(() => validateAIDraft(raw, "A scene", "local-test")).toThrow();
    },
  );
});
