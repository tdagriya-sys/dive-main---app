import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import ExternalLists from "./ExternalLists";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

const LISTS = {
  lists: [
    { name: "Launch", total: 10, subscribed: 8, unsubscribed: 2 },
    { name: "Beta", total: 3, subscribed: 3, unsubscribed: 0 },
  ],
  suppressedTotal: 2,
};

function mockLists(data = LISTS) {
  api.get.mockImplementation((url) => (url === "/admin/external-lists" ? Promise.resolve({ data }) : Promise.reject(new Error("unexpected " + url))));
}

function fillImportForm({ list = "Launch", source = "Webinar signups", text = "email,name\nada@example.com,Ada", consent = true } = {}) {
  fireEvent.change(screen.getByTestId("admin-external-lists-import-list-input"), { target: { value: list } });
  fireEvent.change(screen.getByTestId("admin-external-lists-import-source-input"), { target: { value: source } });
  fireEvent.change(screen.getByTestId("admin-external-lists-import-text-input"), { target: { value: text } });
  if (consent) fireEvent.click(screen.getByTestId("admin-external-lists-import-consent"));
}

describe("ExternalLists (admin tab — email lists)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows each list with its subscribed/unsubscribed counts, plus how many addresses are suppressed overall", async () => {
    mockLists();
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-list-row-Launch")).toBeInTheDocument());
    const row = screen.getByTestId("admin-external-list-row-Launch");
    expect(row).toHaveTextContent("Launch");
    expect(row).toHaveTextContent("10");
    expect(row).toHaveTextContent("8");
    expect(screen.getByTestId("admin-external-lists-suppressed")).toHaveTextContent("2 address(es) have unsubscribed");
  });

  it("shows which marketing address emails go out from, and that it's separate from the no-reply address", async () => {
    mockLists({ ...LISTS, marketingSender: { from: "Divve Offers <offers@divve.in>", replyTo: "hello@divve.in", ready: true, problem: null } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-sender")).toBeInTheDocument());
    expect(screen.getByTestId("admin-external-lists-sender")).toHaveTextContent("Divve Offers <offers@divve.in>");
    expect(screen.getByTestId("admin-external-lists-sender")).toHaveTextContent("never affects your no-reply address");
    expect(screen.getByTestId("admin-external-lists-sender")).toHaveTextContent("Replies go to hello@divve.in");
    expect(screen.queryByTestId("admin-external-lists-sender-warning")).not.toBeInTheDocument();
  });

  it("warns clearly when no marketing sender is set up", async () => {
    mockLists({ ...LISTS, marketingSender: { from: null, replyTo: null, ready: false, problem: "No marketing sender is set up. Set MARKETING_EMAIL_FROM in the backend .env and restart." } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-sender-warning")).toBeInTheDocument());
    expect(screen.getByTestId("admin-external-lists-sender-warning")).toHaveTextContent("MARKETING_EMAIL_FROM");
    expect(screen.queryByTestId("admin-external-lists-sender")).not.toBeInTheDocument();
  });

  it("in development mode (no real provider) says nothing is actually sent", async () => {
    mockLists({ ...LISTS, marketingSender: { from: null, replyTo: null, ready: true, problem: null } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-sender")).toHaveTextContent("nothing is actually sent"));
  });

  it("shows an empty state, and states the consent and unsubscribe rules up front", async () => {
    mockLists({ lists: [], suppressedTotal: 0 });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-empty")).toBeInTheDocument());
    expect(screen.getByTestId("admin-external-lists")).toHaveTextContent("agreed to hear from Divve");
    expect(screen.getByTestId("admin-external-lists")).toHaveTextContent("never emailed again");
    expect(screen.queryByTestId("admin-external-lists-suppressed")).not.toBeInTheDocument();
  });

  it("keeps Import disabled until the list name, source, addresses AND the consent confirmation are all present", async () => {
    mockLists();
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import")).toBeInTheDocument());
    const btn = screen.getByTestId("admin-external-lists-import-btn");
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByTestId("admin-external-lists-import-list-input"), { target: { value: "Launch" } });
    fireEvent.change(screen.getByTestId("admin-external-lists-import-source-input"), { target: { value: "Webinar" } });
    fireEvent.change(screen.getByTestId("admin-external-lists-import-text-input"), { target: { value: "ada@example.com" } });
    expect(btn).toBeDisabled(); // no consent yet
    fireEvent.click(screen.getByTestId("admin-external-lists-import-consent"));
    expect(btn).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-external-lists-import-source-input"), { target: { value: "   " } });
    expect(btn).toBeDisabled();
  });

  it("imports, then shows a clear summary — including duplicates merged, unsubscribed kept off, already-registered skipped, and bad rows", async () => {
    mockLists();
    api.post.mockResolvedValue({
      data: {
        result: { total: 5, added: 3, updated: 2, unsubscribedKept: 1, alreadyRegistered: 2 },
        duplicatesInFile: 4,
        invalidCount: 25,
        invalid: [{ line: 3, value: "not-an-email", reason: "Not a valid email address" }],
      },
    });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import")).toBeInTheDocument());
    fillImportForm();
    fireEvent.click(screen.getByTestId("admin-external-lists-import-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/external-lists/import", { listName: "Launch", source: "Webinar signups", consentConfirmed: true, text: "email,name\nada@example.com,Ada" })
    );
    const result = await screen.findByTestId("admin-external-lists-import-result");
    expect(result).toHaveTextContent("Imported 5 address(es): 3 new, 2 already known.");
    expect(screen.getByTestId("admin-external-lists-result-duplicates")).toHaveTextContent("4 duplicate row(s)");
    expect(screen.getByTestId("admin-external-lists-result-unsubscribed")).toHaveTextContent("1 had already unsubscribed");
    expect(screen.getByTestId("admin-external-lists-result-registered")).toHaveTextContent("2 already have a Divve account");
    expect(screen.getByTestId("admin-external-lists-result-invalid")).toHaveTextContent("25 row(s) couldn't be imported");
    expect(screen.getByTestId("admin-external-lists-result-invalid")).toHaveTextContent("Line 3: “not-an-email” — Not a valid email address");
    expect(screen.getByTestId("admin-external-lists-result-invalid")).toHaveTextContent("and 24 more");

    // form resets for the next batch (text + consent), and the lists reload
    expect(screen.getByTestId("admin-external-lists-import-text-input")).toHaveValue("");
    expect(screen.getByTestId("admin-external-lists-import-consent")).not.toBeChecked();
    expect(api.get.mock.calls.filter((c) => c[0] === "/admin/external-lists").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the backend's message when an import is rejected", async () => {
    mockLists();
    api.post.mockRejectedValue({ response: { data: { message: "No valid email addresses were found (2 row(s) were invalid)." } } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import")).toBeInTheDocument());
    fillImportForm({ text: "nope" });
    fireEvent.click(screen.getByTestId("admin-external-lists-import-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-error")).toHaveTextContent("No valid email addresses were found"));
  });

  it("fills the addresses box from an uploaded CSV file", async () => {
    mockLists();
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import")).toBeInTheDocument());
    const file = new File(["email,name\nada@example.com,Ada Lovelace"], "contacts.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("admin-external-lists-import-file-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import-text-input")).toHaveValue("email,name\nada@example.com,Ada Lovelace"));
    expect(screen.getByTestId("admin-external-lists-import-file-name")).toHaveTextContent("contacts.csv");
  });

  it("refuses a file that's too large, without loading it", async () => {
    mockLists();
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-import")).toBeInTheDocument());
    const big = new File(["x"], "huge.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 2_000_000 });
    fireEvent.change(screen.getByTestId("admin-external-lists-import-file-input"), { target: { files: [big] } });
    expect(screen.getByTestId("admin-external-lists-error")).toHaveTextContent("too large");
    expect(screen.getByTestId("admin-external-lists-import-text-input")).toHaveValue("");
  });

  it("offers the existing list names when typing a list name (so new imports can join an existing list)", async () => {
    mockLists();
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-list-row-Launch")).toBeInTheDocument());
    const options = [...document.querySelectorAll("#admin-external-list-names option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Launch", "Beta"]);
  });

  it("views a list's (masked) contacts and pages through them", async () => {
    api.get.mockImplementation((url, config) => {
      if (url === "/admin/external-lists") return Promise.resolve({ data: LISTS });
      if (url === "/admin/external-lists/contacts") {
        const page = config.params.page;
        return Promise.resolve({
          data: {
            contacts: page === 1
              ? [{ id: "c1", email: "a**@example.com", name: "Ada", unsubscribed: false }, { id: "c2", email: "b**@example.com", name: null, unsubscribed: true }]
              : [{ id: "c3", email: "z**@example.com", name: "Zed", unsubscribed: false }],
            total: 60, page, pageSize: 50,
          },
        });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-list-view-btn-Launch")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-external-list-view-btn-Launch"));

    await waitFor(() => expect(screen.getByTestId("admin-external-contact-c1")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith("/admin/external-lists/contacts", { params: { list: "Launch", page: 1 } });
    expect(screen.getByTestId("admin-external-contact-c1")).toHaveTextContent("a**@example.com");
    expect(screen.getByTestId("admin-external-contact-c1")).toHaveTextContent("Subscribed");
    expect(screen.getByTestId("admin-external-contact-c2")).toHaveTextContent("(no name)");
    expect(screen.getByTestId("admin-external-contact-c2")).toHaveTextContent("Unsubscribed");
    expect(screen.getByTestId("admin-external-lists-contacts-prev-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("admin-external-lists-contacts-next-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-external-contact-c3")).toBeInTheDocument());
    expect(screen.getByTestId("admin-external-lists-contacts-next-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("admin-external-lists-contacts-close-btn"));
    expect(screen.queryByTestId("admin-external-lists-contacts")).not.toBeInTheDocument();
  });

  it("deletes a list only after a confirmation, and explains what was kept", async () => {
    mockLists();
    api.delete.mockResolvedValue({ data: { deleted: 6, detached: 4 } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-list-delete-btn-Launch")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-external-list-delete-btn-Launch"));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("admin-external-list-delete-confirm-btn-Launch"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/admin/external-lists", { params: { name: "Launch" } }));
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-notice")).toHaveTextContent("6 contact(s) removed, 4 kept"));
  });

  it("shows the backend's message when a list can't be deleted (e.g. an unsent campaign uses it)", async () => {
    mockLists();
    api.delete.mockRejectedValue({ response: { data: { message: "1 campaign(s) that haven't been sent yet still use this list." } } });
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-list-delete-btn-Beta")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-external-list-delete-btn-Beta"));
    fireEvent.click(screen.getByTestId("admin-external-list-delete-confirm-btn-Beta"));
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-error")).toHaveTextContent("still use this list"));
  });

  it("shows an error if the lists can't be loaded", async () => {
    api.get.mockRejectedValue(new Error("boom"));
    render(<ExternalLists />);
    await waitFor(() => expect(screen.getByTestId("admin-external-lists-error")).toHaveTextContent("Couldn't load your email lists"));
  });
});
