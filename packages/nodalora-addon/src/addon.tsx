import type {
  Account,
  AccountValuation,
  ExchangeRate,
  Holding,
  Quote,
  SnapshotInfo,
  AddonContext,
  AddonEnableFunction,
} from "@wealthfolio/addon-sdk";
import addonManifest from "../manifest.json";
import { useEffect, useState } from "react";

const DECLARED_API_HOSTS = addonManifest.network.allowedHosts.map((host) => host.toLowerCase());
const DEFAULT_API_URL = `https://${DECLARED_API_HOSTS[0] ?? "api.nodalora.example"}`;
const CREDENTIAL_SECRET = "nodalora.source-credential";
const CONFIG_STORAGE_KEY = "nodalora.config";
const SOURCE_VERSION = "3.8.0";

interface AddonConfig {
  readonly apiUrl: string;
  readonly sourceConnectionId: string;
  readonly accountIds: readonly string[];
}

interface ObservationResult {
  readonly status: number;
  readonly body: string;
}

function asMinor(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(Math.round(value * 100))
    ? Math.round(value * 100)
    : null;
}

function asDecimal(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function latestSnapshot(values: readonly SnapshotInfo[]): SnapshotInfo | null {
  return (
    [...values].sort((left, right) => right.snapshotDate.localeCompare(left.snapshotDate))[0] ??
    null
  );
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildObservation(ctx: AddonContext, config: AddonConfig) {
  const settings = await ctx.api.settings.get();
  const accounts = await ctx.api.accounts.getAll();
  const selectedAccounts = accounts.filter((account) => config.accountIds.includes(account.id));
  if (selectedAccounts.length === 0) throw new Error("Select at least one account");

  const [valuations, exchangeRates, holdingGroups, snapshotGroups] = await Promise.all([
    ctx.api.portfolio.getLatestValuations(config.accountIds as string[]),
    ctx.api.exchangeRates.getAll(),
    Promise.all(
      selectedAccounts.map(async (account) => ({
        accountId: account.id,
        holdings: await ctx.api.portfolio.getHoldings(account.id),
      })),
    ),
    Promise.all(
      selectedAccounts.map(async (account) => ({
        accountId: account.id,
        snapshots: await ctx.api.snapshots.getAll(account.id),
      })),
    ),
  ]);
  const holdings = holdingGroups.flatMap((group) => group.holdings);
  const snapshots = snapshotGroups.flatMap((group) => group.snapshots);
  const quoteEntries = await Promise.all(
    holdings
      .filter((holding) => holding.holdingType !== "cash" && holding.instrument?.id)
      .map(async (holding) => ({
        assetId: holding.instrument!.id,
        quotes: await ctx.api.quotes.getHistory(holding.instrument!.id),
      })),
  );
  const quotes = quoteEntries.flatMap((entry) => entry.quotes);
  const valuationByAccount = new Map(
    valuations.map((valuation) => [valuation.accountId, valuation]),
  );
  const snapshotByAccount = new Map(
    snapshotGroups.map((group) => [group.accountId, latestSnapshot(group.snapshots)]),
  );
  const quoteByAsset = new Map<string, Quote>();
  for (const quote of quotes) {
    const prior = quoteByAsset.get(quote.assetId);
    if (!prior || quote.timestamp > prior.timestamp) quoteByAsset.set(quote.assetId, quote);
  }

  const canonicalHoldings = holdings.map((holding: Holding) => {
    const assetId = holding.instrument?.id ?? holding.id;
    const quote = quoteByAsset.get(assetId);
    const localCurrency = holding.localCurrency;
    const baseCurrency = settings.baseCurrency;
    const matchingRate = exchangeRates.find(
      (rate: ExchangeRate) =>
        rate.fromCurrency === localCurrency && rate.toCurrency === baseCurrency,
    );
    return {
      id: holding.id,
      accountId: holding.accountId,
      assetId,
      symbol: holding.instrument?.symbol ?? holding.id,
      name: holding.instrument?.name ?? holding.id,
      quantity: String(holding.quantity),
      localCurrency,
      baseCurrency,
      marketValueBaseMinor: asMinor(holding.marketValue.base),
      price: asDecimal(holding.price),
      fxRate: asDecimal(holding.fxRate ?? matchingRate?.rate ?? null),
      allocationCategory: null,
      declaredExposures: null,
      runwayEligible: null,
      classificationReviewed: false,
      evidence: {
        snapshotDate: snapshotByAccount.get(holding.accountId)?.snapshotDate ?? null,
        quote:
          holding.holdingType === "cash" || !quote
            ? null
            : { timestamp: quote.timestamp, reliable: quote.dataSource !== "UNKNOWN" },
        fx:
          localCurrency === baseCurrency || !matchingRate
            ? null
            : { timestamp: matchingRate.timestamp, reliable: matchingRate.source !== "UNKNOWN" },
      },
    };
  });

  const sourceMaterial = {
    selectedAccounts,
    valuations,
    canonicalHoldings,
    snapshots,
    quotes,
    exchangeRates,
  };
  return {
    schemaVersion: "1.0",
    sourceObservationId: await sha256(sourceMaterial),
    observedAt: new Date().toISOString(),
    source: { kind: "wealthfolio", version: SOURCE_VERSION, mode: "server-api" },
    scope: {
      requestedAccountIds: config.accountIds,
      observedAccountIds: selectedAccounts.map((account) => account.id),
    },
    accounts: selectedAccounts.map((account: Account) => {
      const valuation = valuationByAccount.get(account.id) as AccountValuation | undefined;
      return {
        id: account.id,
        name: account.name,
        currency: account.currency,
        reportedTotalBaseMinor: asMinor(valuation?.totalValueBase),
        valuationCalculatedAt: valuation?.calculatedAt ?? null,
        valuationReliable: valuation?.valueStatus === "complete",
      };
    }),
    holdings: canonicalHoldings,
    evidence: { latestValuations: valuations, snapshots, quotes, exchangeRates },
  };
}

async function readConfig(ctx: AddonContext): Promise<AddonConfig> {
  const raw = await ctx.api.storage.get(CONFIG_STORAGE_KEY);
  if (!raw) return { apiUrl: DEFAULT_API_URL, sourceConnectionId: "", accountIds: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<AddonConfig>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : DEFAULT_API_URL,
      sourceConnectionId:
        typeof parsed.sourceConnectionId === "string" ? parsed.sourceConnectionId : "",
      accountIds: Array.isArray(parsed.accountIds)
        ? parsed.accountIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { apiUrl: DEFAULT_API_URL, sourceConnectionId: "", accountIds: [] };
  }
}

function validateApiUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== "https:") throw new Error("Nodalora API URL must use HTTPS");
  if (!DECLARED_API_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error("Nodalora API URL must use the host approved during addon installation");
  }
  return parsed.href.replace(/\/$/, "");
}

function NodaloraPage({ ctx }: { readonly ctx: AddonContext }) {
  const [config, setConfig] = useState<AddonConfig>({
    apiUrl: DEFAULT_API_URL,
    sourceConnectionId: "",
    accountIds: [],
  });
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [credential, setCredential] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      readConfig(ctx),
      ctx.api.accounts.getAll(),
      ctx.api.secrets.get(CREDENTIAL_SECRET),
    ]).then(([saved, availableAccounts, savedCredential]) => {
      setConfig(saved);
      setAccounts(availableAccounts);
      setCredential(savedCredential ?? "");
    });
  }, [ctx]);

  const save = async () => {
    const apiUrl = validateApiUrl(config.apiUrl);
    if (!config.sourceConnectionId.trim()) throw new Error("Source Connection ID is required");
    if (!credential.trim()) throw new Error("Source credential is required");
    if (config.accountIds.length === 0) throw new Error("Select at least one account");
    await ctx.api.storage.set(CONFIG_STORAGE_KEY, JSON.stringify({ ...config, apiUrl }));
    await ctx.api.secrets.set(CREDENTIAL_SECRET, credential.trim());
    setConfig({ ...config, apiUrl });
    setMessage("Configuration saved in addon-scoped storage.");
  };

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      await save();
      const observation = await buildObservation(ctx, {
        ...config,
        apiUrl: validateApiUrl(config.apiUrl),
      });
      const response = (await ctx.api.network.request({
        url: `${validateApiUrl(config.apiUrl)}/api/v1/source-connections/${encodeURIComponent(config.sourceConnectionId)}/portfolio-observations`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(observation),
        auth: { type: "bearer", secretKey: CREDENTIAL_SECRET },
      })) as ObservationResult;
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Nodalora rejected the observation (${response.status})`);
      setMessage("Portfolio Observation submitted. Nodalora will evaluate it immutably.");
      ctx.api.toast.success("Portfolio Observation submitted");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Submission failed";
      setMessage(text);
      ctx.api.toast.error(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, padding: 24, margin: "0 auto", display: "grid", gap: 16 }}>
      <h1>Nodalora Portfolio</h1>
      <p>
        Send an explicit, evidence-preserving Portfolio Observation for monitoring and professional
        review.
      </p>
      <label>
        Nodalora API URL
        <input
          value={config.apiUrl}
          onChange={(event) => setConfig({ ...config, apiUrl: event.target.value })}
        />
      </label>
      <label>
        Source Connection ID
        <input
          value={config.sourceConnectionId}
          onChange={(event) => setConfig({ ...config, sourceConnectionId: event.target.value })}
        />
      </label>
      <label>
        Source credential
        <input
          type="password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>Accounts included in this observation</legend>
        {accounts.map((account) => (
          <label key={account.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={config.accountIds.includes(account.id)}
              onChange={(event) =>
                setConfig({
                  ...config,
                  accountIds: event.target.checked
                    ? [...config.accountIds, account.id]
                    : config.accountIds.filter((id) => id !== account.id),
                })
              }
            />{" "}
            {account.name} ({account.currency})
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={() => void submit()} disabled={busy}>
        {busy ? "Submitting…" : "Submit Portfolio Observation"}
      </button>
      {message && <p role="status">{message}</p>}
      <small>
        Credentials stay in the host's secure addon store. Nodalora receives only the selected
        accounts and their source evidence.
      </small>
    </main>
  );
}

let addonContext: AddonContext | undefined;

const NodaloraRoute = () => <NodaloraPage ctx={addonContext!} />;

const enable: AddonEnableFunction = (ctx) => {
  addonContext = ctx;
  ctx.router.add({
    id: "nodalora-portfolio",
    path: "/addons/nodalora-portfolio",
    component: NodaloraRoute,
  });
  ctx.onDisable(() => {
    addonContext = undefined;
  });
};

export default enable;
