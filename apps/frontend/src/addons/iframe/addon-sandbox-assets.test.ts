import { beforeEach, describe, expect, it, vi } from "vitest";
import { blobLike } from "@/test/blob-matchers";
import {
  loadAddonSandboxRuntimeAssets,
  resetAddonSandboxRuntimeAssetsForTest,
} from "./addon-sandbox-assets";

describe("addon sandbox runtime assets", () => {
  beforeEach(() => {
    resetAddonSandboxRuntimeAssetsForTest();
  });

  it("shares one JavaScript and CSS fetch across concurrent callers", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(url.endsWith(".js") ? "runtime" : "styles"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      loadAddonSandboxRuntimeAssets(),
      loadAddonSandboxRuntimeAssets(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { cache: "no-cache" });
    expect(first.script).toBe(second.script);
    expect(first.stylesheet).toBe(second.stylesheet);
    await expect(first.script.text()).resolves.toBe("runtime");
    await expect(first.stylesheet.text()).resolves.toBe("styles");
  });

  it("clears a failed request so a later activation can retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("unused", { status: 200 }))
      .mockResolvedValueOnce(new Response("runtime", { status: 200 }))
      .mockResolvedValueOnce(new Response("styles", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadAddonSandboxRuntimeAssets()).rejects.toThrow("offline");
    await expect(loadAddonSandboxRuntimeAssets()).resolves.toMatchObject({
      script: blobLike(),
      stylesheet: blobLike(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
