type ApiOptions = RequestInit & {
  json?: unknown;
};

type AttributionState = {
  landingPath?: string;
  referrer?: string;
  referrerDomain?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
};

const ATTRIBUTION_STORAGE_KEY = "artifacthub.attribution";

function getAttributionState(): AttributionState {
  if (typeof window === "undefined") {
    return {};
  }

  let stored: AttributionState = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "{}");
  } catch {
    stored = {};
  }

  const params = new URLSearchParams(window.location.search);
  const referrer = stored.referrer || document.referrer || undefined;
  const referrerDomain = (() => {
    try {
      return stored.referrerDomain || (referrer ? new URL(referrer).hostname : undefined);
    } catch {
      return stored.referrerDomain;
    }
  })();

  const next: AttributionState = {
    landingPath:
      stored.landingPath ||
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    referrer,
    referrerDomain,
    utmSource: stored.utmSource || params.get("utm_source") || undefined,
    utmMedium: stored.utmMedium || params.get("utm_medium") || undefined,
    utmCampaign: stored.utmCampaign || params.get("utm_campaign") || undefined,
    utmTerm: stored.utmTerm || params.get("utm_term") || undefined,
    utmContent: stored.utmContent || params.get("utm_content") || undefined,
  };

  window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error || `Request failed with status ${status}.`));
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;
  const attribution = getAttributionState();

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  if (typeof window !== "undefined") {
    headers.set("x-artifacthub-timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    headers.set("x-artifacthub-locale", navigator.language || "en");
    headers.set("x-artifacthub-utc-offset", String(new Date().getTimezoneOffset() * -1));
    headers.set("x-artifacthub-local-hour", String(new Date().getHours()));
    if (attribution.landingPath) {
      headers.set("x-artifacthub-landing-path", attribution.landingPath);
    }
    if (attribution.referrer) {
      headers.set("x-artifacthub-referrer", attribution.referrer);
    }
    if (attribution.referrerDomain) {
      headers.set("x-artifacthub-referrer-domain", attribution.referrerDomain);
    }
    if (attribution.utmSource) headers.set("x-artifacthub-utm-source", attribution.utmSource);
    if (attribution.utmMedium) headers.set("x-artifacthub-utm-medium", attribution.utmMedium);
    if (attribution.utmCampaign) headers.set("x-artifacthub-utm-campaign", attribution.utmCampaign);
    if (attribution.utmTerm) headers.set("x-artifacthub-utm-term", attribution.utmTerm);
    if (attribution.utmContent) headers.set("x-artifacthub-utm-content", attribution.utmContent);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body,
    credentials: "same-origin",
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof data === "object" && data ? data : { error: data },
    );
  }

  return data as T;
}

export function formatDate(value?: string) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value?: string) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
