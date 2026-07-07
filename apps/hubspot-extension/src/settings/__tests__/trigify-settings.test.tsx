import { Alert, Button, Input, Select } from "@hubspot/ui-extensions";
import {
  createRenderer,
  type RenderedNode,
  RenderedNodeType,
} from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { TrigifySettings } from "../trigify-settings";
import type {
  SubscribePlan,
  SubscribeResult,
  TrigifyConnectionResponse,
  TrigifyMonitor,
} from "../trigify-types";

function triggerValue(node: unknown, value: unknown) {
  (node as { trigger: (e: "onChange", v?: unknown) => void }).trigger("onChange", value);
}

/**
 * Collect ALL visible text: every Text node reachable in the tree PLUS the
 * `title` prop of every Alert (Alert titles are string props, not child Text
 * nodes, so a plain text-node walk misses them). This is what a user actually
 * reads on screen.
 */
function allText(renderer: ReturnType<typeof createRenderer>): string {
  const parts: string[] = [];
  const walk = (node: RenderedNode) => {
    if (node.nodeType === RenderedNodeType.Text) {
      parts.push(node.text);
      return;
    }
    const kids = (node as { childNodes?: RenderedNode[] }).childNodes;
    if (kids) for (const k of kids) walk(k);
  };
  walk(renderer.getRootNode());
  for (const alert of renderer.findAll(Alert)) {
    const title = alert.props.title;
    if (typeof title === "string") parts.push(title);
  }
  return parts.join(" ");
}

const MONITOR: TrigifyMonitor = {
  id: "m-1",
  tenantId: "t-1",
  monitorType: "linkedin-profile",
  targetUrl: "https://www.linkedin.com/in/jordan",
  status: "active",
  creditsSpent: 1,
  config: { cadence: "daily", lookbackWindowMs: 2592000000 },
  subscribedAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const CONNECTED: TrigifyConnectionResponse = {
  connected: true,
  usage: { credits_used: 3, credits_remaining: 7, monitor_count: 1 },
  monitors: [MONITOR],
};

function planFor(overrides: Partial<SubscribePlan> = {}): SubscribePlan {
  return {
    monitorType: "linkedin-profile",
    targetUrl: "https://www.linkedin.com/in/new",
    validMonitorType: true,
    cadence: "daily",
    lookbackWindowMs: 2592000000,
    activeLookbackPlan: "pro",
    duplicate: null,
    payload: {},
    projectedSpend: 1,
    notes: "ready to create",
    ...overrides,
  };
}

function deps(
  over: {
    fetchConnection?: () => Promise<TrigifyConnectionResponse>;
    plan?: (b: unknown) => Promise<SubscribePlan>;
    subscribe?: (b: unknown) => Promise<SubscribeResult>;
    pause?: (id: string) => Promise<TrigifyMonitor>;
    remove?: (id: string) => Promise<TrigifyMonitor>;
  } = {},
) {
  return {
    fetchConnection: over.fetchConnection ?? vi.fn(async () => CONNECTED),
    plan: over.plan ?? vi.fn(async () => planFor()),
    subscribe:
      over.subscribe ??
      vi.fn(async () => ({
        created: true,
        spend: 1 as const,
        reason: "created",
        monitor: MONITOR,
        plan: planFor(),
      })),
    pause: over.pause ?? vi.fn(async () => ({ ...MONITOR, status: "paused" as const })),
    remove: over.remove ?? vi.fn(async () => ({ ...MONITOR, status: "deleted" as const })),
  };
}

async function renderSettings(d: ReturnType<typeof deps>) {
  const renderer = createRenderer("settings");
  renderer.render(<TrigifySettings {...d} />);
  await renderer.waitFor(() => {
    expect(allText(renderer)).not.toContain("Loading Trigify");
  });
  return renderer;
}

describe("TrigifySettings — connection + monitor list", () => {
  it("shows connected usage and the existing monitor", async () => {
    const renderer = await renderSettings(deps());
    const text = allText(renderer);
    expect(text).toContain("7"); // credits remaining
    expect(text).toContain("https://www.linkedin.com/in/jordan");
  });

  it("renders the disconnected state when connected:false", async () => {
    const renderer = await renderSettings(
      deps({
        fetchConnection: vi.fn(async () => ({
          connected: false,
          usage: null,
          monitors: [],
        })),
      }),
    );
    const text = allText(renderer);
    expect(text.toLowerCase()).toContain("not connected");
  });
});

describe("TrigifySettings — two-step spend-gated subscribe", () => {
  it("Preview calls plan (dry-run) and NEVER subscribe", async () => {
    const d = deps();
    const renderer = await renderSettings(d);

    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/new",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");

    await renderer.waitFor(() => {
      expect(d.plan).toHaveBeenCalledTimes(1);
    });
    expect(d.subscribe).not.toHaveBeenCalled();
    // plan body carries no confirm
    const planBody = (
      (d.plan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
        Record<string, unknown>,
      ]
    )[0];
    expect(planBody.confirm).toBeUndefined();
  });

  it("shows the explicit 'This spends 1 Trigify credit' confirmation after a plan with projectedSpend 1", async () => {
    const renderer = await renderSettings(deps());
    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/new",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");

    await renderer.waitFor(() => {
      expect(allText(renderer)).toMatch(/spends 1 Trigify credit/i);
    });
  });

  it("only sends confirm:true AFTER the user clicks the explicit confirm button", async () => {
    const d = deps();
    const renderer = await renderSettings(d);
    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/new",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");
    await renderer.waitFor(() => {
      expect(allText(renderer)).toMatch(/spends 1 Trigify credit/i);
    });

    // Before clicking confirm: no subscribe call at all.
    expect(d.subscribe).not.toHaveBeenCalled();

    renderer.findByTestId(Button, "trigifyConfirmSpend").trigger("onClick");
    await renderer.waitFor(() => {
      expect(d.subscribe).toHaveBeenCalledTimes(1);
    });
    const body = (
      (d.subscribe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
        Record<string, unknown>,
      ]
    )[0];
    expect(body.confirm).toBe(true);
  });

  it("surfaces a duplicate-monitor plan without offering the spend confirm", async () => {
    const d = deps({
      plan: vi.fn(async () =>
        planFor({
          duplicate: { id: "m-1", status: "active" },
          projectedSpend: 0,
        }),
      ),
    });
    const renderer = await renderSettings(d);
    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/jordan",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");

    await renderer.waitFor(() => {
      expect(allText(renderer).toLowerCase()).toContain("duplicate");
    });
    // No spend confirm button when projectedSpend is 0.
    expect(() => renderer.findByTestId(Button, "trigifyConfirmSpend")).toThrow();
  });

  it("displays the clamped lookback window + active plan from the plan", async () => {
    const renderer = await renderSettings(deps());
    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/new",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");
    await renderer.waitFor(() => {
      const t = allText(renderer);
      expect(t).toContain("30"); // 2592000000ms = 30 days
      expect(t.toLowerCase()).toContain("pro"); // activeLookbackPlan
    });
  });
});

describe("TrigifySettings — fail-closed budget refusal", () => {
  it("surfaces a budget refusal clearly when create is refused", async () => {
    const d = deps({
      subscribe: vi.fn(async () => ({
        created: false,
        spend: 0 as const,
        reason: "no credit budget configured for this tenant",
        monitor: null,
        plan: planFor(),
        budget: {
          ok: false,
          reason: "no credit budget configured for this tenant",
          spentDaily: 0,
          spentMonthly: 0,
        },
      })),
    });
    const renderer = await renderSettings(d);
    triggerValue(renderer.find(Select, { name: "trigifyMonitorType" }), "linkedin-profile");
    triggerValue(
      renderer.find(Input, { name: "trigifyTargetUrl" }),
      "https://www.linkedin.com/in/new",
    );
    renderer.findByTestId(Button, "trigifyPreview").trigger("onClick");
    await renderer.waitFor(() => {
      expect(allText(renderer)).toMatch(/spends 1 Trigify credit/i);
    });
    renderer.findByTestId(Button, "trigifyConfirmSpend").trigger("onClick");

    await renderer.waitFor(() => {
      expect(d.subscribe).toHaveBeenCalledTimes(1);
    });
    await renderer.waitFor(() => {
      const t = allText(renderer);
      expect(t.toLowerCase()).toContain("budget");
    });
    // A refusal renders an error/warning Alert.
    expect(renderer.findAll(Alert).length).toBeGreaterThanOrEqual(1);
  });
});

describe("TrigifySettings — monitor lifecycle", () => {
  it("pauses a monitor via the row action", async () => {
    const d = deps();
    const renderer = await renderSettings(d);
    renderer.findByTestId(Button, "trigifyPause-m-1").trigger("onClick");
    await renderer.waitFor(() => {
      expect(d.pause).toHaveBeenCalledWith("m-1");
    });
  });

  it("deletes a monitor via the row action", async () => {
    const d = deps();
    const renderer = await renderSettings(d);
    renderer.findByTestId(Button, "trigifyDelete-m-1").trigger("onClick");
    await renderer.waitFor(() => {
      expect(d.remove).toHaveBeenCalledWith("m-1");
    });
  });
});
