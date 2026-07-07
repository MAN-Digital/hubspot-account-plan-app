import type { ExtensionPointApiContext } from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { createSettingsFetcher, createSettingsUpdater } from "./api-fetcher";
import { HubSpotSettingsPage } from "./settings-page";
import {
  createTrigifyConnectionFetcher,
  createTrigifyMonitorLifecycle,
  createTrigifyPlanFetcher,
  createTrigifySubscriber,
} from "./trigify-api-fetcher";

type HubSpotSettingsEntryProps = {
  context: ExtensionPointApiContext<"settings">;
};

export default function HubSpotSettingsEntry({ context }: HubSpotSettingsEntryProps) {
  const apiBaseUrl = (context as { variables?: Record<string, unknown> }).variables?.API_ORIGIN;
  const resolvedBaseUrl = typeof apiBaseUrl === "string" ? apiBaseUrl : undefined;

  const trigifyLifecycle = createTrigifyMonitorLifecycle(resolvedBaseUrl);

  return (
    <HubSpotSettingsPage
      fetchSettings={createSettingsFetcher(resolvedBaseUrl)}
      updateSettings={createSettingsUpdater(resolvedBaseUrl)}
      trigify={{
        fetchConnection: createTrigifyConnectionFetcher(resolvedBaseUrl),
        plan: createTrigifyPlanFetcher(resolvedBaseUrl),
        subscribe: createTrigifySubscriber(resolvedBaseUrl),
        pause: trigifyLifecycle.pause,
        remove: trigifyLifecycle.remove,
      }}
    />
  );
}

hubspot.extend<"settings">(({ context }) => <HubSpotSettingsEntry context={context} />);
