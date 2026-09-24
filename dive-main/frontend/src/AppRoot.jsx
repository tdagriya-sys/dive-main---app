import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import App from "./App";

// Lazy-loaded so the admin panel's code (and its own dependencies) never
// ships in the bundle a normal Divve user downloads — Phase 0.4 of
// docs/ADMIN_PANEL_PLAN.md. Kept out of the Router provider itself (index.js
// wraps THIS component in <BrowserRouter>) so a test can wrap it in
// <MemoryRouter> instead, without needing a real browser history.
//
// Relative imports throughout this file (not the "@/" alias most of the rest
// of the app uses) — the alias resolves in webpack (dev server + production
// build) but NOT in this project's Jest config, which has no matching
// moduleNameMapper for it; every file actually exercised by a test already
// sticks to relative imports for exactly this reason.
const AdminApp = lazy(() => import("./admin/AdminApp"));

function AdminLoadingFallback() {
  return <div className="min-h-screen dive-app-surface" data-testid="admin-loading-fallback" />;
}

// The one place the app splits into two completely separate trees: `/admin/*`
// (staff, gated by its own login + mandatory TOTP — see src/admin/) and
// everything else (the existing screen-state-navigated app, byte-for-byte
// unchanged — App.js itself has no router awareness at all).
export default function AppRoot() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<AdminLoadingFallback />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route path="/*" element={<App />} />
    </Routes>
  );
}
