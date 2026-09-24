import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import LandingPopups from "./LandingPopups";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const INACTIVE = {
  id: "p1", name: "Spring sale", title: "Spring sale is live", bodyMarkdown: "Get ==50% off==", bodyHtml: 'Get <span style="color:#D4AF37">50% off</span>',
  highlightStyle: null, callout: null, button: { label: "Sign up", url: "/?go=signup" }, isActive: false,
};
const ACTIVE = { ...INACTIVE, id: "p2", name: "Live one", title: "Live title", button: null, isActive: true };

function mockList(popups) {
  api.get.mockImplementation((url) => (url === "/admin/landing-popups" ? Promise.resolve({ data: { popups } }) : Promise.reject(new Error("unexpected " + url))));
}

describe("LandingPopups (admin tab)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows an empty state", async () => {
    mockList([]);
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popups-empty")).toBeInTheDocument());
  });

  it("lists pop-ups with their status and a rendered preview", async () => {
    mockList([INACTIVE, ACTIVE]);
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-row-p1")).toBeInTheDocument());
    expect(screen.getByTestId("admin-landing-popup-status-p1")).toHaveTextContent("Inactive");
    expect(screen.getByTestId("admin-landing-popup-status-p2")).toHaveTextContent("Active (live)");
    expect(screen.getByTestId("admin-landing-popup-preview-body-p1").querySelector("span")).toHaveTextContent("50% off");
    expect(screen.getByTestId("admin-landing-popup-preview-title-p1")).toHaveTextContent("Spring sale is live");
  });

  it("creates a pop-up (inactive) with a title, body, and button", async () => {
    mockList([]);
    api.post.mockResolvedValue({ data: { popup: {} } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popups-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-landing-popups-new-btn"));
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-name-input"), { target: { value: "Launch" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-subject-input"), { target: { value: "We launched" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-body-input"), { target: { value: "Come see [the app](/?go=signup)" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-button-label-input"), { target: { value: "Get started" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-button-url-input"), { target: { value: "/?go=signup" } });
    fireEvent.click(screen.getByTestId("admin-landing-popup-form-save-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/landing-popups", {
        name: "Launch",
        title: "We launched",
        bodyMarkdown: "Come see [the app](/?go=signup)",
        button: { label: "Get started", url: "/?go=signup" },
      })
    );
  });

  it("says the {{name}}/{{email}} variables aren't available, since visitors aren't logged in", async () => {
    mockList([]);
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popups-empty")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-landing-popups-new-btn"));
    expect(screen.getByTestId("admin-landing-popup-form-link-help")).toHaveTextContent("aren't available here");
  });

  it("asks for confirmation before going live, then activates", async () => {
    mockList([INACTIVE]);
    api.post.mockResolvedValue({ data: { popup: {} } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-activate-btn-p1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-landing-popup-activate-btn-p1"));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-landing-popup-activate-confirm-p1")).toHaveTextContent("live for every visitor");

    fireEvent.click(screen.getByTestId("admin-landing-popup-activate-confirm-btn-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/landing-popups/p1/activate", {}, { headers: { "x-step-up-token": undefined } }));
  });

  it("prompts for step-up when activating requires it", async () => {
    mockList([INACTIVE]);
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-activate-btn-p1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-landing-popup-activate-btn-p1"));
    fireEvent.click(screen.getByTestId("admin-landing-popup-activate-confirm-btn-p1"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("an ACTIVE pop-up can only be deactivated — no edit or delete until then", async () => {
    mockList([ACTIVE]);
    api.post.mockResolvedValue({ data: { popup: {} } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-deactivate-btn-p2")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-landing-popup-edit-btn-p2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-landing-popup-delete-btn-p2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-landing-popup-activate-btn-p2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-landing-popup-deactivate-btn-p2"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/landing-popups/p2/deactivate", {}));
  });

  it("edits an inactive pop-up, prefilled, and sends null for a button that was removed", async () => {
    mockList([INACTIVE]);
    api.patch.mockResolvedValue({ data: { popup: {} } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-edit-btn-p1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-landing-popup-edit-btn-p1"));

    expect(screen.getByTestId("admin-landing-popup-form-name-input")).toHaveValue("Spring sale");
    expect(screen.getByTestId("admin-landing-popup-form-subject-input")).toHaveValue("Spring sale is live");
    expect(screen.getByTestId("admin-landing-popup-form-button-label-input")).toHaveValue("Sign up");

    fireEvent.change(screen.getByTestId("admin-landing-popup-form-subject-input"), { target: { value: "New title" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-button-label-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("admin-landing-popup-form-button-url-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("admin-landing-popup-form-save-btn"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/landing-popups/p1", {
        name: "Spring sale",
        title: "New title",
        bodyMarkdown: "Get ==50% off==",
        button: null,
      })
    );
  });

  it("deletes an inactive pop-up only after a confirmation", async () => {
    mockList([INACTIVE]);
    api.delete.mockResolvedValue({ data: { ok: true } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-delete-btn-p1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-landing-popup-delete-btn-p1"));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("admin-landing-popup-delete-confirm-btn-p1"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/admin/landing-popups/p1"));
  });

  it("shows the backend's message when an action fails", async () => {
    mockList([ACTIVE]);
    api.post.mockRejectedValue({ response: { data: { message: "Something went wrong on the server." } } });
    render(<LandingPopups />);
    await waitFor(() => expect(screen.getByTestId("admin-landing-popup-deactivate-btn-p2")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-landing-popup-deactivate-btn-p2"));
    await waitFor(() => expect(screen.getByTestId("admin-landing-popups-error")).toHaveTextContent("Something went wrong on the server."));
  });
});
