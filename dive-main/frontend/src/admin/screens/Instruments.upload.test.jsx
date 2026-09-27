import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/api";
import Instruments from "./Instruments";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const PAGE = { instruments: [], sources: [], page: 1, limit: 25, total: 0, totalPages: 1 };
const csvFile = (name = "reits.csv", text = "Name\nEmbassy Office Parks REIT") => new File([text], name, { type: "text/csv" });

function mockLoadOk() {
  api.get.mockResolvedValue({ data: PAGE });
}

describe("Instruments — manual data upload panel", () => {
  afterEach(() => jest.clearAllMocks());

  it("is collapsed by default, and opens to reveal the class picker and file input", async () => {
    mockLoadOk();
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-instruments-upload-file-input")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    expect(screen.getByTestId("admin-instruments-upload-class-select")).toBeInTheDocument();
    expect(screen.getByTestId("admin-instruments-upload-file-input")).toBeInTheDocument();
    expect(screen.getByTestId("admin-instruments-upload-btn")).toBeDisabled(); // no file chosen yet
  });

  it("requires a confirmation step before actually uploading, and sends the right asset class + file, with removeMissing defaulting to false", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { summary: { assetClass: "REIT", fileName: "reits.csv", inserted: 1, updated: 0, removeMissingRequested: false, deletedFromPrevious: 0, retiredInsteadOfDeleted: 0, skipped: [], warnings: [] } } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));

    await userEvent.selectOptions(screen.getByTestId("admin-instruments-upload-class-select"), "REIT");
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));

    expect(api.post).not.toHaveBeenCalled(); // not yet — confirmation first
    expect(screen.getByTestId("admin-instruments-upload-confirm")).toHaveTextContent('updates matching REIT instruments and adds any new ones from "reits.csv". Nothing is removed.');

    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, formData, config] = api.post.mock.calls[0];
    expect(url).toBe("/admin/instruments/upload");
    expect(formData.get("assetClass")).toBe("REIT");
    expect(formData.get("file").name).toBe("reits.csv");
    expect(formData.get("removeMissing")).toBe("false");
    expect(config.headers["Content-Type"]).toBe("multipart/form-data");
  });

  it("checking 'also remove missing instruments' changes the confirmation wording and is sent as removeMissing=true", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { summary: { assetClass: "REIT", fileName: "reits.csv", inserted: 1, updated: 0, removeMissingRequested: true, deletedFromPrevious: 2, retiredInsteadOfDeleted: 0, skipped: [], warnings: [] } } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.selectOptions(screen.getByTestId("admin-instruments-upload-class-select"), "REIT");
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-removemissing-checkbox"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));

    expect(screen.getByTestId("admin-instruments-upload-confirm")).toHaveTextContent("removes any previously-uploaded REIT instrument not in this file");

    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1].get("removeMissing")).toBe("true");
  });

  it("cancelling the confirmation uploads nothing", async () => {
    mockLoadOk();
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-cancel-btn"));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByTestId("admin-instruments-upload-confirm")).not.toBeInTheDocument();
  });

  it("shows the summary after a successful upload with removeMissing checked, and reloads the instrument list", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({
      data: {
        summary: {
          assetClass: "BOND",
          fileName: "bonds.csv",
          inserted: 3,
          updated: 5,
          removeMissingRequested: true,
          deletedFromPrevious: 2,
          retiredInsteadOfDeleted: 1,
          skipped: [{ row: 4, message: "No name in this row — nothing to identify the instrument by, so it was skipped." }],
          warnings: [{ row: 2, message: '"price" value "abc" isn\'t a number — that one field was left blank, the rest of the row was kept.' }],
        },
      },
    });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    const loadCallsBefore = api.get.mock.calls.length;

    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile("bonds.csv"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-removemissing-checkbox"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));

    const summary = await screen.findByTestId("admin-instruments-upload-summary");
    expect(summary).toHaveTextContent('3 new BOND instruments added, 5 existing ones updated, from "bonds.csv"');
    expect(summary).toHaveTextContent("2 previously-uploaded rows not in this file removed");
    expect(summary).toHaveTextContent("1 kept (retired, not deleted) because a holding still references it");
    expect(screen.getByTestId("admin-instruments-upload-skipped")).toHaveTextContent("1 row skipped");
    expect(screen.getByTestId("admin-instruments-upload-skipped")).toHaveTextContent("Row 4: No name");
    expect(screen.getByTestId("admin-instruments-upload-warnings")).toHaveTextContent("Row 2:");
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(loadCallsBefore)); // list reloaded
  });

  it("without removeMissing, the summary says previously-uploaded instruments not in the file were left as-is", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({
      data: { summary: { assetClass: "BOND", fileName: "bonds.csv", inserted: 1, updated: 2, removeMissingRequested: false, deletedFromPrevious: 0, retiredInsteadOfDeleted: 0, skipped: [], warnings: [] } },
    });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile("bonds.csv"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));

    const summary = await screen.findByTestId("admin-instruments-upload-summary");
    expect(summary).toHaveTextContent("Any previously-uploaded BOND instrument not in this file was left as-is.");
  });

  it("shows a Look-Through Model draft note for a mutual fund upload with holdings data", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({
      data: {
        summary: {
          assetClass: "MUTUAL_FUND",
          fileName: "mf.csv",
          inserted: 1,
          updated: 0,
          removeMissingRequested: false,
          deletedFromPrevious: 0,
          retiredInsteadOfDeleted: 0,
          skipped: [],
          warnings: [],
          lookthrough: { fundsUpdated: 1, fundsSkippedNoWeight: 0, draftVersion: 3 },
        },
      },
    });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.selectOptions(screen.getByTestId("admin-instruments-upload-class-select"), "MUTUAL_FUND");
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile("mf.csv"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));

    const note = await screen.findByTestId("admin-instruments-upload-lookthrough-note");
    expect(note).toHaveTextContent("1 fund updated in the Look-Through Model's draft config");
    expect(note).toHaveTextContent("Review and publish from Look-Through Model");
  });

  it("caps the shown row-detail list with a 'show all' expander for a big file", async () => {
    mockLoadOk();
    const skipped = Array.from({ length: 40 }, (_, i) => ({ row: i + 2, message: "No name in this row." }));
    api.post.mockResolvedValue({ data: { summary: { assetClass: "MUTUAL_FUND", fileName: "mf.csv", inserted: 5, updated: 0, removeMissingRequested: false, deletedFromPrevious: 0, retiredInsteadOfDeleted: 0, skipped, warnings: [] } } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile("mf.csv"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));

    await screen.findByTestId("admin-instruments-upload-summary");
    expect(screen.getByTestId("admin-instruments-upload-skipped").querySelectorAll("li")).toHaveLength(15);
    expect(screen.getByTestId("admin-instruments-upload-skipped-more-btn")).toHaveTextContent("Show all 40");
    await userEvent.click(screen.getByTestId("admin-instruments-upload-skipped-more-btn"));
    expect(screen.getByTestId("admin-instruments-upload-skipped").querySelectorAll("li")).toHaveLength(40);
  });

  it("shows the backend's error message when the upload is refused (e.g. no usable rows)", async () => {
    mockLoadOk();
    api.post.mockRejectedValue({ response: { data: { message: "No row in this file had a usable name — nothing to upload." } } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-btn"));
    await userEvent.click(screen.getByTestId("admin-instruments-upload-confirm-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-instruments-upload-error")).toHaveTextContent("nothing to upload"));
    expect(screen.queryByTestId("admin-instruments-upload-summary")).not.toBeInTheDocument();
  });

  it("changing the target asset class resets any in-progress choice", async () => {
    mockLoadOk();
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("admin-instruments-upload-toggle-btn"));
    await userEvent.upload(screen.getByTestId("admin-instruments-upload-file-input"), csvFile());
    expect(screen.getByTestId("admin-instruments-upload-btn")).not.toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId("admin-instruments-upload-class-select"), "BOND");
    expect(screen.getByTestId("admin-instruments-upload-btn")).toBeDisabled(); // the file selection was cleared
  });
});
