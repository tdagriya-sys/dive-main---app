import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/api";
import Instruments from "./Instruments";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const PAGE = {
  instruments: [{ _id: "i1", name: "Reliance Industries", symbol: "RELIANCE", assetClass: "EQUITY", source: "NSE", isActive: true, lastRefreshedAt: "2026-01-01T00:00:00.000Z" }],
  sources: ["NSE", "SEED"],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
};

describe("admin Instruments", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads and renders the instrument table", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-table")).toBeInTheDocument());
    expect(screen.getByText("Reliance Industries")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    api.get.mockResolvedValue({ data: { instruments: [], sources: [], page: 1, limit: 25, total: 0, totalPages: 1 } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-empty")).toBeInTheDocument());
  });

  it("triggering a refresh calls the endpoint and shows the result message", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: PAGE });
    api.post.mockResolvedValue({ data: { message: "Instrument refresh complete.", summary: [] } });
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-table")).toBeInTheDocument());

    await user.click(screen.getByTestId("admin-instruments-refresh-btn"));
    expect(api.post).toHaveBeenCalledWith("/admin/instruments/refresh");
    await waitFor(() => expect(screen.getByTestId("admin-instruments-refresh-message")).toHaveTextContent("Instrument refresh complete."));
  });

  it("shows a failure message if the refresh call fails", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: PAGE });
    api.post.mockRejectedValue(new Error("down"));
    render(<Instruments />);
    await waitFor(() => expect(screen.getByTestId("admin-instruments-table")).toBeInTheDocument());

    await user.click(screen.getByTestId("admin-instruments-refresh-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-instruments-refresh-message")).toHaveTextContent("Refresh failed"));
  });
});
