// Hosts in MITM_BYPASS_HOSTS (Antigravity among them) skip native fetch, so the bypass
// path must honor the abort signal itself: both the connect timer and client aborts use it.
import { PassThrough } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ sockets: [], requests: [] }));

vi.mock("dns", () => {
  class Resolver {
    setServers() {}
    resolve4(_host, cb) { cb(null, ["192.0.2.1"]); }
  }
  return { default: { Resolver }, Resolver };
});

vi.mock("net", async () => {
  const { EventEmitter } = await import("node:events");
  class Socket extends EventEmitter {
    connect(_port, _ip, cb) { h.sockets.push(this); cb(); }
    destroy(err) { this.destroyedWith = err; this.emit("close"); }
  }
  return { default: { Socket }, Socket };
});

vi.mock("https", async () => {
  const { EventEmitter } = await import("node:events");
  const request = (_options, onResponse) => {
    const req = new EventEmitter();
    req.onResponse = onResponse;
    req.write = () => {};
    req.end = () => {};
    req.destroy = (err) => { req.destroyedWith = err; req.socket?.destroy(err); };
    h.requests.push(req);
    return req;
  };
  return { default: { request }, request };
});

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const URL_ = "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent";

const pending = async (signal) => {
  const promise = proxyAwareFetch(URL_, { method: "POST", body: "{}", signal });
  await vi.waitFor(() => expect(h.requests.length).toBe(1));
  return promise;
};

beforeEach(() => {
  h.sockets.length = 0;
  h.requests.length = 0;
});

describe("proxyAwareFetch — MITM bypass path honors signal", () => {
  it("client abort while waiting for headers rejects with AbortError and destroys the request", async () => {
    const ctrl = new AbortController();
    const promise = pending(ctrl.signal);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));

    ctrl.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(h.requests[0].destroyedWith?.name).toBe("AbortError");
  });

  it("keeps the abort reason, so BaseExecutor can tell its timer from a client abort", async () => {
    const ctrl = new AbortController();
    const promise = pending(ctrl.signal);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));

    ctrl.abort(new Error("fetch connect timeout"));

    await expect(promise).rejects.toThrow("fetch connect timeout");
  });

  it("does not open a connection when already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(proxyAwareFetch(URL_, { method: "POST", body: "{}", signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(h.sockets.length).toBe(0);
  });

  it("abort after headers still tears down the request reading the body", async () => {
    const ctrl = new AbortController();
    const promise = pending(ctrl.signal);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));

    const res = Object.assign(new PassThrough(), { statusCode: 200, statusMessage: "OK", headers: {} });
    h.requests[0].onResponse(res);
    const response = await promise;
    expect(response.status).toBe(200);

    ctrl.abort();

    expect(h.requests[0].destroyedWith?.name).toBe("AbortError");
  });

  it("works without a signal", async () => {
    const promise = proxyAwareFetch(URL_, { method: "POST", body: "{}" });
    await vi.waitFor(() => expect(h.requests.length).toBe(1));

    const res = Object.assign(new PassThrough(), { statusCode: 200, statusMessage: "OK", headers: {} });
    h.requests[0].onResponse(res);

    expect((await promise).status).toBe(200);
  });
});
