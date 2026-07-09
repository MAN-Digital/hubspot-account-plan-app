import { describe, expect, it, vi } from "vitest";
import { buildFeatureFlagRequest, parseArgs, runEnableAppCards } from "../enable-hubspot-app-cards";

describe("enable-hubspot-app-cards", () => {
  describe("parseArgs", () => {
    it("defaults the portal flag state to ON", () => {
      expect(parseArgs(["--app", "37116835", "--portal", "147062576"])).toEqual({
        appId: "37116835",
        portalId: "147062576",
        flagState: "ON",
        dryRun: false,
      });
    });

    it("parses --state OFF and --dry-run", () => {
      expect(
        parseArgs(["--app", "37116835", "--portal", "147062576", "--state", "OFF", "--dry-run"]),
      ).toEqual({
        appId: "37116835",
        portalId: "147062576",
        flagState: "OFF",
        dryRun: true,
      });
    });

    it("ignores pnpm's standalone -- argument separator", () => {
      expect(parseArgs(["--", "--app", "37116835", "--portal", "147062576"])).toEqual({
        appId: "37116835",
        portalId: "147062576",
        flagState: "ON",
        dryRun: false,
      });
    });
  });

  it("builds the 2026-03 OAuth request when a bearer token is present", () => {
    const request = buildFeatureFlagRequest({
      appId: "37116835",
      portalId: "147062576",
      flagState: "ON",
      env: { HUBSPOT_APP_MANAGEMENT_TOKEN: "oauth-token" },
    });

    expect(request.url).toBe(
      "https://api.hubapi.com/feature-flags/2026-03/37116835/flags/hs-release-app-cards/portals/147062576",
    );
    expect(request.init.method).toBe("PUT");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer oauth-token",
      "Content-Type": "application/json",
    });
    expect(request.init.body).toBe(JSON.stringify({ flagState: "ON" }));
  });

  it("builds the legacy v3 developer API key request when no bearer token is present", () => {
    const request = buildFeatureFlagRequest({
      appId: "37116835",
      portalId: "147062576",
      flagState: "ON",
      env: { HUBSPOT_DEVELOPER_API_KEY: "dev-key" },
    });

    expect(request.url).toBe(
      "https://api.hubapi.com/feature-flags/v3/37116835/flags/hs-release-app-cards/portals/147062576?hapikey=dev-key",
    );
    expect(request.init.method).toBe("PUT");
    expect(request.init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(request.init.headers).not.toHaveProperty("Authorization");
  });

  it("fails fast when no supported feature-flag credential is present", async () => {
    await expect(
      runEnableAppCards(["--app", "37116835", "--portal", "147062576"], {
        env: {},
        fetcher: vi.fn(),
        log: vi.fn(),
      }),
    ).rejects.toThrow(/HUBSPOT_APP_MANAGEMENT_TOKEN|HUBSPOT_DEVELOPER_API_KEY/);
  });

  it("dry-run reports the intended request without calling fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const log = vi.fn();

    const result = await runEnableAppCards(
      ["--app", "37116835", "--portal", "147062576", "--dry-run"],
      {
        env: { HUBSPOT_APP_MANAGEMENT_TOKEN: "oauth-token" },
        fetcher,
        log,
      },
    );

    expect(result.dryRun).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dry-run"));
  });

  it("sets the portal app-card flag through fetch", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await runEnableAppCards(["--app", "37116835", "--portal", "147062576"], {
      env: { HUBSPOT_APP_MANAGEMENT_TOKEN: "oauth-token" },
      fetcher,
      log: vi.fn(),
    });

    expect(result.dryRun).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.hubapi.com/feature-flags/2026-03/37116835/flags/hs-release-app-cards/portals/147062576",
    );
  });
});
