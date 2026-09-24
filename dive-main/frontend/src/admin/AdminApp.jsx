import React from "react";
import { useLocation } from "react-router-dom";
import { AdminAuthProvider, useAdminAuth } from "./AdminAuthContext";
import AdminLogin from "./AdminLogin";
import AdminShell from "./AdminShell";
import AcceptInvite from "./AcceptInvite";

function AdminRouter() {
  const { authLoading, staffUser } = useAdminAuth();
  const location = useLocation();

  // Reachable regardless of auth state — a person accepting an invite has no
  // session yet (Phase 3 of docs/ADMIN_PANEL_PLAN.md) and must never be
  // redirected into the login flow just because authLoading/staffUser say so.
  if (location.pathname === "/admin/accept-invite") return <AcceptInvite />;

  if (authLoading) return <div className="min-h-screen dive-app-surface" data-testid="admin-auth-loading" />;
  return staffUser ? <AdminShell /> : <AdminLogin />;
}

// Default export — lazy-loaded from src/AppRoot.jsx so the main user bundle
// never pays for any of the admin tree's code (Phase 0.4 of
// docs/ADMIN_PANEL_PLAN.md).
export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminRouter />
    </AdminAuthProvider>
  );
}
