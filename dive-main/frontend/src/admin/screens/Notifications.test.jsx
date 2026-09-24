import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../lib/api";
import Notifications from "./Notifications";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const CATEGORIES = [{ id: "c1", key: "product", label: "Product" }];
const TEMPLATES = [{ id: "t1", key: "welcome", name: "Welcome", categoryKey: "product", subject: "Hi {{name}}", bodyMarkdown: "Hello {{name}}!", channels: ["in_app"], isActive: true }];
const CAMPAIGNS = [{ id: "camp1", name: "Announcement", categoryKey: "product", audience: "all", status: "draft", stats: null }];

function renderComponent() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  );
}

function mockLoadOk() {
  api.get.mockImplementation((url) => {
    if (url === "/admin/notification-campaigns") return Promise.resolve({ data: { campaigns: CAMPAIGNS } });
    if (url === "/admin/notification-templates") return Promise.resolve({ data: { templates: TEMPLATES } });
    if (url === "/admin/notification-categories") return Promise.resolve({ data: { categories: CATEGORIES } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("Notifications (admin)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the campaigns table by default", async () => {
    mockLoadOk();
    renderComponent();
    expect(screen.getByTestId("admin-notifications-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    expect(screen.getByText("Announcement")).toBeInTheDocument();
  });

  it("switches to the templates tab and shows the template with a live variable preview", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));
    expect(screen.getByTestId("admin-notifications-template-preview-t1")).toHaveTextContent("Hello Ada Example!");
  });

  it("creates a new campaign with inline content and navigates to its detail page", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { campaign: { id: "camp2" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-new-name-input"), { target: { value: "Big Sale" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-subject-input"), { target: { value: "Sale!" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-body-input"), { target: { value: "50% off" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns", {
        name: "Big Sale",
        categoryKey: "product",
        channels: ["in_app"],
        audience: "all",
        inlineContent: { subject: "Sale!", bodyMarkdown: "50% off" },
      })
    );
  });

  it("creates a new campaign with the popup channel and a highlight style", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { campaign: { id: "camp3" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-new-name-input"), { target: { value: "Big Sale" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-channel-popup"));
    fireEvent.change(screen.getByTestId("admin-notifications-new-subject-input"), { target: { value: "Sale!" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-body-input"), { target: { value: "==50% off==" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-highlight-color-input"), { target: { value: "#D4AF37" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns", {
        name: "Big Sale",
        categoryKey: "product",
        channels: ["in_app", "popup"],
        audience: "all",
        inlineContent: { subject: "Sale!", bodyMarkdown: "==50% off==", highlightStyle: { color: "#D4AF37" } },
      })
    );
  });

  it("creates a new campaign with a callout (image + highlighted text), positioned above Subject", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { campaign: { id: "camp4" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-new-name-input"), { target: { value: "Big Sale" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-callout-image-input"), { target: { value: "https://example.com/banner.gif" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-callout-text-input"), { target: { value: "50% off today!" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-subject-input"), { target: { value: "Sale!" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-body-input"), { target: { value: "Body text" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns", {
        name: "Big Sale",
        categoryKey: "product",
        channels: ["in_app"],
        audience: "all",
        inlineContent: { subject: "Sale!", bodyMarkdown: "Body text", callout: { imageUrl: "https://example.com/banner.gif", text: "50% off today!" } },
      })
    );
  });

  it("creates a campaign with a call-to-action button and a linked callout", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { campaign: { id: "camp5" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-new-name-input"), { target: { value: "Promo" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-callout-text-input"), { target: { value: "50% off" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-callout-link-input"), { target: { value: "https://example.com/offer" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-subject-input"), { target: { value: "Sale" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-body-input"), { target: { value: "Read [details](https://example.com)" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-button-label-input"), { target: { value: "  Get started " } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-button-url-input"), { target: { value: "/?go=signup" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns", {
        name: "Promo",
        categoryKey: "product",
        channels: ["in_app"],
        audience: "all",
        inlineContent: {
          subject: "Sale",
          bodyMarkdown: "Read [details](https://example.com)",
          callout: { text: "50% off", linkUrl: "https://example.com/offer" },
          button: { label: "Get started", url: "/?go=signup" },
        },
      })
    );
  });

  it("the app-page picker fills the link field with an app-relative link", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));

    fireEvent.change(screen.getByTestId("admin-notifications-new-button-url-picker"), { target: { value: "/?go=login" } });
    expect(screen.getByTestId("admin-notifications-new-button-url-input")).toHaveValue("/?go=login");
    // and the picker snaps back so it can be used again
    expect(screen.getByTestId("admin-notifications-new-button-url-picker")).toHaveValue("");
  });

  it("warns, and leaves the button off, when only half of it is filled in", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { campaign: { id: "camp6" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));

    expect(screen.queryByTestId("admin-notifications-new-button-incomplete-warning")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("admin-notifications-new-button-label-input"), { target: { value: "Go" } });
    expect(screen.getByTestId("admin-notifications-new-button-incomplete-warning")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("admin-notifications-new-name-input"), { target: { value: "Half button" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-subject-input"), { target: { value: "S" } });
    fireEvent.change(screen.getByTestId("admin-notifications-new-body-input"), { target: { value: "B" } });
    fireEvent.click(screen.getByTestId("admin-notifications-new-create-btn"));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns", {
        name: "Half button",
        categoryKey: "product",
        channels: ["in_app"],
        audience: "all",
        inlineContent: { subject: "S", bodyMarkdown: "B" },
      })
    );
  });

  it("creates a template with a button", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.click(screen.getByTestId("admin-notifications-new-template-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-key-input"), { target: { value: "promo" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-name-input"), { target: { value: "Promo" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-subject-input"), { target: { value: "S" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-body-input"), { target: { value: "B" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-button-label-input"), { target: { value: "Open" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-button-url-input"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByTestId("admin-notifications-newtpl-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-templates", {
        key: "promo",
        name: "Promo",
        categoryKey: "product",
        subject: "S",
        bodyMarkdown: "B",
        channels: ["in_app"],
        button: { label: "Open", url: "https://example.com" },
      })
    );
  });

  it("sends an explicit null when a template's saved callout and button are emptied out, so they really clear", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/notification-campaigns") return Promise.resolve({ data: { campaigns: CAMPAIGNS } });
      if (url === "/admin/notification-templates")
        return Promise.resolve({
          data: {
            templates: [
              {
                ...TEMPLATES[0],
                callout: { text: "Old callout" },
                button: { label: "Old", url: "/?go=login" },
              },
            ],
          },
        });
      if (url === "/admin/notification-categories") return Promise.resolve({ data: { categories: CATEGORIES } });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.patch.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.change(screen.getByTestId("admin-notifications-template-callout-t1-text-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("admin-notifications-template-button-t1-label-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("admin-notifications-template-button-t1-url-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("admin-notifications-template-save-btn-t1"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-templates/t1", {
        subject: "Hi {{name}}",
        bodyMarkdown: "Hello {{name}}!",
        channels: ["in_app"],
        callout: null,
        button: null,
      })
    );
  });

  it("shows the Email lists tab", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    api.get.mockImplementation((url) => (url === "/admin/external-lists" ? Promise.resolve({ data: { lists: [], suppressedTotal: 0 } }) : Promise.reject(new Error("unexpected " + url))));
    fireEvent.click(screen.getByTestId("admin-notifications-tab-lists"));
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-empty")).toBeInTheDocument());
  });

  it("shows the Landing pop-ups tab", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    api.get.mockImplementation((url) => (url === "/admin/landing-popups" ? Promise.resolve({ data: { popups: [] } }) : Promise.reject(new Error("unexpected " + url))));
    fireEvent.click(screen.getByTestId("admin-notifications-tab-landing"));
    await waitFor(() => expect(screen.getByTestId("admin-landing-popups-empty")).toBeInTheDocument());
  });

  it("renders the callout field above the Subject input in the new-campaign form", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-new-campaign-toggle-btn"));

    const calloutInput = screen.getByTestId("admin-notifications-new-callout-text-input");
    const subjectInput = screen.getByTestId("admin-notifications-new-subject-input");
    expect(calloutInput.compareDocumentPosition(subjectInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("creates a new template", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.click(screen.getByTestId("admin-notifications-new-template-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-key-input"), { target: { value: "reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-name-input"), { target: { value: "Reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-subject-input"), { target: { value: "Don't forget" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-body-input"), { target: { value: "Body" } });
    fireEvent.click(screen.getByTestId("admin-notifications-newtpl-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-templates", { key: "reminder", name: "Reminder", categoryKey: "product", subject: "Don't forget", bodyMarkdown: "Body", channels: ["in_app"] })
    );
  });

  it("creates a template with the popup channel enabled", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.click(screen.getByTestId("admin-notifications-new-template-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-key-input"), { target: { value: "reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-name-input"), { target: { value: "Reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-subject-input"), { target: { value: "Don't forget" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-body-input"), { target: { value: "Body" } });
    fireEvent.click(screen.getByTestId("admin-notifications-newtpl-channel-popup"));
    fireEvent.click(screen.getByTestId("admin-notifications-newtpl-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-templates", {
        key: "reminder",
        name: "Reminder",
        categoryKey: "product",
        subject: "Don't forget",
        bodyMarkdown: "Body",
        channels: ["in_app", "popup"],
      })
    );
  });

  it("edits an existing template's channels and highlight style", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.click(screen.getByTestId("admin-notifications-template-channel-popup-t1"));
    fireEvent.change(screen.getByTestId("admin-notifications-template-highlight-t1-color-input"), { target: { value: "#FF0000" } });
    fireEvent.click(screen.getByTestId("admin-notifications-template-save-btn-t1"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-templates/t1", {
        subject: "Hi {{name}}",
        bodyMarkdown: "Hello {{name}}!",
        channels: ["in_app", "popup"],
        highlightStyle: { color: "#FF0000" },
      })
    );
  });

  it("creates a new template with a callout", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.click(screen.getByTestId("admin-notifications-new-template-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-key-input"), { target: { value: "reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-name-input"), { target: { value: "Reminder" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-callout-image-input"), { target: { value: "https://example.com/banner.gif" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-subject-input"), { target: { value: "Don't forget" } });
    fireEvent.change(screen.getByTestId("admin-notifications-newtpl-body-input"), { target: { value: "Body" } });
    fireEvent.click(screen.getByTestId("admin-notifications-newtpl-create-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/notification-templates", {
        key: "reminder",
        name: "Reminder",
        categoryKey: "product",
        subject: "Don't forget",
        bodyMarkdown: "Body",
        channels: ["in_app"],
        callout: { imageUrl: "https://example.com/banner.gif" },
      })
    );
  });

  it("edits an existing template's callout independently of the body's own highlight style", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { template: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));

    fireEvent.change(screen.getByTestId("admin-notifications-template-callout-t1-text-input"), { target: { value: "Big news!" } });
    fireEvent.change(screen.getByTestId("admin-notifications-template-callout-t1-style-color-input"), { target: { value: "#FF00FF" } });
    fireEvent.click(screen.getByTestId("admin-notifications-template-save-btn-t1"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-templates/t1", {
        subject: "Hi {{name}}",
        bodyMarkdown: "Hello {{name}}!",
        channels: ["in_app"],
        callout: { text: "Big news!", highlightStyle: { color: "#FF00FF" } },
      })
    );
  });

  it("shows the backend's error when deleting a template still in use", async () => {
    mockLoadOk();
    api.delete.mockRejectedValue({ response: { data: { message: "1 campaign(s) still use this template." } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-notifications-campaigns-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-notifications-tab-templates"));
    fireEvent.click(screen.getByTestId("admin-notifications-template-delete-btn-t1"));
    await waitFor(() => expect(screen.getByTestId("admin-notifications-error")).toHaveTextContent("still use this template"));
  });
});
