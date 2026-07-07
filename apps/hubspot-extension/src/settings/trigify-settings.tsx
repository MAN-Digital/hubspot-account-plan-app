import { TRIGIFY_MONITORING_TYPES } from "@hap/config";
import {
  Alert,
  Button,
  ButtonRow,
  Divider,
  Flex,
  Heading,
  Input,
  Link,
  Select,
  StatusTag,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@hubspot/ui-extensions";
import { useCallback, useEffect, useState } from "react";
import type {
  SubscribePlan,
  SubscribeRequestBody,
  SubscribeResult,
  TrigifyConnectionResponse,
  TrigifyMonitor,
} from "./trigify-types";

const DAY_MS = 24 * 60 * 60 * 1000;

const MONITOR_TYPE_OPTIONS = TRIGIFY_MONITORING_TYPES.map((value) => ({
  label: value,
  value,
}));

const CADENCE_OPTIONS = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
];

export type TrigifySettingsProps = {
  fetchConnection: () => Promise<TrigifyConnectionResponse>;
  plan: (body: Omit<SubscribeRequestBody, "confirm">) => Promise<SubscribePlan>;
  subscribe: (body: SubscribeRequestBody) => Promise<SubscribeResult>;
  pause: (id: string) => Promise<TrigifyMonitor>;
  remove: (id: string) => Promise<TrigifyMonitor>;
};

type SubscribeDraft = {
  monitorType: string;
  targetUrl: string;
  cadence: "daily" | "weekly";
};

const EMPTY_DRAFT: SubscribeDraft = {
  monitorType: "linkedin-profile",
  targetUrl: "",
  cadence: "daily",
};

function statusVariant(
  status: TrigifyMonitor["status"],
): "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "deleted":
      return "danger";
    default:
      return "info";
  }
}

function lookbackDays(ms: number): number {
  return Math.round(ms / DAY_MS);
}

/**
 * Trigify monitor-management settings section (Stage A Task 10).
 *
 * Spend discipline (hard contract):
 *  - "Preview" calls the dry-run {@link TrigifySettingsProps.plan}. It NEVER
 *    spends a credit and never passes `confirm`.
 *  - The credit-spending {@link TrigifySettingsProps.subscribe} runs ONLY after
 *    the user clicks the explicit "This spends 1 Trigify credit" confirm button,
 *    and only when the plan projected a spend (`projectedSpend === 1`). Duplicate
 *    or invalid plans never show the confirm button.
 *  - A fail-closed budget refusal (backend returns `created:false` with a budget
 *    reason) is surfaced as an error Alert with the backend's guidance verbatim.
 *
 * The UI consumes backend outputs verbatim — it never invents monitor status,
 * spend, budget, or lookback semantics.
 */
export function TrigifySettings({
  fetchConnection,
  plan,
  subscribe,
  pause,
  remove,
}: TrigifySettingsProps) {
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<TrigifyConnectionResponse | null>(null);
  const [draft, setDraft] = useState<SubscribeDraft>(EMPTY_DRAFT);
  const [previewing, setPreviewing] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<SubscribePlan | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [result, setResult] = useState<SubscribeResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchConnection();
    setConnection(next);
  }, [fetchConnection]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchConnection()
      .then((next) => {
        if (!cancelled) setConnection(next);
      })
      .catch(() => {
        if (!cancelled) setConnection({ connected: false, usage: null, monitors: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchConnection]);

  const runPreview = useCallback(async () => {
    setActionError(null);
    setResult(null);
    setPendingPlan(null);
    if (draft.targetUrl.trim().length === 0) {
      setActionError("Enter a target URL to preview a monitor.");
      return;
    }
    setPreviewing(true);
    try {
      const nextPlan = await plan({
        monitorType: draft.monitorType,
        targetUrl: draft.targetUrl.trim(),
        cadence: draft.cadence,
      });
      setPendingPlan(nextPlan);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  }, [draft, plan]);

  const confirmSpend = useCallback(async () => {
    if (!pendingPlan || pendingPlan.projectedSpend !== 1) return;
    setSubscribing(true);
    setActionError(null);
    try {
      const res = await subscribe({
        monitorType: pendingPlan.monitorType,
        targetUrl: pendingPlan.targetUrl,
        cadence: pendingPlan.cadence,
        confirm: true,
      });
      setResult(res);
      setPendingPlan(null);
      if (res.created) {
        setDraft(EMPTY_DRAFT);
        await reload();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubscribing(false);
    }
  }, [pendingPlan, subscribe, reload]);

  const onPause = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await pause(id);
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [pause, reload],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await remove(id);
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [remove, reload],
  );

  if (loading || !connection) {
    return <Text>Loading Trigify…</Text>;
  }

  return (
    <Flex direction="column" gap="md">
      <Heading>Trigify monitors</Heading>

      {connection.connected ? (
        <Flex direction="column" gap="xs">
          <Text>Connected.</Text>
          {connection.usage ? (
            <Text variant="microcopy">
              Credits used: {connection.usage.credits_used ?? "—"} · remaining:{" "}
              {connection.usage.credits_remaining ?? "—"} · monitors:{" "}
              {connection.usage.monitor_count ?? connection.monitors.length}
            </Text>
          ) : null}
        </Flex>
      ) : (
        <Text>
          Not connected. Add a Trigify API key above to enable signal monitors, then reload.
        </Text>
      )}

      {/* Monitor list */}
      <Heading>Monitors</Heading>
      {connection.monitors.length === 0 ? (
        <Text variant="microcopy">No monitors yet. Subscribe one below.</Text>
      ) : (
        <Table bordered>
          <TableHead>
            <TableRow>
              <TableHeader>Type</TableHeader>
              <TableHeader>Target</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Actions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {connection.monitors.map((monitor) => (
              <TableRow key={monitor.id}>
                <TableCell>{monitor.monitorType}</TableCell>
                <TableCell>
                  <Link href={monitor.targetUrl}>{monitor.targetUrl}</Link>
                </TableCell>
                <TableCell>
                  <StatusTag variant={statusVariant(monitor.status)}>{monitor.status}</StatusTag>
                </TableCell>
                <TableCell>
                  <ButtonRow>
                    <Button
                      testId={`trigifyPause-${monitor.id}`}
                      variant="secondary"
                      disabled={monitor.status !== "active"}
                      onClick={() => void onPause(monitor.id)}
                    >
                      Pause
                    </Button>
                    <Button
                      testId={`trigifyDelete-${monitor.id}`}
                      variant="destructive"
                      disabled={monitor.status === "deleted"}
                      onClick={() => void onDelete(monitor.id)}
                    >
                      Delete
                    </Button>
                  </ButtonRow>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Divider />

      {/* Subscribe form (two-step) */}
      <Heading>Subscribe a monitor</Heading>
      <Text variant="microcopy">
        Subscribing spends a Trigify credit. Preview first — no credit is spent until you confirm.
      </Text>
      <Select
        name="trigifyMonitorType"
        label="Monitor type"
        value={draft.monitorType}
        options={MONITOR_TYPE_OPTIONS}
        onChange={(value) => setDraft((current) => ({ ...current, monitorType: value as string }))}
      />
      <Input
        name="trigifyTargetUrl"
        label="Target URL (LinkedIn / social profile or page)"
        value={draft.targetUrl}
        onChange={(value) => setDraft((current) => ({ ...current, targetUrl: value }))}
      />
      <Select
        name="trigifyCadence"
        label="Cadence"
        value={draft.cadence}
        options={CADENCE_OPTIONS}
        onChange={(value) =>
          setDraft((current) => ({
            ...current,
            cadence: value as "daily" | "weekly",
          }))
        }
      />
      <Button
        testId="trigifyPreview"
        variant="secondary"
        disabled={previewing || !connection.connected}
        onClick={() => void runPreview()}
      >
        {previewing ? "Previewing…" : "Preview (no credit spent)"}
      </Button>

      {/* Plan preview + explicit spend gate */}
      {pendingPlan ? (
        <Flex direction="column" gap="sm">
          <Divider />
          <Text format={{ fontWeight: "bold" }}>Preview</Text>
          <Text variant="microcopy">
            Lookback window: {lookbackDays(pendingPlan.lookbackWindowMs)} days
            {pendingPlan.activeLookbackPlan
              ? ` (clamped to your ${pendingPlan.activeLookbackPlan} plan)`
              : ""}
            .
          </Text>
          <Text variant="microcopy">Cadence: {pendingPlan.cadence}.</Text>

          {pendingPlan.duplicate ? (
            <Alert title="Duplicate monitor" variant="warning">
              A duplicate monitor already exists (id {pendingPlan.duplicate.id}, status{" "}
              {pendingPlan.duplicate.status}). No credit will be spent.
            </Alert>
          ) : !pendingPlan.validMonitorType ? (
            <Alert title="Invalid monitor type" variant="danger">
              {pendingPlan.notes}
            </Alert>
          ) : pendingPlan.projectedSpend === 1 ? (
            <Flex direction="column" gap="sm">
              <Alert title="This spends 1 Trigify credit" variant="warning">
                Confirming will subscribe {pendingPlan.monitorType} for {pendingPlan.targetUrl} and
                spend 1 Trigify credit.
              </Alert>
              <Button
                testId="trigifyConfirmSpend"
                variant="primary"
                disabled={subscribing}
                onClick={() => void confirmSpend()}
              >
                {subscribing ? "Subscribing…" : "Confirm — spend 1 credit"}
              </Button>
            </Flex>
          ) : (
            <Text variant="microcopy">{pendingPlan.notes}</Text>
          )}
        </Flex>
      ) : null}

      {/* Subscribe result (incl. fail-closed budget refusal) */}
      {result ? (
        result.created ? (
          <Alert title="Monitor created" variant="success">
            {result.reason}
          </Alert>
        ) : result.budget && !result.budget.ok ? (
          <Alert title="Credit budget refused this monitor" variant="error">
            {result.budget.reason} Configure a daily or monthly Trigify credit budget in this
            tenant's provider settings, then try again.
          </Alert>
        ) : (
          <Alert title="Monitor not created" variant="warning">
            {result.reason}
          </Alert>
        )
      ) : null}

      {actionError ? (
        <Alert title="Trigify request failed" variant="error">
          {actionError}
        </Alert>
      ) : null}
    </Flex>
  );
}
