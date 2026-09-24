import React from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { LogOut, LayoutDashboard, Users, ScrollText, Activity, LineChart, IndianRupee, Boxes, Gauge, Compass, Sparkles, Network, UserCog, ShieldCheck, LifeBuoy, BellRing, CreditCard, Flag, FileLock2 } from "lucide-react";
import { useAdminAuth } from "./AdminAuthContext";
import Dashboard from "./screens/Dashboard";
import UsersList from "./screens/UsersList";
import UserDetail from "./screens/UserDetail";
import AuditLog from "./screens/AuditLog";
import SystemHealth from "./screens/SystemHealth";
import Analytics from "./screens/Analytics";
import Revenue from "./screens/Revenue";
import Instruments from "./screens/Instruments";
import ScoringModel from "./screens/ScoringModel";
import ContextModel from "./screens/ContextModel";
import SuggestionModel from "./screens/SuggestionModel";
import LookthroughModel from "./screens/LookthroughModel";
import Employees from "./screens/Employees";
import Roles from "./screens/Roles";
import Tickets from "./screens/Tickets";
import TicketDetail from "./screens/TicketDetail";
import TicketSettings from "./screens/TicketSettings";
import Notifications from "./screens/Notifications";
import NotificationCampaignDetail from "./screens/NotificationCampaignDetail";
import Subscriptions from "./screens/Subscriptions";
import FeatureFlags from "./screens/FeatureFlags";
import DataRequests from "./screens/DataRequests";

const NAV = [
  { to: "/admin", end: true, label: "Dashboard", Icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", Icon: Users },
  { to: "/admin/analytics", label: "Analytics", Icon: LineChart },
  { to: "/admin/revenue", label: "Revenue", Icon: IndianRupee },
  { to: "/admin/subscriptions", label: "Subscriptions", Icon: CreditCard },
  { to: "/admin/instruments", label: "Instruments", Icon: Boxes },
  { to: "/admin/scoring-model", label: "Scoring Model", Icon: Gauge },
  { to: "/admin/context-model", label: "Context Model", Icon: Compass },
  { to: "/admin/suggestion-model", label: "Suggestion Model", Icon: Sparkles },
  { to: "/admin/lookthrough-model", label: "Look-Through Model", Icon: Network },
  { to: "/admin/tickets", label: "Tickets", Icon: LifeBuoy },
  { to: "/admin/notifications", label: "Notifications", Icon: BellRing },
  // Superadmin-only on the backend (employees.manage/roles.manage are in
  // auth/permissions.ts's SUPERADMIN_ONLY) — hidden here too for anyone else,
  // rather than showing a link that would just 403.
  { to: "/admin/employees", label: "Employees", Icon: UserCog, superadminOnly: true },
  { to: "/admin/roles", label: "Roles", Icon: ShieldCheck, superadminOnly: true },
  { to: "/admin/feature-flags", label: "Feature Flags", Icon: Flag },
  { to: "/admin/data-requests", label: "Data Requests", Icon: FileLock2 },
  { to: "/admin/audit", label: "Audit Log", Icon: ScrollText },
  { to: "/admin/system", label: "System", Icon: Activity },
];

/**
 * The authenticated admin layout (Phases 1.3 and 1b of
 * docs/ADMIN_PANEL_PLAN.md) — replaces the Phase 0.4 placeholder with a real
 * sidebar + routed content area. More sections (Feature Flags) land in
 * later phases, added to NAV/Routes the same way these were.
 */
export default function AdminShell() {
  const { staffUser, logout } = useAdminAuth();

  return (
    // `h-screen` + `overflow-hidden` here, not `min-h-screen` — min-height
    // lets this container grow TALLER than the viewport the moment a routed
    // screen's content is longer than one page, which drags the sidebar
    // along with it (a normal flex child, stretched to match): the whole
    // page scrolled together and the logout button at the bottom of the
    // sidebar ended up wherever the bottom of that long page happened to
    // land, instead of staying pinned. A fixed `h-screen` combined with each
    // child owning its OWN `overflow-y-auto` (already true of <main>; added
    // to <aside> too, for an unusually short viewport with all 18 nav items)
    // is the same pattern DiveShell.jsx already uses for the main app.
    <div className="h-screen dive-app-surface flex overflow-hidden" data-testid="admin-shell">
      <aside className="w-56 shrink-0 h-full overflow-y-auto border-r border-[var(--border)] flex flex-col py-6 px-3">
        <div className="px-3 mb-8">
          <span className="font-heading font-black text-xl whitespace-nowrap">
            <span className="text-gold-gradient">Divv</span>
            <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
            <span className="text-[var(--text-tertiary)] font-bold ml-2 text-base align-middle">Admin</span>
          </span>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.filter((item) => !item.superadminOnly || staffUser?.staffRole === "superadmin").map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={`admin-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  isActive
                    ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)]"
                }`
              }
            >
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-2 mb-2">
          <p className="text-xs text-[var(--text-tertiary)] truncate" data-testid="admin-shell-identity">
            {staffUser?.email}
          </p>
          <p className="text-xs font-bold text-[var(--text-secondary)] capitalize">{staffUser?.staffRole}</p>
        </div>
        <button
          data-testid="admin-shell-logout-btn"
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-tertiary)] hover:bg-[var(--red)]/10 hover:text-[var(--red)] transition-colors"
        >
          <LogOut size={18} /> Log out
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<UsersList />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="revenue" element={<Revenue />} />
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="instruments" element={<Instruments />} />
          <Route path="scoring-model" element={<ScoringModel />} />
          <Route path="context-model" element={<ContextModel />} />
          <Route path="suggestion-model" element={<SuggestionModel />} />
          <Route path="lookthrough-model" element={<LookthroughModel />} />
          <Route path="employees" element={<Employees />} />
          <Route path="roles" element={<Roles />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="ticket-settings" element={<TicketSettings />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="notifications/campaigns/:id" element={<NotificationCampaignDetail />} />
          <Route path="feature-flags" element={<FeatureFlags />} />
          <Route path="data-requests" element={<DataRequests />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="system" element={<SystemHealth />} />
        </Routes>
      </main>
    </div>
  );
}
