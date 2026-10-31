// pgrep does not exist on Windows, so isDaemonAlive was always false there and the
// watchdog did a full restart instead of recovering only the funnel.
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ commands: [], run: () => "" }));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  const platform = () => "win32";
  return { ...actual, platform, default: { ...actual, platform } };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const execSync = (command) => {
    h.commands.push(command);
    return h.run();
  };
  const mocked = { ...actual, execSync };
  return { ...mocked, default: mocked };
});

const { isDaemonAlive } = await import("../../src/lib/tunnel/tailscale/tailscale.js");

describe("isDaemonAlive on Windows", () => {
  it("is true when the Tailscale service is running", () => {
    h.run = () => "SERVICE_NAME: Tailscale\n        STATE              : 4  RUNNING\n";
    expect(isDaemonAlive()).toBe(true);
    expect(h.commands.at(-1)).toBe("sc query Tailscale");
  });

  it("is false when the service is stopped", () => {
    h.run = () => "SERVICE_NAME: Tailscale\n        STATE              : 1  STOPPED\n";
    expect(isDaemonAlive()).toBe(false);
  });

  it("is false when the service is not installed", () => {
    h.run = () => { throw new Error("FAILED 1060"); };
    expect(isDaemonAlive()).toBe(false);
  });
});
