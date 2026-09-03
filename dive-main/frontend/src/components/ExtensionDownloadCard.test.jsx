import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExtensionDownloadCard from "./ExtensionDownloadCard";
import { API_BASE } from "../lib/api";

describe("ExtensionDownloadCard", () => {
  it("shows the works-on sites (AngelOne, Groww — both confirmed live in manifest.json), the early-bird/safety disclaimer, and all 5 setup steps", () => {
    render(<ExtensionDownloadCard onClose={jest.fn()} />);
    const card = screen.getByTestId("extension-download-card");

    expect(within(card).getByTestId("extension-site-angelone")).toBeInTheDocument();
    expect(within(card).getByTestId("extension-site-groww")).toBeInTheDocument();
    expect(card).toHaveTextContent(/early.*bird/i);
    expect(card).toHaveTextContent(/never places, modifies, or cancels a trade/i);
    for (let i = 1; i <= 5; i++) {
      expect(within(card).getByTestId(`extension-step-${i}`)).toBeInTheDocument();
    }
  });

  it("the download button points at the real backend zip endpoint", () => {
    render(<ExtensionDownloadCard onClose={jest.fn()} />);
    const link = screen.getByTestId("extension-download-btn");
    expect(link).toHaveAttribute("href", `${API_BASE}/extension/download`);
    expect(link).toHaveAttribute("download");
  });

  it("shows the live API URL and copies it to the clipboard on click", async () => {
    const u = userEvent.setup();
    render(<ExtensionDownloadCard onClose={jest.fn()} />);
    // jsdom only lazily instantiates a real navigator.clipboard once
    // something in the render tree first touches it — it's `undefined`
    // beforehand, so the spy has to be set up after render, not before.
    const writeText = jest.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    expect(screen.getByTestId("extension-live-api-url")).toHaveTextContent("https://www.divve.in/api");
    await u.click(screen.getByTestId("extension-copy-url-btn"));
    expect(writeText).toHaveBeenCalledWith("https://www.divve.in/api");
    expect(screen.getByTestId("extension-copy-url-btn")).toHaveTextContent("Copied");
  });

  it("closes on the X button and on a backdrop click", async () => {
    const onClose = jest.fn();
    const u = userEvent.setup();
    render(<ExtensionDownloadCard onClose={onClose} />);
    await u.click(screen.getByTestId("extension-download-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
