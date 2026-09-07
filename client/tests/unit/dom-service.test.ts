import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDomService,
  DomNotFoundError,
  DomTimeoutError,
  resolveDomTarget,
  type DomTarget,
} from "../../src/services/dom-service.js";

describe("DomService (FT-008)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("resolves semantic ariaLabel before CSS fallback", () => {
    const semantic = document.createElement("button");
    semantic.setAttribute("aria-label", "Analytics");
    semantic.textContent = "wrong-fallback-text";
    const fallback = document.createElement("div");
    fallback.id = "fallback-only";
    document.body.append(fallback, semantic);

    const target: DomTarget = {
      id: "t1",
      ariaLabel: "Analytics",
      selectorFallback: "#fallback-only",
    };
    expect(resolveDomTarget(target, document)).toBe(semantic);
  });

  it("uses stable data-luftballons-target when semantic absent", () => {
    const el = document.createElement("div");
    el.setAttribute("data-luftballons-target", "stable.one");
    el.textContent = "hello";
    document.body.append(el);

    const target: DomTarget = { id: "stable.one", selectorFallback: ".nope" };
    expect(resolveDomTarget(target, document)).toBe(el);
  });

  it("falls back to selectorFallback", () => {
    const el = document.createElement("div");
    el.className = "css-hit";
    document.body.append(el);
    const target: DomTarget = {
      id: "css",
      selectorFallback: ".css-hit",
    };
    expect(resolveDomTarget(target, document)).toBe(el);
  });

  it("click and readText operate on resolved nodes", async () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Go");
    btn.textContent = "Go label";
    let clicked = false;
    btn.addEventListener("click", () => {
      clicked = true;
    });
    document.body.append(btn);

    const dom = createDomService();
    const target: DomTarget = { id: "go", ariaLabel: "Go", role: "button" };
    await dom.click(target);
    expect(clicked).toBe(true);
    expect(await dom.readText(target)).toBe("Go label");
    expect(await dom.exists(target)).toBe(true);
  });

  it("click throws when missing", async () => {
    const dom = createDomService();
    await expect(
      dom.click({ id: "missing", ariaLabel: "Nope" }),
    ).rejects.toBeInstanceOf(DomNotFoundError);
  });

  it("waitFor resolves when node appears", async () => {
    const dom = createDomService({ defaultTimeoutMs: 500 });
    const target: DomTarget = { id: "late", ariaLabel: "Late" };

    const pending = dom.waitFor(target, 500);
    window.setTimeout(() => {
      const el = document.createElement("div");
      el.setAttribute("aria-label", "Late");
      document.body.append(el);
    }, 30);

    const found = await pending;
    expect(found.getAttribute("aria-label")).toBe("Late");
  });

  it("waitFor times out", async () => {
    const dom = createDomService();
    await expect(
      dom.waitFor({ id: "never", ariaLabel: "Never" }, 40),
    ).rejects.toBeInstanceOf(DomTimeoutError);
  });

  it("waitFor aborts without hanging", async () => {
    const dom = createDomService();
    const ac = new AbortController();
    const pending = dom.waitFor(
      { id: "abort-me", ariaLabel: "AbortMe" },
      5_000,
      ac.signal,
    );
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("exists is false for misses", async () => {
    const dom = createDomService();
    expect(await dom.exists({ id: "x", selectorFallback: ".none" })).toBe(
      false,
    );
  });
});
