import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { api } from "../../lib/api";
import UserActivity from "./UserActivity";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const TYPES = [
  { type: "login", label: "Logged in", group: "account" },
  { type: "login_failed", label: "Failed login", group: "security" },
  { type: "password_changed", label: "Changed their password", group: "security" },
  { type: "holding_added", label: "Added a holding", group: "portfolio" },
];

const ROWS = [
  { id: "e1", ts: "2026-09-26T10:00:00.000Z", type: "login_failed", label: "Failed login", group: "security", userId: "u1", userEmail: "ada@example.com", userName: "Ada", ip: "1.2.3.4", summary: "reason: wrong_password", props: { reason: "wrong_password" } },
  { id: "e2", ts: "2026-09-26T09:00:00.000Z", type: "login_failed", label: "Failed login", group: "security", userId: null, userEmail: null, userName: null, ip: "5.6.7.8", summary: "reason: unknown_account · identifier: z***@x.in", props: {} },
  { id: "e3", ts: "2026-09-25T09:00:00.000Z", type: "login", label: "Logged in", group: "account", userId: "u9", userEmail: null, userName: null, ip: null, summary: "", props: {} },
];

function page(over = {}) {
  return { events: ROWS, page: 1, limit: 50, total: ROWS.length, totalPages: 1, ...over };
}

function mockApi(activity = page()) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/user-activity/types") return Promise.resolve({ data: { types: TYPES } });
    if (url === "/admin/user-activity") return Promise.resolve({ data: typeof activity === "function" ? activity() : activity });
    return Promise.reject(new Error("unexpected " + url));
  });
}

const activityCalls = () => api.get.mock.calls.filter((c) => c[0] === "/admin/user-activity");
const lastParams = () => activityCalls().at(-1)[1].params;

function renderAt(path = "/admin/user-activity") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/user-activity" element={<UserActivity />} />
        <Route path="/admin/audit" element={<div>audit log page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("admin UserActivity", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the events with their label, group, user and details — flagging security events and users with no account", async () => {
    mockApi();
    renderAt();
    expect(screen.getByTestId("admin-activity-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());

    expect(screen.getByTestId("admin-activity-row-e1")).toHaveTextContent("Failed login");
    expect(screen.getByTestId("admin-activity-row-e1")).toHaveTextContent("reason: wrong_password");
    expect(screen.getByTestId("admin-activity-row-e1")).toHaveTextContent("1.2.3.4");
    expect(screen.getByTestId("admin-activity-group-e1")).toHaveTextContent("Security");
    expect(screen.getByTestId("admin-activity-group-e3")).toHaveTextContent("Account");
    expect(screen.getByTestId("admin-activity-user-e1")).toHaveAttribute("href", "/admin/users/u1");
    expect(screen.getByTestId("admin-activity-user-e2")).toHaveTextContent("No account");
    expect(screen.getByTestId("admin-activity-user-e3")).toHaveTextContent("Deleted account");
    expect(screen.getByTestId("admin-activity-total")).toHaveTextContent("3 events");
  });

  it("says plainly that this is separate from the Audit Log, and links to it", async () => {
    mockApi();
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    expect(screen.getByText(/records staff actions only/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Audit Log" }));
    expect(await screen.findByText("audit log page")).toBeInTheDocument();
  });

  it("shows an empty state, and the backend's message when loading fails", async () => {
    mockApi(page({ events: [], total: 0 }));
    const { unmount } = renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-empty")).toBeInTheDocument());
    unmount();

    api.get.mockImplementation((url) => (url === "/admin/user-activity/types" ? Promise.resolve({ data: { types: [] } }) : Promise.reject({ response: { data: { message: "The 'from' date isn't a valid date." } } })));
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-error")).toHaveTextContent("isn't a valid date"));
  });

  it("only sends the filters that are set, and applies them on Apply (back to page 1)", async () => {
    mockApi();
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    expect(lastParams()).toEqual({ page: 1, limit: 50 });

    fireEvent.change(screen.getByTestId("admin-activity-user-input"), { target: { value: "ada@" } });
    fireEvent.change(screen.getByTestId("admin-activity-type-select"), { target: { value: "login_failed" } });
    fireEvent.change(screen.getByTestId("admin-activity-from-input"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByTestId("admin-activity-to-input"), { target: { value: "2026-09-26" } });
    fireEvent.click(screen.getByTestId("admin-activity-apply-btn"));

    await waitFor(() => expect(lastParams()).toEqual({ user: "ada@", type: "login_failed", from: "2026-09-20", to: "2026-09-26", page: 1, limit: 50 }));
  });

  it("nothing is fetched by merely typing — only Apply searches", async () => {
    mockApi();
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    const before = activityCalls().length;
    fireEvent.change(screen.getByTestId("admin-activity-user-input"), { target: { value: "typing…" } });
    expect(activityCalls().length).toBe(before);
  });

  it("choosing a group narrows the event-type choices, and clears an event type that no longer fits", async () => {
    mockApi();
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("option", { name: "Added a holding" })).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-activity-type-select"), { target: { value: "holding_added" } });
    fireEvent.change(screen.getByTestId("admin-activity-group-select"), { target: { value: "security" } });
    expect(screen.queryByRole("option", { name: "Added a holding" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Failed login" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-activity-type-select")).toHaveValue("");

    fireEvent.click(screen.getByTestId("admin-activity-apply-btn"));
    await waitFor(() => expect(lastParams()).toMatchObject({ group: "security" }));
    expect(lastParams()).not.toHaveProperty("type");
  });

  it("Reset clears every filter and reloads", async () => {
    mockApi();
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("admin-activity-user-input"), { target: { value: "ada@" } });
    fireEvent.click(screen.getByTestId("admin-activity-apply-btn"));
    await waitFor(() => expect(lastParams().user).toBe("ada@"));

    fireEvent.click(screen.getByTestId("admin-activity-reset-btn"));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 50 }));
    expect(screen.getByTestId("admin-activity-user-input")).toHaveValue("");
  });

  it("opens pre-filtered from a link (e.g. the user page's 'View all activity')", async () => {
    mockApi();
    renderAt("/admin/user-activity?user=u1&group=security");
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    expect(lastParams()).toEqual({ user: "u1", group: "security", page: 1, limit: 50 });
    expect(screen.getByTestId("admin-activity-user-input")).toHaveValue("u1");
    expect(screen.getByTestId("admin-activity-group-select")).toHaveValue("security");
  });

  it("pages forward and back", async () => {
    mockApi(page({ total: 120, totalPages: 3 }));
    renderAt();
    await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
    expect(screen.getByTestId("admin-activity-prev-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("admin-activity-next-btn"));
    await waitFor(() => expect(lastParams().page).toBe(2));
    fireEvent.click(screen.getByTestId("admin-activity-prev-btn"));
    await waitFor(() => expect(lastParams().page).toBe(1));
  });

  describe("CSV export", () => {
    beforeEach(() => {
      window.URL.createObjectURL = jest.fn(() => "blob:mock");
      window.URL.revokeObjectURL = jest.fn();
    });

    it("asks for step-up, then downloads the CSV for the APPLIED filters and says it was audited", async () => {
      mockApi();
      renderAt();
      await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("admin-activity-user-input"), { target: { value: "ada@" } });
      fireEvent.click(screen.getByTestId("admin-activity-apply-btn"));
      await waitFor(() => expect(lastParams().user).toBe("ada@"));

      const exportCalls = () => api.get.mock.calls.filter((c) => c[0] === "/admin/user-activity/export");
      const base = api.get.getMockImplementation();
      api.get.mockImplementation((url, cfg) => {
        if (url === "/admin/user-activity/export") {
          if (!cfg.headers?.["x-step-up-token"]) return Promise.reject({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
          return Promise.resolve({ data: "time_ist,type\r\n", headers: { "x-export-row-count": "2", "x-export-truncated": "false", "x-export-row-limit": "10000" } });
        }
        return base(url, cfg);
      });
      api.post.mockResolvedValue({ data: { stepUpToken: "tok-1" } });

      fireEvent.click(screen.getByTestId("admin-activity-export-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("admin-stepup-password-input"), { target: { value: "Passw0rd!" } });
      fireEvent.click(screen.getByTestId("admin-stepup-submit-btn"));

      await waitFor(() => expect(screen.getByTestId("admin-activity-notice")).toHaveTextContent("Exported 2 rows"));
      expect(screen.getByTestId("admin-activity-notice")).toHaveTextContent("recorded in the Audit Log");
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
      const sent = exportCalls().at(-1)[1];
      expect(sent.params).toEqual({ user: "ada@" }); // exactly what the table is showing
      expect(sent.headers["x-step-up-token"]).toBe("tok-1");
    });

    it("tells the admin when the row cap cut the export short", async () => {
      mockApi();
      renderAt();
      await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
      const base = api.get.getMockImplementation();
      api.get.mockImplementation((url, cfg) =>
        url === "/admin/user-activity/export"
          ? Promise.resolve({ data: "h\r\n", headers: { "x-export-row-count": "10000", "x-export-truncated": "true", "x-export-row-limit": "10000" } })
          : base(url, cfg)
      );
      fireEvent.click(screen.getByTestId("admin-activity-export-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-activity-notice")).toHaveTextContent("only the newest 10000"));
    });

    it("cancelling the step-up prompt exports nothing and shows no error", async () => {
      mockApi();
      renderAt();
      await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
      const base = api.get.getMockImplementation();
      api.get.mockImplementation((url, cfg) => (url === "/admin/user-activity/export" ? Promise.reject({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }) : base(url, cfg)));
      fireEvent.click(screen.getByTestId("admin-activity-export-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-stepup-cancel-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-activity-export-btn")).not.toBeDisabled());
      expect(window.URL.createObjectURL).not.toHaveBeenCalled();
      expect(screen.queryByTestId("admin-activity-error")).not.toBeInTheDocument();
    });

    it("shows the backend's message when the export is refused (e.g. no export permission)", async () => {
      mockApi();
      renderAt();
      await waitFor(() => expect(screen.getByTestId("admin-activity-table")).toBeInTheDocument());
      const base = api.get.getMockImplementation();
      api.get.mockImplementation((url, cfg) => (url === "/admin/user-activity/export" ? Promise.reject({ response: { status: 403, data: { message: "Missing permission: users.export" } } }) : base(url, cfg)));
      fireEvent.click(screen.getByTestId("admin-activity-export-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-activity-error")).toHaveTextContent("Missing permission: users.export"));
    });
  });
});
