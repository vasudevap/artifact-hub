import { zodResolver } from "@hookform/resolvers/zod";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useBlocker,
  useLocation,
  useMatch,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { z } from "zod";
import { api, ApiError, formatDate, formatDateTime } from "./api";
import type {
  Activity,
  AdminAnalytics,
  AdminAuditEvent,
  AdminOverview,
  AdminEventLogResponse,
  AdminUsageEvent,
  AdminUserDetail,
  AdminUserSummary,
  Artifact,
  ContextItem,
  FeatureAvailability,
  FieldUpdate,
  Finding,
  Message,
  Project,
  Recommendation,
  Template,
  TemplateField,
  User,
  Version,
} from "./types";

type Session = {
  user: User | null;
  features: FeatureAvailability;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const emptyFeatures: FeatureAvailability = {
  aiAssistant: false,
  reviewWorkflow: false,
  docxExport: false,
};

const SessionContext = createContext<Session | null>(null);

function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Session context is unavailable.");
  return session;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [features, setFeatures] = useState(emptyFeatures);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const response = await api<{
        user: User;
        features: FeatureAvailability;
      }>("/api/auth/me");
      setUser(response.user);
      setFeatures(response.features);
    } catch {
      setUser(null);
      setFeatures(emptyFeatures);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setFeatures(emptyFeatures);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = { user, features, loading, refresh, logout };

  return (
    <SessionContext.Provider value={value}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="/admin" element={<AdminRoute />}>
              <Route index element={<AdminPage />} />
            </Route>
            <Route path="/projects" element={<ProjectsShell />}>
              <Route index element={<ProjectsPage />} />
              <Route path=":projectId" element={<ProjectWorkspaceShell />}>
                <Route index element={<ProjectOverviewPage />} />
                <Route path="context" element={<ProjectContextPage />} />
                <Route path="library" element={<Navigate to="/library" replace />} />
                <Route
                  path="artifacts/:artifactId"
                  element={<ArtifactEditorPage />}
                />
                <Route
                  path="artifacts/:artifactId/review"
                  element={<ArtifactReviewPage />}
                />
                <Route
                  path="artifacts/:artifactId/export"
                  element={<ExportPreviewPage />}
                />
              </Route>
            </Route>
            <Route path="/about" element={<AboutShell />}>
              <Route index element={<AboutPage />} />
            </Route>
            <Route path="/activity" element={<GlobalActivityPage />} />
            <Route path="/library" element={<LibraryShell />}>
              <Route index element={<ArtifactLibraryPage />} />
              <Route
                path="artifacts/:artifactId"
                element={<ArtifactEditorPage />}
              />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionContext.Provider>
  );
}

function ProtectedRoute() {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  return user ? (
    <Outlet />
  ) : (
    <Navigate
      to="/auth"
      replace
      state={{ from: `${location.pathname}${location.search}${location.hash}` }}
    />
  );
}

function AdminRoute() {
  const { user, loading, refresh } = useSession();
  const [checkedAdminSession, setCheckedAdminSession] = useState(false);

  useEffect(() => {
    if (!loading && user && !user.isAdmin && !checkedAdminSession) {
      void refresh().finally(() => setCheckedAdminSession(true));
    } else if (!loading) {
      setCheckedAdminSession(true);
    }
  }, [checkedAdminSession, loading, refresh, user]);

  if (loading) return <FullPageLoading />;
  if (user && !user.isAdmin && !checkedAdminSession) return <FullPageLoading />;
  return user?.isAdmin ? <Outlet /> : <Navigate to="/projects" replace />;
}

const ADMIN_EVENT_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "auth.login_requested", label: "Login requested" },
  { value: "auth.login_completed", label: "Login completed" },
  { value: "auth.signup_completed", label: "Signup completed" },
  { value: "projects.list_viewed", label: "Projects viewed" },
  { value: "project.created", label: "Project created" },
  { value: "library.viewed", label: "Library viewed" },
  { value: "library.template_opened", label: "Template opened" },
  { value: "artifact.unassigned_started", label: "Unassigned draft started" },
  { value: "artifact.created", label: "Artifact created" },
  { value: "artifact.updated", label: "Artifact updated" },
  { value: "artifact.approved", label: "Artifact approved" },
  { value: "artifact.exported", label: "Artifact exported" },
  { value: "assistant.turn_requested", label: "Assistant requested" },
  { value: "assistant.turn_completed", label: "Assistant completed" },
  { value: "admin.password_reset_link_generated", label: "Admin reset link" },
  { value: "admin.temp_password_set", label: "Admin temp password" },
  { value: "admin.user_deleted", label: "Admin user deleted" },
  { value: "admin.sessions_invalidated", label: "Admin sessions invalidated" },
];

function formatEventContext(event: AdminUsageEvent): string {
  const source =
    event.context["utmSource"] ||
    event.context["referrerDomain"] ||
    event.context["landingPath"] ||
    event.context["referrer"] ||
    "Direct";
  const campaign =
    event.context["utmCampaign"] && ` • ${String(event.context["utmCampaign"])}`;
  const timezone =
    event.context["timezone"] && ` • ${String(event.context["timezone"])}`;
  return `${String(source)}${campaign || ""}${timezone || ""}`;
}

function formatEventTarget(event: AdminUsageEvent): string {
  const bits: string[] = [];
  if (event.projectId) {
    bits.push(`Proj ${event.projectId.slice(0, 6)}`);
  }
  if (event.artifactId) {
    bits.push(`Artifact ${event.artifactId.slice(0, 6)}`);
  }
  if (event.templateId) {
    bits.push(`Template ${event.templateId.slice(0, 6)}`);
  }
  return bits.join(" · ") || "No IDs";
}

const authSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().optional(),
});

type AuthValues = z.infer<typeof authSchema>;

function PasswordField({
  label,
  name,
  register,
  autoComplete,
  minLength,
  error,
  required,
}: {
  label: string;
  name: keyof AuthValues | "currentPassword" | "newPassword" | "confirmPassword";
  register?: ReturnType<typeof useForm<AuthValues>>["register"];
  autoComplete?: string;
  minLength?: number;
  error?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const registration = register ? register(name as keyof AuthValues) : undefined;

  return (
    <label>
      {label}
      <span className="password-input">
        <input
          {...registration}
          name={registration?.name || String(name)}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
      {error && <small>{error}</small>}
    </label>
  );
}

function AuthPage() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const resetToken = new URLSearchParams(location.search).get("resetToken");
  const requestedDestination =
    typeof location.state?.from === "string" && location.state.from.startsWith("/")
      ? location.state.from
      : "/projects";
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(
    resetToken ? "reset" : "login",
  );
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [postAuthDestination, setPostAuthDestination] = useState(requestedDestination);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
  });

  if (user) return <Navigate to={postAuthDestination} replace />;

  async function submit(values: AuthValues) {
    setMessage("");
    setResetUrl("");
    try {
      if (mode === "forgot") {
        const response = await api<{
          message: string;
          resetUrl?: string;
        }>("/api/auth/password-reset/request", {
          method: "POST",
          json: { email: values.email },
        });
        setMessage(response.message);
        setResetUrl(response.resetUrl || "");
        return;
      }

      if (!values.password || values.password.length < 8) {
        setMessage("Password must be at least 8 characters.");
        return;
      }

      if (mode === "reset") {
        await api("/api/auth/password-reset/confirm", {
          method: "POST",
          json: { token: resetToken, password: values.password },
        });
        setMode("login");
        setMessage("Password updated. Sign in with your new password.");
        window.history.replaceState({}, "", "/auth");
        return;
      }

      const isSignup = mode === "signup";
      const destination = isSignup ? "/about" : requestedDestination;
      setPostAuthDestination(destination);
      await api(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        json: values,
      });
      await refresh();
      navigate(destination, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue.");
    }
  }

  function changeMode(next: typeof mode) {
    setMode(next);
    setMessage("");
    setResetUrl("");
    reset();
  }

  return (
    <main className="auth-stage">
      <section className="auth-story">
        <ArtifactHubLogo variant="lockup-dark" className="auth-brand-lockup" />
        <p className="eyebrow">Connected context. Better artifacts. Confident delivery.</p>
        <h1>Turn project knowledge into credible working artifacts.</h1>
        <p>
          ArtifactHub combines reusable context, guided drafting, and human
          review in a calm document-first workspace.
        </p>
        <div className="demo-trust">
          <strong>Active Demo</strong>
          <span>Use fictional or non-sensitive project information.</span>
        </div>
      </section>
      <section className="auth-card">
        <p className="eyebrow">
          {mode === "signup"
            ? "Create your workspace"
            : mode === "forgot"
              ? "Reset access"
              : mode === "reset"
                ? "Choose a new password"
                : "Welcome back"}
        </p>
        <h2>
          {mode === "signup"
            ? "Start with a project"
            : mode === "forgot"
              ? "Create a reset link"
              : mode === "reset"
                ? "Update your password"
                : "Sign in to ArtifactHub"}
        </h2>
        <form onSubmit={handleSubmit(submit)} className="stack-form">
          {mode === "signup" && (
            <label>
              Name
              <input {...register("name")} autoComplete="name" />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              Email
              <input {...register("email")} type="email" autoComplete="email" />
              {errors.email && <small>{errors.email.message}</small>}
            </label>
          )}
          {mode !== "forgot" && (
            <PasswordField
              label="Password"
              name="password"
              register={register}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              error={errors.password?.message}
            />
          )}
          {message && <p className="form-message">{message}</p>}
          {resetUrl && (
            <a className="inline-link" href={resetUrl}>
              Continue to set a new password
            </a>
          )}
          <button className="primary-button" disabled={isSubmitting}>
            {isSubmitting
              ? "Working..."
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Create reset link"
                  : mode === "reset"
                    ? "Update password"
                    : "Sign in"}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" && (
            <>
              <button onClick={() => changeMode("signup")}>Create account</button>
              <button onClick={() => changeMode("forgot")}>Forgot password?</button>
            </>
          )}
          {mode !== "login" && (
            <button onClick={() => changeMode("login")}>Back to sign in</button>
          )}
        </div>
      </section>
    </main>
  );
}

function AppShell() {
  const { user, logout } = useSession();
  const [accountOpen, setAccountOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminArea = location.pathname.startsWith("/admin");
  const aboutActive = location.pathname === "/about";
  const artifactLibraryActive =
    location.pathname === "/library" ||
    location.pathname.startsWith("/library/");
  const activityActive = location.pathname === "/activity";
  const projectsActive =
    location.pathname === "/projects" ||
    location.pathname.startsWith("/projects/");

  async function handleLogout() {
    await logout();
    setAccountOpen(false);
    navigate("/auth");
  }

  return (
    <div className="app-shell">
      {!isAdminArea && (
        <nav className="global-rail" aria-label="Global navigation">
          <Link
            to="/about"
            className={`rail-logo ${aboutActive ? "active" : ""}`}
            aria-current={aboutActive ? "page" : undefined}
            aria-label="About ArtifactHub"
          >
            <ArtifactHubLogo variant="app-icon-dark" />
          </Link>
          <div className="rail-links">
            <RailLink
              to="/projects"
              icon="▣"
              label="Projects"
              active={projectsActive}
            />
            <RailLink
              to="/library"
              icon="▤"
              label="Artifact Library"
              active={artifactLibraryActive}
            />
            <RailLink
              to="/activity"
              icon="◷"
              label="Activity"
              active={activityActive}
            />
          </div>
          <button
            className="rail-profile"
            onClick={() => setAccountOpen(true)}
            aria-label="Open account settings"
          >
            <span>{initials(user?.name)}</span>
            <small>{user?.name.split(" ")[0]}</small>
          </button>
          <button
            className="rail-logout"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            ↩<small>Log out</small>
          </button>
        </nav>
      )}
      <div className={`app-canvas ${isAdminArea ? "app-canvas-admin" : ""}`}>
        {isAdminArea && (
          <header className="admin-command-bar">
            <div>
              <p className="eyebrow">Admin command station</p>
              <h1>Operations Console</h1>
            </div>
            <div className="admin-command-actions">
              <button
                className="secondary-button"
                onClick={() => setAccountOpen(true)}
              >
                {user?.name}
              </button>
              <button className="secondary-button" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </header>
        )}
        {!isAdminArea && (
          <header className="mobile-header">
            <Link to="/about" className="mobile-logo" aria-label="About ArtifactHub">
              <ArtifactHubLogo variant="mark-white" />
            </Link>
            <div className="mobile-account-actions">
              <button onClick={() => setAccountOpen(true)}>{user?.name}</button>
              <button onClick={handleLogout} aria-label="Log out">Log out</button>
            </div>
          </header>
        )}
        <Outlet />
        {!isAdminArea && (
          <footer className="demo-footer">
            <strong>Active Demo</strong>
            <span>Do not enter confidential or sensitive information.</span>
          </footer>
        )}
      </div>
      {accountOpen && (
        <AccountDialog
          onClose={() => setAccountOpen(false)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

function RailLink({
  to,
  icon,
  label,
  active,
}: {
  to: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`rail-link ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span>{icon}</span>
      <small>{label}</small>
    </Link>
  );
}

function AccountDialog({
  onClose,
  onLogout,
}: {
  onClose: () => void;
  onLogout: () => void;
}) {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }
    try {
      await api("/api/auth/password-change", {
        method: "POST",
        json: { currentPassword, newPassword },
      });
      await refresh();
      setMessage("Password updated.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update password.");
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="account-title">{user?.name}</h2>
            <span>{user?.email}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className="stack-form compact" onSubmit={changePassword}>
          <PasswordField
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
          <PasswordField
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button className="secondary-button">Update password</button>
          {message && <p className="form-message">{message}</p>}
        </form>
        {user?.isAdmin && (
          <section className="admin-section">
            <h3>Admin</h3>
            <div className="admin-row">
              <div>
                <strong>Open admin console</strong>
                <small>Operational controls, analytics, users, and AI settings.</small>
              </div>
              <button
                onClick={() => {
                  onClose();
                  navigate("/admin");
                }}
              >
                Open /admin
              </button>
            </div>
          </section>
        )}
        <button className="danger-link" onClick={onLogout}>Log out</button>
      </section>
    </div>
  );
}

function AdminPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState("7d");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [eventNameFilter, setEventNameFilter] = useState("all");
  const [eventUserFilter, setEventUserFilter] = useState("");

  const overviewQuery = useQuery({
    queryKey: ["admin-overview", range],
    queryFn: () => api<AdminOverview>(`/api/admin/overview?range=${range}`),
  });
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<{ users: AdminUserSummary[] }>("/api/admin/users"),
  });
  const analyticsQuery = useQuery({
    queryKey: ["admin-analytics", range],
    queryFn: () => api<AdminAnalytics>(`/api/admin/analytics?range=${range}`),
  });
  const endpointsQuery = useQuery({
    queryKey: ["admin-library-endpoints"],
    queryFn: () =>
      api<{ endpoints: Array<Record<string, unknown>> }>("/api/admin/library-endpoints"),
  });
  const systemQuery = useQuery({
    queryKey: ["admin-system"],
    queryFn: () => api<Record<string, unknown>>("/api/admin/system"),
  });
  const userDetailQuery = useQuery({
    queryKey: ["admin-user-detail", selectedUserId],
    queryFn: () => api<AdminUserDetail>(`/api/admin/users/${selectedUserId}`),
    enabled: Boolean(selectedUserId),
  });
  const eventLogQuery = useQuery({
    queryKey: ["admin-events", range, eventNameFilter, eventUserFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        range,
        limit: "180",
      });
      if (eventNameFilter !== "all") {
        params.set("eventName", eventNameFilter);
      }
      if (eventUserFilter) {
        params.set("userId", eventUserFilter);
      }
      return api<AdminEventLogResponse>(
        `/api/admin/events?${params.toString()}`,
      );
    },
  });

  const refreshAdminQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-system"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-events"] }),
    ]);
  };

  async function generateResetLink(target: AdminUserSummary) {
    const response = await api<{ resetUrl: string; expiresAt: string }>(
      `/api/admin/users/${target.id}/password-reset-link`,
      { method: "POST" },
    );
    window.prompt(
      `Reset link for ${target.email}. It expires ${formatDateTime(response.expiresAt)}.`,
      response.resetUrl,
    );
    await refreshAdminQueries();
  }

  async function setTemporaryPassword(target: AdminUserSummary) {
    const temporaryPassword = window.prompt(
      `Set a temporary password for ${target.email}`,
      "",
    );
    if (!temporaryPassword) return;
    await api(`/api/admin/users/${target.id}/temporary-password`, {
      method: "POST",
      json: { temporaryPassword },
    });
    await refreshAdminQueries();
  }

  async function invalidateSessions(target: AdminUserSummary) {
    if (!window.confirm(`Invalidate all active sessions for ${target.email}?`)) return;
    await api(`/api/admin/users/${target.id}/invalidate-sessions`, {
      method: "POST",
    });
    await refreshAdminQueries();
  }

  async function deleteUser(target: AdminUserSummary) {
    if (!window.confirm(`Delete ${target.email} and all owned work?`)) return;
    await api(`/api/admin/users/${target.id}`, { method: "DELETE" });
    if (selectedUserId === target.id) {
      setSelectedUserId("");
    }
    await refreshAdminQueries();
  }

  async function updateSystemSetting(next: {
    aiEnabledOverride?: boolean | null;
    outboundApiCallsEnabled?: boolean;
  }) {
    await api("/api/admin/system", {
      method: "PUT",
      json: next,
    });
    await refreshAdminQueries();
  }

  const users = usersQuery.data?.users || [];
  const overviewMetrics = overviewQuery.data?.metrics || {};
  const analytics = analyticsQuery.data;
  const aiStatus = (systemQuery.data?.aiStatus as Record<string, unknown>) || {};
  const settings = (systemQuery.data?.settings as Record<string, unknown>) || {};
  const selectedDetail = userDetailQuery.data;
  const eventEntries = eventLogQuery.data?.events || [];
  const selectedEventUser =
    users.find((account) => account.id === eventUserFilter)?.email || "All users";
  const selectedUser = users.find((account) => account.id === selectedUserId);
  const selectedActionUser = selectedDetail
    ? (selectedUser || (selectedDetail.user as AdminUserSummary))
    : null;
  const loginHourBuckets = analytics?.loginByLocalHour || [];
  const activityHourBuckets = analytics?.activityByLocalHour || [];
  const loginMax = Math.max(1, ...loginHourBuckets.map((entry) => entry.count || 0));
  const activityMax = Math.max(
    1,
    ...activityHourBuckets.map((entry) => entry.count || 0),
  );
  const funnelMax = Math.max(
    1,
    ...(analytics?.funnel || []).map((step) => step.count || 0),
  );
  const adminTabs = [
    { id: "overview", label: "Overview", icon: "◰" },
    { id: "users", label: "Users", icon: "👥" },
    { id: "events", label: "Event Log", icon: "◷" },
    { id: "telemetry", label: "Telemetry", icon: "📊" },
    { id: "api", label: "API Explorer", icon: "▤" },
    { id: "controls", label: "System Controls", icon: "⚙" },
  ];

  return (
    <main className="admin-workspace-shell">
      <aside className="admin-sidebar" aria-label="Operations Cockpit sections">
        <div className="admin-sidebar-header">
          <p className="eyebrow">Admin</p>
          <h2>Operations Cockpit</h2>
          <small>Demo operations and telemetry.</small>
        </div>
        <nav className="admin-sidebar-nav" aria-label="Admin console navigation">
          {adminTabs.map((tab) => (
            <button
              key={tab.id}
              className={`admin-sidebar-link ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <label>
            Range
            <select value={range} onChange={(event) => setRange(event.target.value)}>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
              <option value="all">All time</option>
            </select>
          </label>
          <button className="secondary-button" onClick={() => void refreshAdminQueries()}>
            Refresh
          </button>
          <button className="secondary-button" onClick={() => navigate("/projects")}>
            Back to work
          </button>
        </div>
      </aside>

      <section className="admin-workspace-content">
        {activeTab === "overview" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">System pulse</p>
                <h2>Overview</h2>
              </div>
              <span className="admin-count-chip">Live</span>
            </div>
            {overviewQuery.isLoading ? (
              <PanelLoading label="Loading overview..." />
            ) : (
              <div className="admin-metric-grid">
                {([
                  ["Users", overviewQuery.data?.totalUsers],
                  ["Active", overviewMetrics.activeUsers],
                  ["Signups", overviewMetrics.signups],
                  ["Logins", overviewMetrics.logins],
                  ["Projects", overviewMetrics.projectsCreated],
                  ["Artifacts", overviewMetrics.artifactsCreated],
                  ["Exports", overviewMetrics.exports],
                  ["AI turns", overviewMetrics.aiTurns],
                ] as Array<[string, unknown]>).map(([label, value]) => (
                  <div className="admin-metric-card" key={String(label)}>
                    <span>{label}</span>
                    <strong>{String(value ?? 0)}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="admin-status-row admin-status-bar">
              <small>Storage: {String(overviewQuery.data?.storage?.type || "unknown")}</small>
              <small>AI: {aiStatus.effectiveAiEnabled ? "Enabled" : "Disabled"}</small>
              <small>Outbound API: {aiStatus.outboundApiCallsEnabled ? "On" : "Off"}</small>
            </div>
            <div className="admin-audit-list">
              {(overviewQuery.data?.recentAdminActions || []).map((item: AdminAuditEvent) => (
                <div key={item.id}>
                  <strong>{item.action}</strong>
                  <small>{formatDateTime(item.createdAt)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "users" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">Identity layer</p>
                <h2>Users</h2>
              </div>
              <span className="admin-count-chip">{users.length}</span>
            </div>
            <div className="admin-user-split">
              <div className="admin-user-table">
                {users.map((account) => (
                  <button
                    key={account.id}
                    className={`admin-user-row ${selectedUserId === account.id ? "active" : ""}`}
                    onClick={() => setSelectedUserId(account.id)}
                    type="button"
                  >
                    <div>
                      <strong>{account.email}</strong>
                      <small>
                        {account.projectCount} projects · {account.artifactCount} artifacts ·{" "}
                        {account.sessionCount} sessions
                      </small>
                    </div>
                    <span>{account.id === user?.id ? "You" : "View"}</span>
                  </button>
                ))}
              </div>
              <div className="admin-user-detail">
                {selectedDetail ? (
                  <>
                    <h3>{selectedDetail.user.email}</h3>
                    <p>
                      Last login: {formatDateTime(selectedDetail.lastLoginAt || undefined)} · Last
                      seen: {formatDateTime(selectedDetail.lastSeenAt || undefined)}
                    </p>
                    <p>Timezone: {String(selectedDetail.timezone || "Not captured yet")}</p>
                    <div className="admin-actions">
                      {selectedDetail.user.id !== user?.id && selectedActionUser && (
                        <>
                          <button
                            className="secondary-button"
                            onClick={() => generateResetLink(selectedActionUser)}
                          >
                            Reset link
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => setTemporaryPassword(selectedActionUser)}
                          >
                            Temp password
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => invalidateSessions(selectedActionUser)}
                          >
                            Invalidate sessions
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setEventUserFilter(selectedDetail.user.id);
                              setActiveTab("events");
                            }}
                          >
                            Filter event log
                          </button>
                          <button
                            className="danger-link"
                            onClick={() => deleteUser(selectedActionUser)}
                          >
                            Delete user
                          </button>
                        </>
                      )}
                    </div>
                    <div className="admin-timeline">
                      {selectedDetail.timeline.slice(0, 12).map((event) => (
                        <div key={event.id}>
                          <strong>{event.eventName}</strong>
                          <small>{formatDateTime(event.occurredAt)}</small>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="admin-empty-state">
                    <h3>Select a user</h3>
                    <p>Choose an account to review access, sessions, and timeline activity.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "events" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">Streams</p>
                <h2>Event Log</h2>
              </div>
              <span className="admin-count-chip">{eventEntries.length}</span>
            </div>
            <div className="admin-event-controls">
              <label>
                Event type
                <select
                  value={eventNameFilter}
                  onChange={(event) => setEventNameFilter(event.target.value)}
                >
                  {ADMIN_EVENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                User
                <select
                  value={eventUserFilter}
                  onChange={(event) => setEventUserFilter(event.target.value)}
                >
                  <option value="">All users</option>
                  {users.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="admin-event-list">
              {eventLogQuery.isLoading ? (
                <PanelLoading label="Loading events..." />
              ) : (
                <div className="admin-event-list-inner">
                  <div className="admin-event-head">
                    <span>Time</span>
                    <span>User</span>
                    <span>Event</span>
                    <span>Path</span>
                    <span>Context</span>
                    <span>Targets</span>
                  </div>
                  {eventEntries.length ? (
                    eventEntries.map((entry) => (
                      <div className="admin-event-row" key={entry.id}>
                        <span>{formatDateTime(entry.occurredAt)}</span>
                        <span>{entry.userEmail || "System"}</span>
                        <span className="admin-event-name">{entry.eventName}</span>
                        <span>{entry.requestPath || "—"}</span>
                        <span>{formatEventContext(entry)}</span>
                        <span>{formatEventTarget(entry)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="admin-event-empty">No events for this filter.</p>
                  )}
                </div>
              )}
            </div>
            <p className="helper-copy">
              Showing {eventEntries.length} {eventNameFilter === "all" ? "events" : "matching events"} for{" "}
              {selectedEventUser}
              {eventLogQuery.data ? ` (up to ${eventLogQuery.data.total} available)` : ""}
            </p>
          </div>
        )}

        {activeTab === "telemetry" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">Telemetry</p>
                <h2>Analytics</h2>
              </div>
              <span className="admin-count-chip">{analytics?.topSources?.length || 0}</span>
            </div>
            {analyticsQuery.isLoading ? (
              <PanelLoading label="Loading analytics..." />
            ) : (
              <>
                <div className="admin-inline-groups">
                  <div>
                    <p className="sidebar-section-label">Top sources</p>
                    {(analytics?.topSources || []).map((item) => (
                      <div className="admin-stat-line" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="sidebar-section-label">Top campaigns</p>
                    {(analytics?.topCampaigns || []).map((item) => (
                      <div className="admin-stat-line" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="sidebar-section-label">Funnel</p>
                  <div className="admin-funnel-list">
                    {(analytics?.funnel || []).map((step) => {
                      const width = (step.count / funnelMax) * 100;
                      return (
                        <div className="admin-funnel-row" key={step.label}>
                          <div className="admin-stat-line">
                            <span>{step.label}</span>
                            <strong>{step.count}</strong>
                          </div>
                          <span className="admin-funnel-track">
                            <span
                              className="admin-funnel-fill"
                              style={{ width: `${width.toFixed(1)}%` }}
                            />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="admin-inline-groups">
                  <div>
                    <p className="sidebar-section-label">Login hour heatmap</p>
                    <div className="admin-heat-grid">
                      {loginHourBuckets.map((entry) => {
                        const width = (entry.count / loginMax) * 100;
                        return (
                          <div className="admin-heat-row" key={`login-${entry.hour}`}>
                            <span>{entry.hour}:00</span>
                            <span className="admin-heat-track">
                              <span
                                className="admin-heat-fill"
                                style={{ width: `${width.toFixed(1)}%` }}
                              />
                            </span>
                            <strong>{entry.count}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="sidebar-section-label">Activity hour heatmap</p>
                    <div className="admin-heat-grid">
                      {activityHourBuckets.map((entry) => {
                        const width = (entry.count / activityMax) * 100;
                        return (
                          <div className="admin-heat-row" key={`activity-${entry.hour}`}>
                            <span>{entry.hour}:00</span>
                            <span className="admin-heat-track">
                              <span
                                className="admin-heat-fill"
                                style={{ width: `${width.toFixed(1)}%` }}
                              />
                            </span>
                            <strong>{entry.count}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "api" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">Platform surface</p>
                <h2>API Explorer</h2>
              </div>
              <span className="admin-count-chip">
                {endpointsQuery.data?.endpoints.length || 0}
              </span>
            </div>
            <div className="admin-endpoint-list">
              {(endpointsQuery.data?.endpoints || []).map((endpoint) => (
                <div key={`${endpoint.method}-${endpoint.path}`}>
                  <strong>
                    {String(endpoint.method)} {String(endpoint.path)}
                  </strong>
                  <small>{String(endpoint.purpose)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "controls" && (
          <div className="admin-tab-panel">
            <div className="admin-view-heading">
              <div>
                <p className="eyebrow">Execution controls</p>
                <h2>System Controls</h2>
              </div>
              <span className="admin-count-chip">
                AI {aiStatus.effectiveAiEnabled ? "active" : "off"}
              </span>
            </div>
            <div className="admin-control-list">
              <label className="admin-toggle-row">
                <span>Global AI enabled override</span>
                <select
                  value={
                    settings.aiEnabledOverride === null
                      ? "inherit"
                      : settings.aiEnabledOverride
                        ? "on"
                        : "off"
                  }
                  onChange={(event) =>
                    updateSystemSetting({
                      aiEnabledOverride:
                        event.target.value === "inherit"
                          ? null
                          : event.target.value === "on",
                      outboundApiCallsEnabled: Boolean(
                        systemQuery.data?.settings &&
                          (systemQuery.data.settings as Record<string, unknown>)
                            .outboundApiCallsEnabled !== false,
                      ),
                    })
                  }
                >
                  <option value="inherit">Inherit env</option>
                  <option value="on">Force on</option>
                  <option value="off">Force off</option>
                </select>
              </label>
              <label className="admin-toggle-row">
                <span>Outbound AI/API calls</span>
                <input
                  type="checkbox"
                  checked={settings.outboundApiCallsEnabled !== false}
                  onChange={(event) =>
                    updateSystemSetting({
                      aiEnabledOverride:
                        settings.aiEnabledOverride === true ||
                        settings.aiEnabledOverride === false
                          ? Boolean(settings.aiEnabledOverride)
                          : null,
                      outboundApiCallsEnabled: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <div className="admin-module-spacer" />
            <div className="admin-stat-line">
              <span>Configured provider</span>
              <strong>{String(aiStatus.provider || "unknown")}</strong>
            </div>
            <div className="admin-stat-line">
              <span>Configured model</span>
              <strong>{String(aiStatus.model || "unknown")}</strong>
            </div>
            <div className="admin-stat-line">
              <span>Reasoning</span>
              <strong>{String(aiStatus.reasoningEffort || "unknown")}</strong>
            </div>
            <p className="helper-copy">
              Runtime provider/model editing is intentionally placeholder-only in this
              version. Global AI availability and outbound AI access are the active
              controls today.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

type ProjectsShellContext = {
  projects: Project[];
  filteredProjects: Project[];
  projectsLoading: boolean;
  projectsError: boolean;
  search: string;
  setSearch: (value: string) => void;
  openCreateProject: () => void;
  deleteProject: (project: Project) => Promise<void>;
};

function ProjectsShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selectedMatch = useMatch("/projects/:projectId/*");
  const selectedProjectId = selectedMatch?.params.projectId || "";
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const projects = projectsQuery.data || [];
  const normalizedProjectSearch = search.trim().toLowerCase();
  const filteredProjects = projects.filter((project) =>
    [
      project.name,
      project.sponsor,
      project.objective,
      ...project.artifacts.map((artifact) => artifact.title),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedProjectSearch),
  );
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) || null;
  const shouldShowProjects = normalizedProjectSearch ? true : projectsExpanded;

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const project = await api<Project>("/api/projects", {
      method: "POST",
      json: {
        name: form.get("name"),
        sponsor: form.get("sponsor"),
        objective: form.get("objective"),
      },
    });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate(`/projects/${project.id}/context`);
    setCreating(false);
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete "${project.name}" and all its artifacts?`)) return;
    await api(`/api/projects/${project.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    if (selectedProjectId === project.id) {
      navigate("/projects");
    }
  }

  return (
    <div className="projects-area-shell">
      <aside className="project-sidebar projects-sidebar">
        <p className="sidebar-section-label">Find projects</p>
        <label className="template-search">
          <input
            aria-label="Search projects"
            placeholder="Search projects..."
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="primary-button wide-button projects-sidebar-action"
          type="button"
          onClick={() => setCreating(true)}
        >
          Create project
        </button>
        <div className="sidebar-divider" />
        <section className="projects-accordion">
          <button
            aria-expanded={shouldShowProjects}
            aria-label={`Projects, ${filteredProjects.length} project${filteredProjects.length === 1 ? "" : "s"}`}
            className="projects-nav-heading"
            type="button"
            onClick={() => {
              if (!normalizedProjectSearch) {
                setProjectsExpanded((current) => !current);
              }
            }}
          >
            <span className="stage-heading-row">
              <strong>Projects</strong>
              <em className="stage-count">{filteredProjects.length}</em>
              <span className="stage-toggle-indicator">
                {normalizedProjectSearch ? "Matches" : shouldShowProjects ? "Hide" : "Show"}
              </span>
            </span>
          </button>
          {shouldShowProjects && (
            <nav className="projects-list-nav" aria-label="Projects list">
              {filteredProjects.map((project) => {
                const completed = project.artifacts.length
                  ? Math.round(
                      project.artifacts.reduce(
                        (sum, artifact) => sum + artifact.completeness.percentage,
                        0,
                      ) / project.artifacts.length,
                    )
                  : 0;
                const isSelected = selectedProjectId === project.id;

                return (
                  <div className="project-list-group" key={project.id}>
                    <NavLink
                      className="project-list-link"
                      to={`/projects/${project.id}`}
                    >
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.sponsor || "No sponsor set"}</small>
                      </span>
                      <em>{completed}%</em>
                    </NavLink>
                    {isSelected && (
                      <div className="selected-project-links">
                        <nav className="project-nav" aria-label={`${project.name} sections`}>
                          <NavLink end to={`/projects/${project.id}`}>Overview</NavLink>
                          <NavLink to={`/projects/${project.id}/context`}>Project Context</NavLink>
                        </nav>
                        <div className="selected-project-subheading">
                          <span>Artifacts</span>
                          <em>{project.artifacts.length}</em>
                        </div>
                        <nav className="artifact-nav" aria-label={`${project.name} artifacts`}>
                          {project.artifacts.map((artifact) => (
                            <NavLink
                              key={artifact.id}
                              to={`/projects/${project.id}/artifacts/${artifact.id}`}
                            >
                              <span>{artifact.title}</span>
                              <em>{artifact.completeness.percentage}%</em>
                            </NavLink>
                          ))}
                          {!project.artifacts.length && <small>No artifacts started.</small>}
                        </nav>
                      </div>
                    )}
                  </div>
                );
              })}
              {!projectsQuery.isLoading && filteredProjects.length === 0 && (
                <p className="template-search-empty">
                  {projects.length
                    ? "No projects found. Try a different search term."
                    : "No projects yet."}
                </p>
              )}
              {projectsQuery.isLoading && (
                <p className="template-search-empty">Loading projects...</p>
              )}
            </nav>
          )}
        </section>
        {selectedProject && (
          <>
            <div className="sidebar-divider" />
            <dl className="selected-project-meta">
              <div><dt>Status</dt><dd className="success-text">Active</dd></div>
              <div><dt>Updated</dt><dd>{formatDateTime(selectedProject.updatedAt)}</dd></div>
            </dl>
          </>
        )}
      </aside>
      <div className="projects-area-content">
        <Outlet
          context={{
            projects,
            filteredProjects,
            projectsLoading: projectsQuery.isLoading,
            projectsError: projectsQuery.isError,
            search,
            setSearch,
            openCreateProject: () => setCreating(true),
            deleteProject,
          }}
        />
      </div>
      {creating && (
        <div className="dialog-backdrop" onMouseDown={() => setCreating(false)}>
          <form
            className="dialog-card create-project-card"
            onSubmit={createProject}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">New workspace</p>
                <h2>Create a project</h2>
                <span>Start with the essentials. Context setup comes next.</span>
              </div>
              <button type="button" className="icon-button" onClick={() => setCreating(false)}>×</button>
            </div>
            <div className="stack-form">
              <label>
                Project name
                <input name="name" required autoFocus />
              </label>
              <label>
                Sponsor
                <input name="sponsor" />
              </label>
              <label>
                Objective
                <textarea name="objective" rows={4} />
              </label>
              <button className="primary-button">Create and set up context</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function useProjectsShell() {
  return useOutletContext<ProjectsShellContext>();
}

function ProjectsPage() {
  const {
    projects,
    filteredProjects,
    projectsLoading,
    projectsError,
    openCreateProject,
    deleteProject,
  } = useProjectsShell();
  const inProgress = projects.reduce(
    (count, project) =>
      count + project.artifacts.filter((artifact) => artifact.status !== "approved").length,
    0,
  );
  const attention = projects.reduce(
    (count, project) =>
      count +
      project.artifacts.reduce(
        (sum, artifact) => sum + artifact.openFindings.length,
        0,
      ),
    0,
  );

  return (
    <main className="page-frame projects-page">
      <PageHeading
        eyebrow="Workspace"
        title="Projects"
        description="Continue drafting, review work that needs attention, and move the next delivery decision forward."
        action={<button className="primary-button" onClick={openCreateProject}>+ New project</button>}
      />
      <section className="demo-banner">
        <div>
          <strong>Active Demo</strong>
          <span>AI-guided workflows are beta-gated. Use non-sensitive information.</span>
        </div>
        <Link to="/library">Browse artifact library</Link>
      </section>
      <section className="metric-grid">
        <Metric label="Active projects" value={projects.length} tone="teal" />
        <Metric label="Artifacts in progress" value={inProgress} tone="blue" />
        <Metric label="Items need attention" value={attention} tone="amber" />
      </section>
      {projectsLoading ? (
        <PanelLoading label="Loading projects..." />
      ) : projectsError ? (
        <EmptyState
          title="Projects could not be loaded"
          body="Check the server connection and try again."
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          title={projects.length ? "No projects match that search" : "No projects yet"}
          body={
            projects.length
              ? "Try a different project name."
              : "Create your first workspace, then confirm the context ArtifactHub can reuse."
          }
          action={
            !projects.length ? (
              <button className="primary-button" onClick={openCreateProject}>
                Create first project
              </button>
            ) : undefined
          }
        />
      ) : (
        <section className="project-grid">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => deleteProject(project)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

const aboutTocItems = [
  {
    href: "#about-overview",
    title: "Overview",
    body: "What ArtifactHub is for",
  },
  {
    href: "#about-demo",
    title: "Demo note",
    body: "Current product boundary",
  },
  {
    href: "#about-today",
    title: "Available today",
    body: "What works now",
  },
  {
    href: "#about-flow",
    title: "Context flow",
    body: "How knowledge connects",
  },
  {
    href: "#about-roadmap",
    title: "Product direction",
    body: "Where it is going",
  },
  {
    href: "#about-founder",
    title: "Founder perspective",
    body: "Why it exists",
  },
  {
    href: "#about-feedback",
    title: "Feedback",
    body: "How to share input",
  },
];

function AboutShell() {
  return (
    <div className="about-shell">
      <aside className="about-sidebar">
        <section className="about-toc-panel">
          <div className="about-nav-heading">
            <span className="stage-heading-row">
              <strong>About</strong>
              <em className="stage-count">{aboutTocItems.length}</em>
            </span>
          </div>
          <nav className="about-toc-nav" aria-label="About page sections">
            {aboutTocItems.map((item) => (
              <a href={item.href} key={item.href}>
                <span>{item.title}</span>
                <small>{item.body}</small>
              </a>
            ))}
          </nav>
        </section>
        <Link className="primary-button wide-button about-sidebar-action" to="/projects">
          Open projects
        </Link>
      </aside>
      <div className="about-content">
        <Outlet />
      </div>
    </div>
  );
}

function AboutPage() {
  const [expandedRoadmapId, setExpandedRoadmapId] = useState<string | null>(null);
  const capabilities = [
    {
      title: "Private project workspaces",
      body: "Keep each project's context, artifacts, and delivery activity organized in one owned workspace.",
    },
    {
      title: "Reusable artifact templates",
      body: "Start with structured templates for common project-delivery documents instead of an empty page.",
    },
    {
      title: "Practical drafting tools",
      body: "Draft, edit, autosave, resume, and export artifacts through a document-first workflow.",
    },
    {
      title: "Less blank-page friction",
      body: "Use guided sections and required fields to move from an idea to a useful first draft faster.",
    },
    {
      title: "More consistent documentation",
      body: "Apply repeatable structures across charters, registers, logs, plans, requirements, and reports.",
    },
    {
      title: "Reusable project context",
      body: "Confirm project facts once, then make that trusted context available across related artifacts.",
    },
  ];
  const outputs = [
    "Charters",
    "RAID Logs",
    "Stakeholder Registers",
    "Requirements",
    "Status Reports",
  ];
  const roadmap = [
    {
      id: "structured-project-memory",
      phase: "Foundation",
      title: "Structured project memory",
      body: "A trusted, reusable context layer that carries project knowledge between artifacts.",
      completedCount: 4,
      totalCount: 5,
      completed: [
        "Owned workspaces are live.",
        "Reusable context capture is live.",
        "Context completeness is tracked.",
      ],
      outstanding: [
        "Cross-project memory continuity.",
      ],
    },
    {
      id: "ai-assisted-artifact-creation",
      phase: "Guided creation",
      title: "AI-assisted artifact creation",
      body: "Purposeful assistance that helps practitioners draft and refine without taking control away.",
      completedCount: 1,
      totalCount: 5,
      completed: [
        "AI feature scaffolding is beta-gated.",
      ],
      outstanding: [
        "Broader drafting rollout.",
        "Stronger artifact coverage.",
        "Deeper safeguard productization.",
      ],
    },
    {
      id: "cross-artifact-consistency",
      phase: "Connected delivery",
      title: "Cross-artifact consistency",
      body: "Detect contradictions, missing dependencies, and context drift across the project record.",
      completedCount: 1,
      totalCount: 10,
      completed: [
        "Shared context feeds multiple surfaces.",
      ],
      outstanding: [
        "Contradiction checks.",
        "Dependency tracing.",
        "Context-drift detection.",
      ],
    },
    {
      id: "review-and-approval-workflows",
      phase: "Governance",
      title: "Review and approval workflows",
      body: "Clear findings, accountable decisions, immutable versions, and export-ready approvals.",
      completedCount: 17,
      totalCount: 20,
      completed: [
        "Review mode and blockers.",
        "Immutable approval snapshots.",
        "Approved-version exports.",
      ],
      outstanding: [
        "Multi-reviewer routing.",
        "Richer decision history.",
      ],
    },
    {
      id: "organizational-templates-and-libraries",
      phase: "Scale",
      title: "Organizational templates and libraries",
      body: "Reusable standards tailored to how teams and PMOs actually deliver work.",
      completedCount: 13,
      totalCount: 20,
      completed: [
        "Structured template catalog.",
        "Template versioning.",
        "Recommended library flow.",
      ],
      outstanding: [
        "Team-level libraries.",
        "PMO standards configuration.",
        "Admin template management.",
      ],
    },
    {
      id: "ai-powered-delivery-guidance",
      phase: "Guidance",
      title: "AI-powered delivery guidance",
      body: "Contextual next steps and practical coaching grounded in the work already completed.",
      completedCount: 1,
      totalCount: 4,
      completed: [
        "Workspace next-step framing.",
      ],
      outstanding: [
        "Richer coaching logic.",
        "More workflow coverage.",
        "Stronger delivery sequencing.",
      ],
    },
    {
      id: "enterprise-knowledge-reuse",
      phase: "Knowledge",
      title: "Enterprise knowledge reuse",
      body: "Turn proven delivery knowledge into governed, repeatable organizational capability.",
      completedCount: 1,
      totalCount: 20,
      completed: [
        "Structured delivery record foundation.",
      ],
      outstanding: [
        "Governed knowledge capture.",
        "Reusable organizational patterns.",
        "Enterprise reuse workflows.",
      ],
    },
  ];

  return (
    <main className="page-frame about-page">
      <section className="about-hero" id="about-overview" aria-labelledby="about-title">
        <div className="about-hero-copy">
          <p className="eyebrow">About ArtifactHub</p>
          <h1 id="about-title">Project Intelligence, Not Just Project Documents</h1>
          <p className="about-lede">
            ArtifactHub is a guided project-delivery workspace that helps project
            managers, business analysts, product owners, PMO teams, and delivery
            professionals turn reusable project context into structured,
            review-ready artifacts.
          </p>
          <div className="about-actions">
            <Link className="primary-button" to="/projects">Explore ArtifactHub</Link>
            <a className="secondary-button" href="mailto:artifacthub@grafley.com">
              Share Feedback
            </a>
          </div>
        </div>
        <aside className="about-hero-card" aria-label="ArtifactHub product principle">
          <ArtifactHubLogo variant="mark-primary" className="about-hero-mark" />
          <p className="eyebrow">Connected project knowledge</p>
          <blockquote>
            Confirm context once. Build better artifacts from it. Keep delivery
            knowledge connected as the project evolves.
          </blockquote>
          <span>Connected context. Better artifacts. Confident delivery.</span>
        </aside>
      </section>

      <section className="about-demo-notice" id="about-demo" aria-labelledby="demo-notice-title">
        <div>
          <span className="about-notice-icon" aria-hidden="true">!</span>
          <div>
            <h2 id="demo-notice-title">ArtifactHub is an active demo</h2>
            <p>
              The product is evolving through active testing and feedback. Do not
              enter confidential, sensitive, regulated, or personally identifiable
              information.
            </p>
          </div>
        </div>
      </section>

      <section className="about-section" id="about-today" aria-labelledby="today-title">
        <div className="about-section-heading">
          <p className="eyebrow">Available today</p>
          <h2 id="today-title">What ArtifactHub Is Today</h2>
          <p>
            ArtifactHub is an early-stage working product focused on the practical
            mechanics of creating and maintaining stronger project documentation.
          </p>
        </div>
        <div className="about-today-layout">
          <article className="about-story-card">
            <span className="about-card-number">01</span>
            <h3>A calmer way to start project work</h3>
            <div className="about-story-copy">
              <p>
                Project teams repeatedly recreate the same foundational documents,
                often from disconnected files and incomplete context. ArtifactHub
                brings that work into a guided workspace where structure and reusable
                project knowledge reduce repetition.
              </p>
              <p>
                The current demo supports the core manual workflow while the
                AI-assisted experience is developed and tested with appropriate
                safeguards.
              </p>
            </div>
            <div className="about-story-footer">
              <div className="about-story-workflow">
                <span>Current workflow</span>
                <p>Create workspace → Add context → Choose template → Draft → Export</p>
              </div>
              <div className="about-story-mark" aria-hidden="true">
                <ArtifactHubLogo variant="mark-primary" />
              </div>
            </div>
          </article>
          <div className="about-capability-grid">
            {capabilities.map((capability, index) => (
              <article className="about-capability-card" key={capability.title}>
                <span aria-hidden="true">{String(index + 2).padStart(2, "0")}</span>
                <h3>{capability.title}</h3>
                <p>{capability.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section about-flow-section" id="about-flow" aria-labelledby="flow-title">
        <div className="about-section-heading centered">
          <p className="eyebrow">How it connects</p>
          <h2 id="flow-title">One context layer, many delivery artifacts</h2>
          <p>
            ArtifactHub is designed to keep the facts that shape a project connected
            to the documents that communicate and govern it.
          </p>
        </div>
        <figure className="about-flow" aria-labelledby="flow-title">
          <div className="about-flow-source">
            <span className="about-flow-node" aria-hidden="true">◎</span>
            <strong>Project Context</strong>
            <small>Objectives, scope, stakeholders, risks, decisions</small>
          </div>
          <div className="about-flow-arrow" aria-hidden="true">→</div>
          <div className="about-flow-hub">
            <ArtifactHubLogo variant="mark-white" />
            <strong>ArtifactHub</strong>
            <small>Structures and reuses trusted context</small>
          </div>
          <div className="about-flow-arrow" aria-hidden="true">→</div>
          <div className="about-flow-outputs">
            {outputs.map((output) => <span key={output}>{output}</span>)}
          </div>
          <figcaption>
            Confirmed project context flows through ArtifactHub into structured
            project-delivery artifacts.
          </figcaption>
        </figure>
      </section>

      <section className="about-section" id="about-roadmap" aria-labelledby="roadmap-title">
        <div className="about-section-heading">
          <p className="eyebrow">Product direction</p>
          <h2 id="roadmap-title">Where ArtifactHub Is Going</h2>
          <p>
            The roadmap moves from reliable artifact creation toward connected,
            context-aware delivery guidance. It is directional and will evolve with
            practitioner feedback.
          </p>
          <p className="about-roadmap-note">
            Click any roadmap card to see completed and remaining work.
          </p>
        </div>
        <div className="about-roadmap">
          {roadmap.map((item, index) => {
            const progress = Math.round((item.completedCount / item.totalCount) * 100);
            const isExpanded = expandedRoadmapId === item.id;
            const detailId = `${item.id}-details`;

            return (
              <article
                className={`about-roadmap-card ${isExpanded ? "is-expanded" : ""}`}
                key={item.id}
              >
                <button
                  type="button"
                  className="about-roadmap-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                  onClick={() =>
                    setExpandedRoadmapId((current) => (current === item.id ? null : item.id))
                  }
                >
                  <div
                    className={`about-roadmap-face about-roadmap-front ${
                      isExpanded ? "is-hidden" : "is-visible"
                    }`}
                    aria-hidden={isExpanded}
                  >
                    <div className="about-roadmap-card-top">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <small>{item.phase}</small>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <div
                      className="about-roadmap-progress"
                      aria-label={`${item.title} progress ${progress}%`}
                    >
                      <div className="about-roadmap-progress-label">
                        <strong>{progress === 100 ? "Done" : `${progress}% complete`}</strong>
                        <span>{progress === 100 ? "Implemented" : "In progress"}</span>
                      </div>
                      <div className="about-roadmap-progress-track" aria-hidden="true">
                        <div
                          className="about-roadmap-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <span className="about-roadmap-affordance">View details</span>
                  </div>

                  <div
                    id={detailId}
                    className={`about-roadmap-face about-roadmap-back ${
                      isExpanded ? "is-visible" : "is-hidden"
                    }`}
                    aria-hidden={!isExpanded}
                  >
                    <div className="about-roadmap-card-top">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <small>{item.phase}</small>
                    </div>
                    <div className="about-roadmap-basis">
                      <strong>Progress basis</strong>
                      <p>{`${item.completedCount} of ${item.totalCount} tasks complete`}</p>
                    </div>
                    <div className="about-roadmap-detail-group">
                      <strong>Completed</strong>
                      <ul className="about-roadmap-detail-list">
                        {item.completed.map((entry) => (
                          <li key={entry}>
                            <span
                              className="about-roadmap-item-icon about-roadmap-item-icon-complete"
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                            <span>{entry}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-roadmap-detail-group">
                      <strong>Outstanding</strong>
                      <ul className="about-roadmap-detail-list">
                        {item.outstanding.map((entry) => (
                          <li key={entry}>
                            <span
                              className="about-roadmap-item-icon about-roadmap-item-icon-outstanding"
                              aria-hidden="true"
                            >
                              ○
                            </span>
                            <span>{entry}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <span className="about-roadmap-affordance">Back to overview</span>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="about-founder-section" id="about-founder" aria-labelledby="why-title">
        <article className="about-founder-story">
          <p className="eyebrow">Founder perspective</p>
          <h2 id="why-title">Why I’m Building This</h2>
          <blockquote>
            “I’m building ArtifactHub because project professionals spend too much
            time recreating documents, reconciling disconnected information, and
            translating the same project context into different formats.”
          </blockquote>
          <p>
            Through firsthand work in project delivery, business analysis,
            transformation, and AI-enabled productivity, I have seen how much
            valuable practitioner time is lost to repetitive documentation. I want
            ArtifactHub to make that work more structured, more reusable, and more
            focused on delivery decisions rather than document mechanics.
          </p>
          <p className="about-signature"><span className="about-no-break">Prashant</span></p>
        </article>
        <article className="about-founder-card" aria-labelledby="founder-title">
          <div className="about-founder-avatar">
            <img
              src="/images/founder/prashant-vasudeva-founder-headshot.png"
              alt="Portrait of Prashant"
            />
          </div>
          <div className="about-founder-copy">
            <p className="eyebrow">Founder</p>
            <h2 id="founder-title">About <span className="about-no-break">Prashant</span></h2>
            <p>
              Prashant is a project delivery, technology, and transformation
              professional building ArtifactHub to solve a real practitioner
              problem: turning scattered project knowledge into consistent,
              useful delivery artifacts.
            </p>
            <a
              className="secondary-button"
              href="https://www.linkedin.com/in/prashant-vasudeva-16513713"
              target="_blank"
              rel="noreferrer"
              aria-label="View Prashant Vasudeva on LinkedIn"
            >
              View LinkedIn profile
            </a>
          </div>
        </article>
      </section>

      <section className="about-feedback" id="about-feedback" aria-labelledby="feedback-title">
        <div>
          <p className="eyebrow">Built with your feedback</p>
          <h2 id="feedback-title">Your experience is shaping the product</h2>
          <p>
            Thank you for trying ArtifactHub, reporting bugs, sharing ideas, and
            showing where the workflow can be clearer. That participation directly
            informs what gets improved and what belongs on the roadmap.
          </p>
        </div>
        <aside className="about-contact-card" aria-label="Contact ArtifactHub">
          <span>Questions, ideas, or feedback?</span>
          <a href="mailto:artifacthub@grafley.com">artifacthub@grafley.com</a>
          <small>Every thoughtful note helps improve the next iteration.</small>
        </aside>
      </section>

      <p className="about-closing">
        Built by a practitioner. Improved through feedback. Designed for better
        project delivery.
      </p>
    </main>
  );
}

function GlobalActivityPage() {
  const { user } = useSession();
  const activityQuery = useQuery({
    queryKey: ["global-activity"],
    queryFn: () => api<{ activity: Activity[] }>("/api/activity?limit=50"),
    refetchOnMount: "always",
  });
  const activity = activityQuery.data?.activity || [];
  const groupedActivity = groupActivityByDay(activity);

  return (
    <main className="page-frame activity-page">
      <PageHeading
        eyebrow="Workspace"
        title="Activity"
        description="See what changed across your ArtifactHub workspace."
      />
      <section className="demo-banner">
        <div>
          <strong>Active Demo</strong>
          <span>Activity is a lightweight product feed, not a complete audit trail.</span>
        </div>
        <a href="mailto:artifacthub@grafley.com">Share feedback</a>
      </section>

      {activityQuery.isLoading ? (
        <PanelLoading label="Loading activity..." />
      ) : activityQuery.isError ? (
        <EmptyState
          title="Activity could not be loaded"
          body="Check the server connection and try again."
        />
      ) : activity.length ? (
        <section className="global-activity-feed" aria-label="Workspace activity feed">
          {groupedActivity.map((group) => (
            <article className="surface-panel activity-group" key={group.label}>
              <div className="panel-heading">
                <h2>{group.label}</h2>
              </div>
              <div className="activity-list global-activity-list">
                {group.items.map((item) => (
                  <div key={item.id}>
                    <span className="activity-icon">✓</span>
                    <p>
                      {item.summary}
                      <small>
                        {formatDateTime(item.createdAt)}
                        {item.projectName ? ` · ${item.projectName}` : ""}
                      </small>
                    </p>
                    {item.targetHref && (
                      <Link to={item.targetHref}>
                        {item.targetLabel || "Open"}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="surface-panel activity-empty-panel">
          <div>
            <span className="activity-icon">✓</span>
            <div>
              <h2>Signed in as {user?.name || "ArtifactHub user"}</h2>
              <p>Current session</p>
            </div>
          </div>
          <p>
            Your workspace activity will appear here as you create projects,
            confirm context, draft artifacts, run reviews, approve versions, and
            export documents.
          </p>
          <div className="button-row">
            <Link className="primary-button" to="/projects">Create a project</Link>
            <Link className="secondary-button" to="/library">Browse artifact library</Link>
          </div>
        </section>
      )}
    </main>
  );
}

function groupActivityByDay(activity: Activity[]) {
  const today = new Date().toDateString();
  const groups: { label: string; items: Activity[] }[] = [];
  const byLabel = new Map<string, Activity[]>();

  for (const item of activity) {
    const itemDate = new Date(item.createdAt);
    const label = itemDate.toDateString() === today
      ? "Today"
      : formatDate(item.createdAt);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)?.push(item);
  }

  for (const [label, items] of byLabel) {
    groups.push({ label, items });
  }

  return groups;
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const completed = project.artifacts.length
    ? Math.round(
        project.artifacts.reduce(
          (sum, artifact) => sum + artifact.completeness.percentage,
          0,
        ) / project.artifacts.length,
      )
    : 0;
  const attention = project.artifacts.reduce(
    (sum, artifact) => sum + artifact.openFindings.length,
    0,
  );

  return (
    <article className="project-card">
      <div className="card-topline">
        <span className="status-dot success">Active</span>
        <button className="icon-button" onClick={onDelete} aria-label={`Delete ${project.name}`}>•••</button>
      </div>
      <Link to={`/projects/${project.id}`} className="card-link">
        <h2>{project.name}</h2>
        <p>{project.objective || "Project context needs an objective."}</p>
        <div className="progress-row">
          <div className="progress-track"><span style={{ width: `${completed}%` }} /></div>
          <strong>{completed}%</strong>
        </div>
        <div className="artifact-mini-list">
          {project.artifacts.slice(0, 3).map((artifact) => (
            <span key={artifact.id}>
              <b>{artifact.title}</b>
              <em>{artifact.completeness.percentage}%</em>
            </span>
          ))}
          {!project.artifacts.length && <span>No artifacts started</span>}
        </div>
      </Link>
      <div className="card-action">
        <span className={attention ? "attention-text" : "success-text"}>
          {attention ? `${attention} review item${attention === 1 ? "" : "s"}` : "No blockers"}
        </span>
        <Link className="secondary-button compact-button" to={`/projects/${project.id}`}>
          Open project
        </Link>
      </div>
    </article>
  );
}

function ProjectWorkspaceShell() {
  const { projectId = "" } = useParams();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  });

  if (projectQuery.isLoading) return <FullPageLoading />;
  if (!projectQuery.data) return <Navigate to="/projects" replace />;

  const project = projectQuery.data;
  return (
    <Outlet context={{ project }} />
  );
}

function useProject() {
  const { projectId = "" } = useParams();
  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  });
  return { projectId, project: query.data, query };
}

function ProjectOverviewPage() {
  const { projectId, project } = useProject();
  const activityQuery = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () =>
      api<{ activity: Activity[] }>(`/api/projects/${projectId}/activity`),
  });
  const recommendationQuery = useQuery({
    queryKey: ["recommendation", projectId],
    queryFn: () =>
      api<{ recommendation: Recommendation }>(
        `/api/projects/${projectId}/recommendation`,
      ),
  });
  const contextQuery = useQuery({
    queryKey: ["context", projectId],
    queryFn: () =>
      api<{
        items: ContextItem[];
        completeness: { percentage: number; missingKeys: string[] };
      }>(`/api/projects/${projectId}/context`),
  });

  if (!project) return <PanelLoading label="Loading workspace..." />;
  const overall = project.artifacts.length
    ? Math.round(
        project.artifacts.reduce(
          (sum, artifact) => sum + artifact.completeness.percentage,
          0,
        ) / project.artifacts.length,
      )
    : 0;
  const attention = project.artifacts.reduce(
    (sum, artifact) => sum + artifact.openFindings.length,
    0,
  );

  return (
    <main className="page-frame project-overview">
      <PageHeading
        eyebrow="Project workspace"
        title={project.name}
        description={project.objective || "Confirm the project objective in reusable context."}
        action={<Link className="primary-button" to="/library">+ Create artifact</Link>}
      />
      <section className="metric-strip">
        <Metric label="Overall progress" value={`${overall}%`} tone="teal" />
        <Metric label="Artifacts" value={project.artifacts.length} tone="blue" />
        <Metric label="Items need attention" value={attention} tone="amber" />
        <Metric label="Context complete" value={`${contextQuery.data?.completeness.percentage || 0}%`} tone="teal" />
      </section>
      {recommendationQuery.data && (
        <section className="recommendation-banner">
          <span className="recommendation-icon">◎</span>
          <div>
            <p className="eyebrow">Recommended next step</p>
            <h2>{recommendationQuery.data.recommendation.title}</h2>
          </div>
          <Link className="primary-button" to={recommendationQuery.data.recommendation.href}>
            {recommendationQuery.data.recommendation.action}
          </Link>
        </section>
      )}
      <section className="section-heading">
        <div>
          <h2>Artifacts</h2>
          <p>Create, review, and export the core documents for this project.</p>
        </div>
        <Link className="secondary-button" to="/library">Browse library</Link>
      </section>
      <section className="artifact-card-grid">
        {project.artifacts.map((artifact) => (
          <ArtifactCard projectId={project.id} artifact={artifact} key={artifact.id} />
        ))}
        {!project.artifacts.length && (
          <EmptyState
            title="No artifacts yet"
            body="Start with the Project Charter to establish the flagship project narrative."
            action={<Link className="primary-button" to="/library">Choose an artifact</Link>}
          />
        )}
      </section>
      <section className="overview-bottom-grid">
        <article className="surface-panel">
          <div className="panel-heading">
            <div>
              <h3>Reusable project context</h3>
              <p>Confirmed context improves drafting and review.</p>
            </div>
            <Link to={`/projects/${project.id}/context`}>Review context</Link>
          </div>
          <div className="context-summary">
            {(contextQuery.data?.items || []).slice(0, 8).map((item) => (
              <div key={item.id}>
                <span>{item.label}</span>
                <StatusBadge status={item.trustState} />
              </div>
            ))}
            {!contextQuery.data?.items.length && <p>No reusable context saved.</p>}
          </div>
        </article>
        <article className="surface-panel">
          <div className="panel-heading"><h3>Recent activity</h3></div>
          <div className="activity-list">
            {(activityQuery.data?.activity || []).slice(0, 6).map((item) => (
              <div key={item.id}>
                <span className="activity-icon">✓</span>
                <p>{item.summary}<small>{formatDateTime(item.createdAt)}</small></p>
              </div>
            ))}
            {!activityQuery.data?.activity.length && <p>No activity recorded yet.</p>}
          </div>
        </article>
      </section>
    </main>
  );
}

function ArtifactCard({ projectId, artifact }: { projectId: string; artifact: Artifact }) {
  const action =
    artifact.status === "approved"
      ? "View approved"
      : artifact.openFindings.length
        ? "Continue review"
        : "Continue drafting";
  const href =
    artifact.openFindings.length
      ? `/projects/${projectId}/artifacts/${artifact.id}/review`
      : `/projects/${projectId}/artifacts/${artifact.id}`;
  return (
    <article className="artifact-card">
      <div className="artifact-card-title">
        <span className="document-icon">▤</span>
        <div><h3>{artifact.title}</h3><StatusBadge status={artifact.status} /></div>
        <strong>{artifact.completeness.percentage}%</strong>
      </div>
      <p>
        {artifact.completeness.completed} of {artifact.completeness.total} required
        sections complete.
      </p>
      <div className="artifact-health">
        <span className={artifact.openFindings.length ? "attention-text" : "success-text"}>
          {artifact.openFindings.length
            ? `${artifact.openFindings.length} review item${artifact.openFindings.length === 1 ? "" : "s"}`
            : "Ready to continue"}
        </span>
      </div>
      <Link className="secondary-button wide-button" to={href}>{action}</Link>
    </article>
  );
}

const contextDefinitions = [
  ["project-basics", "project-name", "Project name"],
  ["objectives-outcomes", "objective", "Primary business objective"],
  ["project-basics", "sponsor", "Project sponsor"],
  ["scope-constraints", "scope", "Scope boundaries"],
  ["team-stakeholders", "stakeholders", "Key stakeholders"],
  ["scope-constraints", "constraints", "Delivery constraints"],
  ["objectives-outcomes", "success-metrics", "Success metrics"],
] as const;

function ProjectContextPage() {
  const { projectId, project } = useProject();
  const queryClient = useQueryClient();
  const contextQuery = useQuery({
    queryKey: ["context", projectId],
    queryFn: () =>
      api<{
        items: ContextItem[];
        completeness: { percentage: number; completed: number; total: number };
      }>(`/api/projects/${projectId}/context`),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!contextQuery.data) return;
    setValues(
      Object.fromEntries(
        contextQuery.data.items.map((item) => [
          item.key,
          typeof item.value === "string"
            ? item.value
            : JSON.stringify(item.value ?? ""),
        ]),
      ),
    );
  }, [contextQuery.data]);

  async function saveContext() {
    const existing = new Map(
      (contextQuery.data?.items || []).map((item) => [item.key, item]),
    );
    const response = await api<{
      items: ContextItem[];
      completeness: { percentage: number };
    }>(`/api/projects/${projectId}/context`, {
      method: "PATCH",
      json: {
        items: contextDefinitions.map(([category, key, label]) => ({
          ...existing.get(key),
          category,
          key,
          label,
          value: values[key] || "",
          trustState: values[key]?.trim() ? "confirmed" : "proposed",
          sourceType: "user",
        })),
      },
    });
    queryClient.setQueryData(["context", projectId], response);
    await queryClient.invalidateQueries({ queryKey: ["recommendation", projectId] });
    setSaved("Saved just now");
  }

  async function changeTrust(item: ContextItem, action: "confirm" | "reject") {
    await api(`/api/projects/${projectId}/context/${item.id}/${action}`, {
      method: "POST",
    });
    await queryClient.invalidateQueries({ queryKey: ["context", projectId] });
  }

  if (!project || contextQuery.isLoading) return <PanelLoading label="Loading project context..." />;
  const items = contextQuery.data?.items || [];
  const proposed = items.filter((item) => item.trustState === "proposed");

  return (
    <main className="page-frame with-guide">
      <div className="main-column">
        <PageHeading
          eyebrow="Reusable knowledge"
          title="Project Context"
          description="Review the shared information ArtifactHub can use across drafting, recommendations, and artifact review."
          action={<button className="primary-button" onClick={saveContext}>Save context</button>}
        />
        <section className="metric-grid compact-metrics">
          <Metric label="Context completeness" value={`${contextQuery.data?.completeness.percentage || 0}%`} tone="teal" />
          <Metric label="Confirmed fields" value={items.filter((item) => item.trustState === "confirmed").length} tone="green" />
          <Metric label="Fields need review" value={proposed.length} tone="amber" />
        </section>
        {proposed.length > 0 && (
          <section className="review-callout">
            <h3>Recommended context updates</h3>
            {proposed.map((item) => (
              <div key={item.id} className="review-context-row">
                <div><strong>{item.label}</strong><span>{String(item.value || "No value supplied")}</span></div>
                <button onClick={() => changeTrust(item, "confirm")}>Confirm</button>
                <button onClick={() => changeTrust(item, "reject")}>Reject</button>
              </div>
            ))}
          </section>
        )}
        <section className="context-form-grid">
          {contextDefinitions.map(([category, key, label]) => {
            const item = items.find((candidate) => candidate.key === key);
            return (
              <label className="context-field" key={key}>
                <span>{label}<StatusBadge status={item?.trustState || "proposed"} /></span>
                <textarea
                  rows={key === "project-name" || key === "sponsor" ? 2 : 5}
                  value={values[key] || ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                  placeholder={`Add ${label.toLowerCase()}`}
                />
                <small>{category.replace("-", " ")} · {item?.sourceType || "user"}</small>
              </label>
            );
          })}
        </section>
        {saved && <p className="save-status success-text">✓ {saved}</p>}
      </div>
      <GuidePanel
        title="Strengthen reusable context"
        body={
          proposed.length
            ? `${proposed.length} proposed field${proposed.length === 1 ? "" : "s"} need confirmation before AI can reuse them.`
            : "Confirmed context is ready to support the Project Charter."
        }
        action={
          proposed.length ? (
            <button className="primary-button" onClick={() => changeTrust(proposed[0], "confirm")}>
              Confirm next field
            </button>
          ) : (
            <Link className="primary-button" to="/library">Start an artifact</Link>
          )
        }
        contextNote="Only confirmed project context is included in AI prompts."
      />
    </main>
  );
}

type LibraryShellContext = {
  filter: string;
  stageGroups: LibraryStage[];
  filteredTemplates: Template[];
  activeStage: LibraryStage | null;
  selected: Template | null;
  setSelected: (template: Template | null) => void;
  templatesLoading: boolean;
};

type LibraryStage = {
  key: string;
  name: string;
  order: number;
  useWhen: string;
  templates: Template[];
};

function LibraryShell() {
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogExpanded, setCatalogExpanded] = useState(true);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Template | null>(null);
  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<Template[]>("/api/templates"),
  });
  const draftsQuery = useQuery({
    queryKey: ["artifacts", "unassigned"],
    queryFn: () => api<{ artifacts: Artifact[] }>("/api/artifacts?scope=unassigned"),
  });
  const templates = [...(templatesQuery.data || [])].sort(
    (left, right) =>
      left.stageOrder - right.stageOrder ||
      left.title.localeCompare(right.title),
  );
  const stageGroups = Array.from(
    templates
      .reduce((groups, template) => {
        const existing = groups.get(template.stageKey);
        const group =
          existing ||
          {
            key: template.stageKey,
            name: template.stageName,
            order: template.stageOrder,
            useWhen: template.stageUseWhen,
            templates: [],
          };
        group.templates.push(template);
        groups.set(template.stageKey, group);
        return groups;
      }, new Map<string, LibraryStage>())
      .values(),
  ).sort((left, right) => left.order - right.order);
  const normalizedTemplateSearch = searchTerm.trim().toLowerCase();
  const visibleStageGroups = stageGroups
    .map((stage) => ({
      ...stage,
      templates: normalizedTemplateSearch
        ? stage.templates.filter((template) =>
            [
              template.title,
              template.role || "",
              stage.name,
              stage.useWhen,
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedTemplateSearch),
          )
        : stage.templates,
    }))
    .filter((stage) => stage.templates.length > 0);
  const hasTemplateSearchResults = visibleStageGroups.length > 0;
  const visibleTemplateCount = visibleStageGroups.reduce(
    (count, stage) => count + stage.templates.length,
    0,
  );
  const shouldShowCatalog = normalizedTemplateSearch ? true : catalogExpanded;
  const activeStage = filter.startsWith("stage:")
    ? stageGroups.find((stage) => stage.key === filter.replace("stage:", "")) || null
    : null;
  const filtered =
    filter === "all"
      ? templates
      : filter === "recommended"
        ? templates.filter((template) => template.recommended)
        : activeStage?.templates || [];

  const drafts = draftsQuery.data?.artifacts || [];
  const isSelectedStage = (stage: LibraryStage) =>
    Boolean(selected && stage.templates.some((template) => template.id === selected.id));
  const isStageExpanded = (stage: LibraryStage) =>
    normalizedTemplateSearch
      ? true
      : expandedStages[stage.key] ?? isSelectedStage(stage);
  const toggleStage = (stage: LibraryStage) => {
    if (normalizedTemplateSearch) return;
    setExpandedStages((current) => ({
      ...current,
      [stage.key]: !(current[stage.key] ?? isSelectedStage(stage)),
    }));
  };

  return (
    <div className="library-shell">
      <aside className="category-panel library-sidebar">
        <p className="sidebar-section-label">Find templates</p>
        <label className="template-search">
          <input
            aria-label="Search templates"
            placeholder="Search templates..."
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        <div className="sidebar-divider" />
        <section className="catalog-accordion">
          <button
            aria-expanded={shouldShowCatalog}
            aria-label={`Catalog, ${visibleTemplateCount} template${visibleTemplateCount === 1 ? "" : "s"}`}
            className="catalog-nav-heading"
            type="button"
            onClick={() => {
              if (!normalizedTemplateSearch) {
                setCatalogExpanded((current) => !current);
              }
            }}
          >
            <span className="stage-heading-row">
              <strong>Catalog</strong>
              <em className="stage-count">{visibleTemplateCount}</em>
              <span className="stage-toggle-indicator">
                {normalizedTemplateSearch ? "Matches" : shouldShowCatalog ? "Hide" : "Show"}
              </span>
            </span>
          </button>
          {shouldShowCatalog && (
            <nav className="stage-nav" aria-label="Artifact stages">
              {visibleStageGroups.map((stage) => {
                const expanded = isStageExpanded(stage);

                return (
                  <section className="stage-nav-group" key={stage.key}>
                    <button
                      aria-expanded={expanded}
                      className={`stage-nav-heading ${filter === `stage:${stage.key}` ? "active" : ""}`}
                      aria-label={`${stage.name}, ${stage.templates.length} template${stage.templates.length === 1 ? "" : "s"}`}
                      type="button"
                      onClick={() => toggleStage(stage)}
                    >
                      <span className="stage-heading-row">
                        <strong>{stage.name}</strong>
                        <em className="stage-count">{stage.templates.length}</em>
                        <span className="stage-toggle-indicator">
                          {normalizedTemplateSearch ? "Matches" : expanded ? "Hide" : "Show"}
                        </span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="stage-template-links">
                        {stage.templates.map((template) => (
                          <button
                            key={template.id}
                            className={`artifact-template-row ${selected?.id === template.id ? "active" : ""}`}
                            type="button"
                            onClick={() => {
                              setFilter(`stage:${stage.key}`);
                              setSelected(template);
                            }}
                          >
                            <span className="artifact-template-title">{template.title}</span>
                            <span className="artifact-template-role">
                              {template.role || template.category || template.sourceName}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {normalizedTemplateSearch && !hasTemplateSearchResults && (
                <p className="template-search-empty">
                  No templates found. Try a different search term.
                </p>
              )}
            </nav>
          )}
        </section>
        <div className="sidebar-divider" />
        <p className="sidebar-section-label">Unassigned drafts</p>
        <nav className="draft-nav" aria-label="Unassigned drafts">
          {drafts.map((artifact) => (
            <NavLink key={artifact.id} to={`/library/artifacts/${artifact.id}`}>
              <span>{artifact.title}</span>
              <em>{formatDateTime(artifact.updatedAt)}</em>
            </NavLink>
          ))}
          {!draftsQuery.isLoading && drafts.length === 0 && (
            <small>No unassigned drafts.</small>
          )}
          {draftsQuery.isLoading && <small>Loading drafts...</small>}
        </nav>
      </aside>
      <div className="library-content">
        <Outlet
          context={{
            filter,
            stageGroups,
            filteredTemplates: filtered,
            activeStage,
            selected,
            setSelected,
            templatesLoading: templatesQuery.isLoading,
          }}
        />
      </div>
    </div>
  );
}

function useLibraryShell() {
  return useOutletContext<LibraryShellContext>();
}

function ArtifactLibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    filter,
    stageGroups,
    filteredTemplates,
    activeStage,
    selected,
    setSelected,
    templatesLoading,
  } = useLibraryShell();

  async function startDraft(template: Template) {
    const artifact = await api<Artifact>(
      "/api/artifacts",
      {
        method: "POST",
        json: {
          templateId: template.id,
          title: template.title,
          fieldValues: {},
        },
      },
    );
    await queryClient.invalidateQueries({ queryKey: ["artifacts", "unassigned"] });
    navigate(`/library/artifacts/${artifact.id}`);
  }

  const groupedView = filter === "all";
  const catalogHeading =
    filter === "recommended"
      ? {
          title: "Recommended templates",
          body: "Editorially highlighted templates for getting started quickly.",
        }
      : activeStage
        ? {
            title: `${activeStage.order}. ${activeStage.name}`,
            body: activeStage.useWhen,
          }
        : {
            title: "All templates by stage",
            body: "Browse the full catalog in the order these artifacts usually become useful.",
          };
  const renderTemplateCard = (template: Template) => (
    <article
      key={template.id}
      className={`template-card ${selected?.id === template.id ? "selected" : ""}`}
    >
      <div className="card-topline">
        <span className="eyebrow">{template.stageOrder}. {template.stageName}</span>
        {template.recommended && <StatusBadge status="recommended" />}
      </div>
      <button className="template-card-main" onClick={() => setSelected(template)}>
        <h3>{template.title}</h3>
        <p>{template.description}</p>
        <small>
          {template.fields.length} structured sections · {template.sourceStandard || "Standardized source"}
        </small>
      </button>
      <button className="secondary-button wide-button" onClick={() => startDraft(template)}>
        Start draft
      </button>
    </article>
  );

  return (
    <main className="page-frame library-page">
      <PageHeading
        eyebrow="Standards-backed catalog"
        title="Artifact Library"
        description="Browse standardized project-delivery templates, start a private draft, and assign it to a project when the work is ready for project context."
      />
      <div className="library-catalog-layout">
        <section className="template-stage-list">
          <div className="catalog-section-heading">
            <div>
              <h2>{catalogHeading.title}</h2>
              <p>{catalogHeading.body}</p>
            </div>
          </div>
          {templatesLoading && <PanelLoading label="Loading artifact library..." />}
          {groupedView
            ? stageGroups.map((stage) => (
                <section className="template-stage-band" key={stage.key}>
                  <header>
                    <div>
                      <h3>{stage.order}. {stage.name}</h3>
                      <p>{stage.useWhen}</p>
                    </div>
                    <span>{stage.templates.length} template{stage.templates.length === 1 ? "" : "s"}</span>
                  </header>
                  <div className="template-grid">
                    {stage.templates.map(renderTemplateCard)}
                  </div>
                </section>
              ))
            : (
                <div className="template-grid">
                  {filteredTemplates.map(renderTemplateCard)}
                </div>
              )}
          {!templatesLoading && filteredTemplates.length === 0 && (
            <EmptyState
              title="No templates match this filter"
              body="Choose a different library view or project stage."
            />
          )}
        </section>
        <aside className="template-detail">
          {selected ? (
            <>
              <p className="eyebrow">{selected.sourceStandard || selected.category}</p>
              <h2>{selected.title}</h2>
              <p>{selected.description}</p>
              <div className="info-note">
                <strong>{selected.sourceName || "Standardized template"}</strong>
                <span>{selected.sourceNotes || "Use this as a starting point and tailor it to the work."}</span>
              </div>
              <h3>Sections included</h3>
              <ul>{selected.fields.map((field) => <li key={field.id}>{field.label}</li>)}</ul>
              <button className="primary-button wide-button" onClick={() => startDraft(selected)}>
                Start {selected.title}
              </button>
            </>
          ) : (
            <EmptyState title="Select a template" body="Review its purpose, source basis, and sections before starting a draft." />
          )}
        </aside>
      </div>
    </main>
  );
}

function ArtifactEditorPage() {
  const { projectId, artifactId = "" } = useParams();
  const isProjectArtifact = Boolean(projectId);
  const { features } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
    enabled: isProjectArtifact,
  });
  const artifactQuery = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: () => api<Artifact>(`/api/artifacts/${artifactId}`),
    enabled: !isProjectArtifact && Boolean(artifactId),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
    enabled: !isProjectArtifact,
  });
  const artifact = isProjectArtifact
    ? projectQuery.data?.artifacts.find((item) => item.id === artifactId)
    : artifactQuery.data;
  const templateQuery = useQuery({
    queryKey: ["template", artifact?.templateId, artifact?.templateVersion],
    enabled: Boolean(artifact),
    queryFn: () =>
      api<Template>(
        `/api/templates/${artifact!.templateId}?version=${artifact!.templateVersion}`,
      ),
  });
  const conversationQuery = useQuery({
    queryKey: ["conversation", projectId, artifactId],
    enabled: features.aiAssistant && isProjectArtifact,
    queryFn: () =>
      api<{ messages: Message[] }>(
        `/api/projects/${projectId}/artifacts/${artifactId}/conversation`,
      ),
  });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState("Saved");
  const [dirty, setDirty] = useState(false);
  const [initializedArtifactId, setInitializedArtifactId] = useState("");
  const [conflict, setConflict] = useState<Artifact | null>(null);
  const [guideInput, setGuideInput] = useState("");
  const [guideMessage, setGuideMessage] = useState("");
  const [guideMessageTone, setGuideMessageTone] = useState<"error" | "success" | "info">("info");
  const [guidePending, setGuidePending] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<FieldUpdate[]>([]);
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignMessage, setAssignMessage] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!artifact || initializedArtifactId === artifact.id) return;
    setValues(artifact.fieldValues);
    setInitializedArtifactId(artifact.id);
    setDirty(false);
    setSaveState(`Saved ${formatDateTime(artifact.updatedAt)}`);
  }, [artifact, initializedArtifactId]);

  useEffect(() => {
    if (assignProjectId || !projectsQuery.data?.length) return;
    setAssignProjectId(projectsQuery.data[0].id);
  }, [assignProjectId, projectsQuery.data]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty || !artifact) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveArtifact(), 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [values, dirty, artifact?.revision]);

  async function saveArtifact() {
    if (!artifact) return null;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("Saving...");
    try {
      const updated = await api<Artifact>(
        isProjectArtifact
          ? `/api/projects/${projectId}/artifacts/${artifact.id}`
          : `/api/artifacts/${artifact.id}`,
        {
          method: "PUT",
          json: {
            title: artifact.title,
            status: artifact.status,
            fieldValues: values,
            expectedRevision: artifact.revision,
            workflowStage: artifact.workflowStage,
          },
        },
      );
      if (isProjectArtifact) {
        queryClient.setQueryData<Project>(["project", projectId], (current) =>
          current
            ? {
                ...current,
                artifacts: current.artifacts.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : current,
        );
      } else {
        queryClient.setQueryData(["artifact", artifactId], updated);
      }
      setDirty(false);
      setSaveState(`Saved ${formatDateTime(updated.updatedAt)}`);
      return updated;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.data.latestArtifact
      ) {
        setConflict(error.data.latestArtifact as Artifact);
        setSaveState("Save conflict");
      } else {
        setSaveState("Unable to save. Edits remain on screen.");
      }
      return null;
    }
  }

  function updateField(fieldId: string, value: unknown) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    setDirty(true);
    setSaveState("Unsaved changes");
  }

  async function sendGuideTurn() {
    if (!artifact || !guideInput.trim() || !isProjectArtifact) return;
    setGuidePending(true);
    setGuideMessage("");
    setGuideMessageTone("info");
    try {
      const response = await api<{
        artifact: Artifact;
        pendingUpdates: FieldUpdate[];
      }>(`/api/projects/${projectId}/artifacts/${artifact.id}/assistant/turns`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        json: {
          message: guideInput,
          operation: "interview",
          expectedRevision: artifact.revision,
        },
      });
      setGuideInput("");
      setPendingUpdates(response.pendingUpdates);
      setValues(response.artifact.fieldValues);
      setDirty(false);
      queryClient.setQueryData<Project>(["project", projectId], (current) =>
        current
          ? {
              ...current,
              artifacts: current.artifacts.map((item) =>
                item.id === artifact.id ? response.artifact : item,
              ),
            }
          : current,
      );
      await queryClient.invalidateQueries({
        queryKey: ["conversation", projectId, artifactId],
      });
      if (response.pendingUpdates.length) {
        setGuideMessageTone("success");
        setGuideMessage(
          `${response.pendingUpdates.length} suggested update${
            response.pendingUpdates.length === 1 ? "" : "s"
          } ready for review.`,
        );
      } else {
        setGuideMessageTone("success");
        setGuideMessage(
          "Guide response received. Review the draft updates in the document and continue with the next section.",
        );
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.data.latestArtifact
      ) {
        setConflict(error.data.latestArtifact as Artifact);
        setGuideMessageTone("error");
        setGuideMessage(
          "The artifact changed in another session. Refresh or resolve the conflict before retrying the Guide.",
        );
      } else {
        setGuideMessageTone("error");
        setGuideMessage(
          error instanceof Error
            ? error.message
            : "ArtifactHub Guide could not complete that turn.",
        );
      }
    } finally {
      setGuidePending(false);
    }
  }

  async function acceptPending() {
    if (!artifact || !pendingUpdates.length || !isProjectArtifact) return;
    const updated = await api<Artifact>(
      `/api/projects/${projectId}/artifacts/${artifact.id}/assistant/accept`,
      {
        method: "POST",
        json: {
          expectedRevision: artifact.revision,
          updates: pendingUpdates,
        },
      },
    );
    setPendingUpdates([]);
    setValues(updated.fieldValues);
    queryClient.setQueryData<Project>(["project", projectId], (current) =>
      current
        ? { ...current, artifacts: current.artifacts.map((item) => item.id === updated.id ? updated : item) }
        : current,
    );
  }

  async function assignToProject(targetProjectId: string) {
    if (!artifact || !targetProjectId) return;
    setAssignMessage("");
    const saved = dirty ? await saveArtifact() : artifact;
    if (!saved) {
      setAssignMessage("Save the draft before assigning it to a project.");
      return;
    }
    try {
      const response = await api<{ artifact: Artifact }>(
        `/api/artifacts/${artifact.id}/assign`,
        {
          method: "POST",
          json: { projectId: targetProjectId },
        },
      );
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["artifacts", "unassigned"] });
      await queryClient.invalidateQueries({ queryKey: ["project", targetProjectId] });
      navigate(`/projects/${targetProjectId}/artifacts/${response.artifact.id}`);
    } catch (error) {
      setAssignMessage(error instanceof Error ? error.message : "Unable to assign draft.");
    }
  }

  async function createProjectAndAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const project = await api<Project>("/api/projects", {
      method: "POST",
      json: {
        name: form.get("name"),
        sponsor: form.get("sponsor"),
        objective: form.get("objective"),
      },
    });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    await assignToProject(project.id);
  }

  if (!artifact || !templateQuery.data) return <PanelLoading label="Opening artifact..." />;
  const template = templateQuery.data;
  const projects = projectsQuery.data || [];

  return (
    <main className="editor-page">
      <header className="editor-toolbar">
        <div>
          <p className="eyebrow">
            {isProjectArtifact
              ? projectQuery.data?.name
              : artifact.projectName || "Unassigned draft"}
          </p>
          <h1>{artifact.title}</h1>
        </div>
        <div className="editor-actions">
          <span className={`save-state ${saveState.includes("Unable") || saveState.includes("conflict") ? "error-text" : ""}`}>✓ {saveState}</span>
          <ProgressRing value={artifact.completeness.percentage} />
          {isProjectArtifact ? (
            <>
              <Link className="secondary-button" to={`/projects/${projectId}/artifacts/${artifact.id}/review`}>Review mode</Link>
              <Link className="primary-button" to={`/projects/${projectId}/artifacts/${artifact.id}/export`}>Export</Link>
            </>
          ) : (
            <a className="primary-button" href={`/api/artifacts/${artifact.id}/export.md`}>Export draft</a>
          )}
        </div>
      </header>
      <div className="editor-layout">
        <section className="document-surface">
          {template.fields.map((field, index) => (
            <article className="document-section" key={field.id}>
              <div className="section-number">{index + 1}</div>
              <div className="section-body">
                <div className="document-section-heading">
                  <h2>{field.section || field.label}</h2>
                  <StatusBadge
                    status={
                      artifact.completeness.missingFieldIds.includes(field.id)
                        ? "incomplete"
                        : artifact.provenance[field.id]?.sourceType || "confirmed"
                    }
                  />
                </div>
                <FieldEditor
                  field={field}
                  value={values[field.id]}
                  onChange={(value) => updateField(field.id, value)}
                />
              </div>
            </article>
          ))}
        </section>
        <aside className="guide-panel editor-guide">
          <div className="guide-heading">
            <div><p className="eyebrow">ArtifactHub Guide</p><h2>Current focus</h2></div>
          </div>
          {isProjectArtifact ? (
            features.aiAssistant ? (
            <>
              <div className="guide-focus">
                <span className="recommendation-icon">◎</span>
                <h3>
                  {artifact.completeness.missingFieldIds.length
                    ? `Complete ${template.fields.find((field) => field.id === artifact.completeness.missingFieldIds[0])?.label}`
                    : "Prepare for review"}
                </h3>
                <p>
                  Answer in plain language. Suggested updates appear in the document
                  without replacing your confirmed wording.
                </p>
              </div>
              <div className="conversation-history">
                {(conversationQuery.data?.messages || []).slice(-6).map((message) => (
                  <div className={`message ${message.role}`} key={message.id}>
                    <strong>{message.role === "assistant" ? "Guide" : "You"}</strong>
                    <p>{message.content}</p>
                  </div>
                ))}
              </div>
              {pendingUpdates.length > 0 && (
                <div className="pending-update">
                  <strong>{pendingUpdates.length} update requires acceptance</strong>
                  <p>Your existing wording will not be replaced automatically.</p>
                  <button className="primary-button" onClick={acceptPending}>Accept suggested update</button>
                </div>
              )}
              <label className="guide-composer">
                <span>Answer the Guide</span>
                <textarea
                  rows={4}
                  maxLength={8000}
                  value={guideInput}
                  disabled={guidePending}
                  onChange={(event) => {
                    setGuideInput(event.target.value);
                    if (guideMessage) {
                      setGuideMessage("");
                      setGuideMessageTone("info");
                    }
                  }}
                  placeholder="Add project detail or ask for help refining a section."
                />
                <button
                  className="primary-button"
                  disabled={guidePending || !guideInput.trim()}
                  onClick={sendGuideTurn}
                >
                  {guidePending ? "Sending..." : "Send to Guide"}
                </button>
              </label>
              {guidePending && (
                <div className="guide-status guide-status-info">
                  <strong>Guide is working</strong>
                  <p>Sending your request and preparing the next recommended update.</p>
                </div>
              )}
              {guideMessage && (
                <div
                  className={`guide-status ${
                    guideMessageTone === "success"
                      ? "guide-status-success"
                      : guideMessageTone === "error"
                        ? "guide-status-error"
                        : "guide-status-info"
                  }`}
                >
                  <strong>
                    {guideMessageTone === "success"
                      ? "Guide updated the draft"
                      : guideMessageTone === "error"
                        ? "Guide needs attention"
                        : "Guide status"}
                  </strong>
                  <p>{guideMessage}</p>
                </div>
              )}
            </>
            ) : (
            <div className="guide-focus">
              <span className="recommendation-icon">◎</span>
              <h3>AI guidance is beta-gated</h3>
              <p>
                Manual editing, completeness, review, approval, and export remain
                available. Ask an administrator to add this account to the beta allowlist.
              </p>
            </div>
            )
          ) : (
            <div className="guide-focus">
              <span className="recommendation-icon">◎</span>
              <h3>Assign when project context is needed</h3>
              <p>
                This draft is private and unassigned. You can keep editing it
                here, export a draft, or assign it to a project when you want
                reusable project context and review workflow.
              </p>
              {projects.length > 0 && (
                <label className="guide-composer compact">
                  <span>Existing project</span>
                  <select
                    value={assignProjectId}
                    onChange={(event) => setAssignProjectId(event.target.value)}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-button"
                    onClick={() => assignToProject(assignProjectId)}
                  >
                    Assign to project
                  </button>
                </label>
              )}
              {projects.length > 0 && (
                <button
                  type="button"
                  className="secondary-button wide-button"
                  onClick={() => setCreatingProject((current) => !current)}
                >
                  {creatingProject ? "Use existing project" : "Create new project"}
                </button>
              )}
              {(creatingProject || !projects.length) && (
                <form className="stack-form compact" onSubmit={createProjectAndAssign}>
                  <label>
                    Project name
                    <input name="name" required />
                  </label>
                  <label>
                    Sponsor
                    <input name="sponsor" />
                  </label>
                  <label>
                    Objective
                    <textarea name="objective" rows={3} />
                  </label>
                  <button className="primary-button">Create and assign</button>
                </form>
              )}
              {assignMessage && <p className="form-message">{assignMessage}</p>}
            </div>
          )}
          <div className="info-note">
            {isProjectArtifact
              ? "Using confirmed project context only."
              : "Project context is unavailable until this draft is assigned."}
          </div>
        </aside>
      </div>
      {conflict && (
        <div className="dialog-backdrop">
          <section className="dialog-card">
            <p className="eyebrow">Save conflict</p>
            <h2>This artifact changed in another session.</h2>
            <p>Your unsaved content is still on screen. Reload the latest saved version or keep your content for manual reconciliation.</p>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => {
                  setValues(conflict.fieldValues);
                  if (isProjectArtifact) {
                    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
                  } else {
                    queryClient.invalidateQueries({ queryKey: ["artifact", artifactId] });
                  }
                  setConflict(null);
                  setDirty(false);
                }}
              >
                Reload latest
              </button>
              <button className="secondary-button" onClick={() => setConflict(null)}>Keep my edits</button>
            </div>
          </section>
        </div>
      )}
      {blocker.state === "blocked" && (
        <div className="dialog-backdrop">
          <section className="dialog-card">
            <p className="eyebrow">Unsaved changes</p>
            <h2>Leave this artifact?</h2>
            <p>Your latest edits have not finished saving.</p>
            <div className="button-row">
              <button className="danger-button" onClick={() => blocker.proceed()}>Discard and leave</button>
              <button className="secondary-button" onClick={() => blocker.reset()}>Stay here</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === "list") {
    const items = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [""];
    return (
      <div className="repeatable-list">
        {items.map((item, index) => (
          <div key={index}>
            <span>•</span>
            <input
              value={item}
              placeholder={field.placeholder}
              onChange={(event) => {
                const next = [...items];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            {items.length > 1 && (
              <button onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>×</button>
            )}
          </div>
        ))}
        <button className="inline-link" onClick={() => onChange([...items, ""])}>+ Add item</button>
      </div>
    );
  }

  if (field.type === "scope") {
    const scope =
      value && typeof value === "object"
        ? (value as { inScope?: string[]; outOfScope?: string[] })
        : { inScope: [], outOfScope: [] };
    return (
      <div className="scope-grid">
        <label>
          In scope
          <textarea
            rows={6}
            value={(scope.inScope || []).join("\n")}
            onChange={(event) =>
              onChange({ ...scope, inScope: event.target.value.split("\n").filter(Boolean) })
            }
          />
        </label>
        <label>
          Out of scope
          <textarea
            rows={6}
            value={(scope.outOfScope || []).join("\n")}
            onChange={(event) =>
              onChange({ ...scope, outOfScope: event.target.value.split("\n").filter(Boolean) })
            }
          />
        </label>
      </div>
    );
  }

  if (field.type === "table") {
    const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [];
    const columns = field.columns || [];
    return (
      <div className="table-editor">
        <div className="table-row table-header">
          {columns.map((column) => <strong key={column}>{humanize(column)}</strong>)}
          <span />
        </div>
        {rows.map((row, rowIndex) => (
          <div className="table-row" key={rowIndex}>
            {columns.map((column) => (
              <input
                key={column}
                value={row[column] || ""}
                onChange={(event) => {
                  const next = rows.map((candidate, index) =>
                    index === rowIndex ? { ...candidate, [column]: event.target.value } : candidate,
                  );
                  onChange(next);
                }}
              />
            ))}
            <button onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}>×</button>
          </div>
        ))}
        <button
          className="inline-link"
          onClick={() =>
            onChange([...rows, Object.fromEntries(columns.map((column) => [column, ""]))])
          }
        >
          + Add row
        </button>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        className="document-textarea"
        rows={7}
        value={String(value || "")}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className="document-input"
      type={field.type}
      value={String(value || "")}
      placeholder={field.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ArtifactReviewPage() {
  const { projectId = "", artifactId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  });
  const artifact = projectQuery.data?.artifacts.find((item) => item.id === artifactId);
  const templateQuery = useQuery({
    queryKey: ["template", artifact?.templateId],
    enabled: Boolean(artifact),
    queryFn: () => api<Template>(`/api/templates/${artifact!.templateId}?version=${artifact!.templateVersion}`),
  });
  const [findings, setFindings] = useState<Finding[]>(artifact?.openFindings || []);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (artifact) setFindings(artifact.openFindings);
  }, [artifact]);

  async function runReview() {
    const response = await api<{ findings: Finding[] }>(
      `/api/projects/${projectId}/artifacts/${artifactId}/review`,
      { method: "POST" },
    );
    setFindings(response.findings);
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  async function setFindingStatus(finding: Finding, status: "resolved" | "dismissed") {
    await api(
      `/api/projects/${projectId}/artifacts/${artifactId}/findings/${finding.id}`,
      { method: "PATCH", json: { status } },
    );
    setFindings((current) => current.map((item) => item.id === finding.id ? { ...item, status } : item));
  }

  async function approve() {
    try {
      await api(`/api/projects/${projectId}/artifacts/${artifactId}/approve`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      navigate(`/projects/${projectId}/artifacts/${artifactId}/export`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval is blocked.");
    }
  }

  if (!artifact || !templateQuery.data) return <PanelLoading label="Preparing review..." />;
  const open = findings.filter((finding) => finding.status === "open");
  const blockers = open.filter((finding) => finding.severity === "blocking");
  const missingFieldIds = new Set(artifact.completeness.missingFieldIds);
  const findingFieldIds = new Set(
    open.map((finding) => finding.fieldId).filter(Boolean),
  );
  const missingWithoutFinding = templateQuery.data.fields.filter(
    (field) => missingFieldIds.has(field.id) && !findingFieldIds.has(field.id),
  );
  const blockerCount = blockers.length + missingWithoutFinding.length;
  const attentionCount = open.length + missingWithoutFinding.length;
  const confirmedSectionCount = templateQuery.data.fields.filter(
    (field) => !missingFieldIds.has(field.id) && !findingFieldIds.has(field.id),
  ).length;

  return (
    <main className="editor-page review-page">
      <header className="editor-toolbar">
        <div><p className="eyebrow">Review mode</p><h1>{artifact.title}</h1></div>
        <div className="editor-actions">
          <ProgressRing value={artifact.completeness.percentage} />
          <Link className="secondary-button" to={`/projects/${projectId}/artifacts/${artifactId}`}>Return to editing</Link>
          <button className="primary-button" disabled={blockerCount > 0} onClick={approve}>Approve and export</button>
        </div>
      </header>
      <div className="editor-layout">
        <section className="document-surface review-document">
          {templateQuery.data.fields.map((field, index) => {
            const fieldFindings = open.filter((finding) => finding.fieldId === field.id);
            const isMissing = missingFieldIds.has(field.id);
            return (
              <article className={`document-section ${fieldFindings.length || isMissing ? "flagged" : ""}`} key={field.id}>
                <div className="section-number">{index + 1}</div>
                <div className="section-body">
                  <div className="document-section-heading">
                    <h2>{field.section || field.label}</h2>
                    <StatusBadge status={fieldFindings.length || isMissing ? "needs-review" : "confirmed"} />
                  </div>
                  <ReadOnlyValue value={artifact.fieldValues[field.id]} />
                  {isMissing && !fieldFindings.length && (
                    <div className="inline-finding">
                      <span>{field.label} is required before approval.</span>
                      <Link to={`/projects/${projectId}/artifacts/${artifactId}`}>Add content</Link>
                    </div>
                  )}
                  {fieldFindings.map((finding) => (
                    <div className="inline-finding" key={finding.id}>
                      <span>{finding.message}</span>
                      <button onClick={() => setFindingStatus(finding, "resolved")}>Mark resolved</button>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
        <aside className="guide-panel review-guide">
          <p className="eyebrow">Review summary</p>
          <div className="review-counts">
            <span className="success-text">✓ {confirmedSectionCount} sections confirmed</span>
            <span className="attention-text">○ {attentionCount} items need review</span>
            <span className="error-text">○ {blockerCount} blockers</span>
          </div>
          <div className="panel-divider" />
          <h3>Recommended actions before approval</h3>
          <div className="finding-list">
            {open.map((finding, index) => (
              <article key={finding.id}>
                <span>{index + 1}</span>
                <div><strong>{finding.message}</strong><StatusBadge status={finding.severity} /></div>
                <button onClick={() => setFindingStatus(finding, finding.severity === "blocking" ? "resolved" : "dismissed")}>Resolve</button>
              </article>
            ))}
            {missingWithoutFinding.map((field, index) => (
              <article key={field.id}>
                <span>{open.length + index + 1}</span>
                <div>
                  <strong>{field.label} is required before approval.</strong>
                  <StatusBadge status="blocking" />
                </div>
                <Link to={`/projects/${projectId}/artifacts/${artifactId}`}>Add content</Link>
              </article>
            ))}
            {!attentionCount && <p>No open findings. The artifact is ready for approval.</p>}
          </div>
          <button className="secondary-button wide-button" onClick={runReview}>Run review</button>
          <button className="primary-button wide-button" disabled={blockerCount > 0} onClick={approve}>Approve and export</button>
          {blockerCount > 0 && (
            <p className="form-message">
              Complete required content and resolve blocking findings before approval.
            </p>
          )}
          {message && <p className="form-message error-text">{message}</p>}
        </aside>
      </div>
    </main>
  );
}

function ReadOnlyValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ul className="readonly-list">
        {value.map((item, index) => (
          <li key={index}>
            {item && typeof item === "object"
              ? Object.values(item).filter(Boolean).join(" · ")
              : String(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    return (
      <div className="readonly-object">
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}><strong>{humanize(key)}</strong><ReadOnlyValue value={entry} /></div>
        ))}
      </div>
    );
  }
  return <p className="readonly-copy">{String(value || "Not provided.")}</p>;
}

function ExportPreviewPage() {
  const { projectId = "", artifactId = "" } = useParams();
  const previewQuery = useQuery({
    queryKey: ["export-preview", projectId, artifactId],
    queryFn: () =>
      api<{
        project: Project;
        artifact: Artifact;
        template: Template;
        version: Version | null;
        isDraft: boolean;
      }>(`/api/projects/${projectId}/artifacts/${artifactId}/export-preview`),
  });

  if (!previewQuery.data) return <PanelLoading label="Preparing export preview..." />;
  const { project, artifact, template, version, isDraft } = previewQuery.data;

  return (
    <main className="page-frame export-page">
      <PageHeading
        eyebrow={isDraft ? "Draft export" : `Approved version ${version?.versionNumber}`}
        title={`${artifact.title} Preview`}
        description="Review the selected document snapshot before exporting."
        action={<Link className="secondary-button" to={`/projects/${projectId}/artifacts/${artifactId}`}>Return to editing</Link>}
      />
      <div className="export-layout">
        <aside className="export-outline">
          <div className="artifact-summary-card">
            <span className="document-icon">▤</span>
            <div><strong>{artifact.title}</strong><StatusBadge status={isDraft ? "draft" : "approved"} /></div>
          </div>
          <p className="eyebrow">Document sections</p>
          {template.fields.map((field, index) => <a href={`#export-${field.id}`} key={field.id}>{index + 1}. {field.label}</a>)}
        </aside>
        <article className="paper-preview">
          <header>
            <p className="eyebrow">Project Charter</p>
            <h1>{project.name}</h1>
            <p>{project.objective}</p>
            <dl>
              <div><dt>Prepared by</dt><dd>You</dd></div>
              <div><dt>Sponsor</dt><dd>{project.sponsor || "Not provided"}</dd></div>
              <div><dt>Version</dt><dd>{version?.versionNumber || "Draft"}</dd></div>
              <div><dt>Status</dt><dd>{isDraft ? "Draft - not approved" : "Approved for circulation"}</dd></div>
            </dl>
          </header>
          {template.fields.map((field) => (
            <section id={`export-${field.id}`} key={field.id}>
              <h2>{field.label}</h2>
              <ReadOnlyValue value={artifact.fieldValues[field.id]} />
            </section>
          ))}
          <footer>
            <ArtifactHubLogo variant="mark-primary" className="brand-mark small" />
            ArtifactHub · Connected context. Better artifacts. Confident delivery.
          </footer>
        </article>
        <aside className="export-panel">
          <div className={`export-readiness ${isDraft ? "warning" : "ready"}`}>
            <strong>{isDraft ? "Draft export" : "Ready to export"}</strong>
            <span>{isDraft ? "This document is not an approved snapshot." : "All required sections are confirmed."}</span>
          </div>
          <h3>Format</h3>
          <a className="format-option" href={`/api/projects/${projectId}/artifacts/${artifactId}/export.md`}>Markdown <span>.md</span></a>
          <a className="format-option" href={`/api/projects/${projectId}/artifacts/${artifactId}/export.docx`}>Word document <span>.docx</span></a>
          <div className="info-note">Exports are generated from the latest approved snapshot when one exists.</div>
        </aside>
      </div>
    </main>
  );
}

function GuidePanel({
  title,
  body,
  action,
  contextNote,
}: {
  title: string;
  body: string;
  action: ReactNode;
  contextNote: string;
}) {
  return (
    <aside className="guide-panel">
      <div className="guide-heading"><p className="eyebrow">ArtifactHub Guide</p></div>
      <div className="guide-focus">
        <span className="recommendation-icon">◎</span>
        <h3>{title}</h3>
        <p>{body}</p>
        {action}
      </div>
      <div className="panel-divider" />
      <h3>Why this matters</h3>
      <ul className="check-list">
        <li>Keeps artifact content consistent</li>
        <li>Reduces duplicate data entry</li>
        <li>Improves review recommendations</li>
      </ul>
      <div className="info-note">{contextNote}</div>
    </aside>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon ${tone}`}>◎</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/\s+/g, "-");
  const label = status
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return <span className={`status-badge status-${normalized}`}>{label}</span>;
}

function ProgressRing({ value }: { value: number }) {
  return (
    <span
      className="progress-ring"
      style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}
      aria-label={`${value}% complete`}
    >
      {value}
    </span>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span>◇</span><h2>{title}</h2><p>{body}</p>{action}
    </section>
  );
}

function FullPageLoading() {
  return (
    <div className="full-loading">
      <ArtifactHubLogo variant="app-icon-light" className="brand-mark" />
      <p>Preparing your workspace...</p>
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return <div className="panel-loading"><span /><p>{label}</p></div>;
}

function initials(name?: string) {
  return String(name || "AH")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type ArtifactHubLogoVariant =
  | "app-icon-dark"
  | "app-icon-light"
  | "lockup-dark"
  | "mark-primary"
  | "mark-white";

function ArtifactHubLogo({
  variant,
  className = "",
}: {
  variant: ArtifactHubLogoVariant;
  className?: string;
}) {
  const markColor =
    variant === "app-icon-dark"
      ? "var(--artifacthub-mark-color, #E6F2F1)"
      : variant === "lockup-dark" || variant === "mark-white"
        ? "#E6F2F1"
        : "#0E6F70";
  const hasAppTile = variant === "app-icon-dark" || variant === "app-icon-light";
  const isLockup = variant === "lockup-dark";
  const viewBox = isLockup ? "0 0 560 150" : hasAppTile ? "0 0 128 128" : "0 0 120 112";
  const label = isLockup ? "ArtifactHub" : "ArtifactHub logo";
  const appTileFill =
    variant === "app-icon-dark"
      ? "var(--artifacthub-tile-color, #111827)"
      : "#FFFFFF";

  return (
    <svg
      className={`artifacthub-logo artifacthub-logo-${variant} ${className}`}
      viewBox={viewBox}
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      {hasAppTile && (
        <rect
          x="4"
          y="4"
          width="120"
          height="120"
          rx="24"
          fill={appTileFill}
        />
      )}
      {isLockup && <rect width="100%" height="100%" fill="transparent" />}
      <g
        transform={
          isLockup
            ? "translate(18 18) scale(0.95)"
            : hasAppTile
              ? "translate(14 10) scale(0.83)"
              : "translate(0 0) scale(1)"
        }
        stroke={markColor}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M60 48V62M60 62L28 86M60 62L92 86" strokeWidth="8" />
        <rect x="48" y="8" width="24" height="26" rx="5" fill={markColor} />
        <rect x="50" y="50" width="20" height="20" rx="4" fill={markColor} />
        <rect x="12" y="80" width="28" height="28" rx="6" fill={markColor} />
        <rect x="80" y="80" width="28" height="28" rx="6" fill={markColor} />
      </g>
      {isLockup && (
        <text
          x="152"
          y="86"
          fontFamily="Inter, Arial, sans-serif"
          fontSize="64"
          fontWeight="700"
          letterSpacing="-2"
          fill="#FFFFFF"
        >
          ArtifactHub
        </text>
      )}
    </svg>
  );
}

export default App;
