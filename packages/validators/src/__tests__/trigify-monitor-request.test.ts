/**
 * Tests for the Trigify monitor subscribe/plan request body schemas
 * (Stage A Task 9). Validates `POST /api/settings/trigify/monitors` and
 * `POST /api/settings/trigify/monitors/plan` request bodies.
 */

import { describe, expect, it } from "vitest";
import {
  trigifyMonitorPlanBodySchema,
  trigifyMonitorSubscribeBodySchema,
} from "../trigify-monitor-request";

describe("trigifyMonitorSubscribeBodySchema", () => {
  it("accepts a minimal valid body", () => {
    const result = trigifyMonitorSubscribeBodySchema.safeParse({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
    });
    expect(result.success).toBe(true);
  });

  it("accepts confirm:true and optional cadence/lookbackWindowMs", () => {
    const result = trigifyMonitorSubscribeBodySchema.safeParse({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
      cadence: "weekly",
      lookbackWindowMs: 1_000_000,
      confirm: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing targetUrl", () => {
    expect(
      trigifyMonitorSubscribeBodySchema.safeParse({
        monitorType: "linkedin-profile",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-URL targetUrl", () => {
    expect(
      trigifyMonitorSubscribeBodySchema.safeParse({
        monitorType: "linkedin-profile",
        targetUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid cadence", () => {
    expect(
      trigifyMonitorSubscribeBodySchema.safeParse({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        cadence: "hourly",
      }).success,
    ).toBe(false);
  });

  it("accepts an optional topicKeywords override (Task 17: config-driven signals)", () => {
    const result = trigifyMonitorSubscribeBodySchema.safeParse({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
      topicKeywords: ["FinOps", "cost optimization"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topicKeywords).toEqual(["FinOps", "cost optimization"]);
    }
  });

  it("accepts an empty topicKeywords array (explicitly omit the topic signal)", () => {
    const result = trigifyMonitorSubscribeBodySchema.safeParse({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
      topicKeywords: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-string entry in topicKeywords", () => {
    expect(
      trigifyMonitorSubscribeBodySchema.safeParse({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        topicKeywords: [123],
      }).success,
    ).toBe(false);
  });
});

describe("trigifyMonitorPlanBodySchema", () => {
  it("does not accept a confirm field (preview is never confirmable)", () => {
    const result = trigifyMonitorPlanBodySchema.safeParse({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
      confirm: true,
    });
    // .omit({confirm:true}) plus .strict() would reject; if not strict, the
    // key is simply dropped. Either behavior is acceptable — the important
    // invariant is that a plan/preview parse never carries a confirm flag
    // forward to the caller.
    expect(result.success).toBe(true);
    if (result.success) {
      expect("confirm" in result.data).toBe(false);
    }
  });
});
