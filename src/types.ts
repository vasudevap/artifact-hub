export type FeatureAvailability = {
  aiAssistant: boolean;
  reviewWorkflow: boolean;
  docxExport: boolean;
};

export type User = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
};

export type Provenance = {
  artifactId: string;
  fieldId: string;
  sourceType: string;
  sourceRecordId?: string | null;
  updatedAt: string;
};

export type Finding = {
  id: string;
  artifactId: string;
  fieldId?: string | null;
  sourceType: "rule" | "ai";
  severity: "blocking" | "advisory";
  findingType: string;
  message: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt?: string | null;
};

export type Completeness = {
  completed: number;
  total: number;
  percentage: number;
  missingFieldIds: string[];
};

export type Artifact = {
  id: string;
  ownerId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  templateVersionId?: string | null;
  templateId: string;
  title: string;
  status: string;
  fieldValues: Record<string, unknown>;
  revision: number;
  templateVersion: number;
  workflowStage: string;
  completeness: Completeness;
  provenance: Record<string, Provenance>;
  openFindings: Finding[];
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  ownerId: string;
  name: string;
  sponsor: string;
  objective: string;
  status: string;
  artifacts: Artifact[];
  createdAt: string;
  updatedAt: string;
};

export type TemplateField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "list" | "scope" | "table";
  required: boolean;
  section?: string;
  placeholder?: string;
  columns?: string[];
};

export type Template = {
  id: string;
  version: number;
  title: string;
  role?: string;
  description: string;
  category: string;
  lifecycleStage: string;
  aiEnabled: boolean;
  recommended: boolean;
  stageKey: string;
  stageName: string;
  stageOrder: number;
  stageUseWhen: string;
  sourceStandard?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceNotes?: string;
  fields: TemplateField[];
};

export type ContextItem = {
  id: string;
  projectId: string;
  category: string;
  key: string;
  label: string;
  value: unknown;
  trustState: "proposed" | "confirmed" | "rejected";
  sourceType: string;
  sourceRecordId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  projectId: string;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  projectName?: string;
  targetHref?: string;
  targetLabel?: string;
};

export type Recommendation = {
  type: string;
  title: string;
  action: string;
  href: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  metadata: {
    autoUpdates?: FieldUpdate[];
    pendingUpdates?: FieldUpdate[];
  };
  createdAt: string;
};

export type FieldUpdate = {
  fieldId: string;
  value: unknown;
  reason: string;
};

export type Version = {
  id: string;
  artifactId: string;
  versionNumber: number;
  snapshot: {
    artifact: Artifact;
    template: Template;
  };
  approvedBy: string;
  approvedAt: string;
};

export type AdminAuditEvent = {
  id: string;
  adminUserId: string | null;
  action: string;
  targetUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminUserSummary = User & {
  updatedAt?: string;
  projectCount: number;
  artifactCount: number;
  sessionCount: number;
};

export type UsageTimelineEvent = {
  id: string;
  eventName: string;
  userId?: string | null;
  requestPath?: string | null;
  projectId?: string | null;
  artifactId?: string | null;
  templateId?: string | null;
  occurredAt: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type AdminUsageEvent = UsageTimelineEvent & {
  userEmail: string | null;
  userName: string | null;
};

export type AdminEventLogResponse = {
  total: number;
  events: AdminUsageEvent[];
};

export type AdminUserDetail = {
  user: User & { updatedAt?: string };
  timezone?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  sourceSummary: Record<string, unknown>;
  timeline: UsageTimelineEvent[];
};

export type AdminOverview = {
  metrics: Record<string, unknown>;
  storage: { type: string; ok: boolean };
  aiStatus: Record<string, unknown>;
  settings: Record<string, unknown>;
  recentAdminActions: AdminAuditEvent[];
  recentUsers: Array<Record<string, unknown>>;
  totalUsers: number;
};

export type AdminAnalytics = {
  range: string;
  metrics: Record<string, unknown>;
  topSources: Array<{ label: string; count: number }>;
  topCampaigns: Array<{ label: string; count: number }>;
  templateUsage: Array<{ templateId: string; count: number }>;
  loginByLocalHour: Array<{ hour: number; count: number }>;
  activityByLocalHour: Array<{ hour: number; count: number }>;
  funnel: Array<{ label: string; count: number }>;
  topUsers: Array<Record<string, unknown>>;
};
