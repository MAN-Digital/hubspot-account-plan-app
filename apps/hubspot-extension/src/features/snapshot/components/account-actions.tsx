import type { Snapshot } from "@hap/config";
import {
  Button,
  Flex,
  Heading,
  Input,
  LoadingButton,
  NumberInput,
  Select,
  Text,
  Tile,
} from "@hubspot/ui-extensions";
import { useMemo, useState } from "react";
import {
  type AccountActionApi,
  createAccountActionApi,
  type PeopleProspectingPreviewResponse,
  type WoodpeckerCampaignSuggestion,
} from "../hooks/action-api-fetcher";

const SOURCE_OPTIONS = [
  { label: "Apollo + Harvest", value: "apollo_harvest" },
  { label: "Apollo only", value: "apollo_only" },
  { label: "Harvest only", value: "harvest_only" },
  { label: "HubSpot first", value: "hubspot_first" },
];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function candidateName(candidate: PeopleProspectingPreviewResponse["candidates"][number]): string {
  const full = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim();
  return full || candidate.linkedinUrl || candidate.id;
}

export type PeopleProspectingActionProps = {
  companyId: string;
  api?: AccountActionApi;
};

export function PeopleProspectingAction({ companyId, api }: PeopleProspectingActionProps) {
  const defaultApi = useMemo(() => createAccountActionApi(), []);
  const actions = api ?? defaultApi;
  const [sourceMode, setSourceMode] = useState<
    "apollo_harvest" | "apollo_only" | "harvest_only" | "hubspot_first"
  >("apollo_harvest");
  const [maxContacts, setMaxContacts] = useState(5);
  const [titles, setTitles] = useState("VP Revenue, Head of Sales, RevOps");
  const [preview, setPreview] = useState<PeopleProspectingPreviewResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runPreview = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await actions.previewPeople(companyId, {
        sourceMode,
        maxContacts,
        filters: { titles: splitList(titles) },
      });
      setPreview(result);
      setStatus(result.candidates.length === 0 ? "No candidates returned." : null);
    } catch {
      setStatus("Prospecting preview failed.");
    } finally {
      setLoading(false);
    }
  };

  const acceptAll = async () => {
    if (!preview || preview.candidates.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await actions.acceptPeople(companyId, {
        runId: preview.runId,
        candidateIds: preview.candidates.map((candidate) => candidate.id),
      });
      setStatus(`${result.acceptedCount} people accepted. ${result.debitedCredits} credits used.`);
    } catch {
      setStatus("Accepting people failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tile>
      <Flex direction="column" gap="sm">
        <Heading>People prospecting</Heading>
        <Flex direction="row" gap="sm" align="end">
          <Select
            name="peopleProspectingSource"
            label="Source"
            value={sourceMode}
            options={SOURCE_OPTIONS}
            onChange={(value) => setSourceMode(value as typeof sourceMode)}
          />
          <NumberInput
            name="peopleProspectingMaxContacts"
            label="Max contacts"
            value={maxContacts}
            onChange={(value) => setMaxContacts(Math.max(1, Math.min(50, value)))}
          />
        </Flex>
        <Input name="peopleProspectingTitles" label="Titles" value={titles} onChange={setTitles} />
        <LoadingButton loading={loading} onClick={() => void runPreview()}>
          Prospect people
        </LoadingButton>
        {preview ? (
          <Flex direction="column" gap="xs">
            <Text>
              {preview.candidates.length} candidates. Up to {preview.projectedCredits.max} credits
              if accepted.
            </Text>
            {preview.candidates.slice(0, 5).map((candidate) => (
              <Text key={candidate.id}>
                {candidateName(candidate)}
                {candidate.title ? `, ${candidate.title}` : ""}
              </Text>
            ))}
            <Button
              variant="primary"
              disabled={preview.candidates.length === 0 || loading}
              onClick={() => void acceptAll()}
            >
              Accept shown people
            </Button>
          </Flex>
        ) : null}
        {status ? <Text>{status}</Text> : null}
      </Flex>
    </Tile>
  );
}

export type WoodpeckerCampaignActionProps = {
  snapshot: Snapshot;
  api?: AccountActionApi;
};

export function WoodpeckerCampaignAction({ snapshot, api }: WoodpeckerCampaignActionProps) {
  const defaultApi = useMemo(() => createAccountActionApi(), []);
  const actions = api ?? defaultApi;
  const [campaigns, setCampaigns] = useState<WoodpeckerCampaignSuggestion[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const firstPerson = snapshot.people[0];

  const loadCampaigns = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await actions.suggestWoodpeckerCampaigns(snapshot.companyId, {
        angleKey: snapshot.reasonToContact,
        signalHeadline: snapshot.reasonToContact,
        channelVariant: "email",
      });
      const options = result.campaigns.length > 0 ? result.campaigns : result.allCampaigns;
      setCampaigns(options);
      setSelectedCampaignId(result.recommendedCampaignId ?? options[0]?.id ?? "");
      if (options.length === 0) setStatus("No existing Woodpecker campaigns found.");
    } catch {
      setStatus("Campaign lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  const addFirstPerson = async () => {
    if (!firstPerson || selectedCampaignId.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      await actions.addWoodpeckerCampaignMember(snapshot.companyId, {
        campaignId: selectedCampaignId,
        personKey: firstPerson.id,
        snippets: {
          reasonToTalk: firstPerson.reasonToTalk,
          reasonToContact: snapshot.reasonToContact,
        },
      });
      setStatus("Person queued for the selected campaign.");
    } catch {
      setStatus("Adding to campaign failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!firstPerson) return null;

  return (
    <Tile>
      <Flex direction="column" gap="sm">
        <Heading>Woodpecker campaign</Heading>
        <LoadingButton loading={loading} onClick={() => void loadCampaigns()}>
          Find campaigns
        </LoadingButton>
        {campaigns.length > 0 ? (
          <>
            <Select
              name="woodpeckerCampaign"
              label="Campaign"
              value={selectedCampaignId || undefined}
              options={campaigns.map((campaign) => ({
                label: campaign.name,
                value: campaign.id,
              }))}
              onChange={(value) => setSelectedCampaignId(value as string)}
            />
            <Button
              variant="primary"
              disabled={selectedCampaignId.length === 0 || loading}
              onClick={() => void addFirstPerson()}
            >
              Add first person
            </Button>
          </>
        ) : null}
        {status ? <Text>{status}</Text> : null}
      </Flex>
    </Tile>
  );
}
