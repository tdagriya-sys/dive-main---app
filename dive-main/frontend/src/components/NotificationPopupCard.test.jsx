import React from "react";
import { render, screen, waitFor, waitForElementToBeRemoved, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/api";
import NotificationPopupCard from "./NotificationPopupCard";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// The "popup" delivery channel's own display surface (see backend/src/
// models/NotificationCategory.ts::NotificationChannel) — a one-time modal
// shown on Home mount, fed by GET /notifications/popups and dismissed via
// the same POST /notifications/:id/read the bell already uses.

const POPUP_A = { id: "p1", title: "Your plan renews soon", bodyHtml: "You'll be charged <b>₹119</b>.", link: "/subscription", deliveredAt: "2026-01-01" };
const POPUP_B = { id: "p2", title: "Second notice", bodyHtml: "Body two", deliveredAt: "2026-01-02" };

beforeEach(() => {
  jest.clearAllMocks();
});

it("renders nothing while the fetch is still pending or returns no popups", async () => {
  api.get.mockResolvedValue({ data: { popups: [] } });
  render(<NotificationPopupCard suppressed={false} />);
  expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/notifications/popups"));
  expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();
});

it("shows the oldest unread popup with its title and rendered bodyHtml", async () => {
  api.get.mockResolvedValue({ data: { popups: [POPUP_A, POPUP_B] } });
  render(<NotificationPopupCard suppressed={false} />);

  await screen.findByTestId("notification-popup-card");
  expect(screen.getByTestId("notification-popup-title")).toHaveTextContent("Your plan renews soon");
  expect(screen.getByTestId("notification-popup-body").innerHTML).toBe("You'll be charged <b>₹119</b>.");
});

it("never renders while suppressed, even with popups pending, and appears once no longer suppressed", async () => {
  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  const { rerender } = render(<NotificationPopupCard suppressed={true} />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();

  rerender(<NotificationPopupCard suppressed={false} />);
  await screen.findByTestId("notification-popup-card");
});

it("dismissing marks it read via the same endpoint the bell uses, then advances to the next queued popup", async () => {
  const user = userEvent.setup();
  api.get.mockResolvedValue({ data: { popups: [POPUP_A, POPUP_B] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  render(<NotificationPopupCard suppressed={false} />);

  await screen.findByTestId("notification-popup-card");
  expect(screen.getByTestId("notification-popup-title")).toHaveTextContent("Your plan renews soon");

  await user.click(screen.getByTestId("notification-popup-dismiss-btn"));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/notifications/p1/read"));

  // The next popup in the queue takes over immediately (no re-fetch needed —
  // the whole unread batch was already fetched up front).
  await screen.findByTestId("notification-popup-title");
  expect(screen.getByTestId("notification-popup-title")).toHaveTextContent("Second notice");
});

it("the close (X) button dismisses it the same way as the primary button", async () => {
  const user = userEvent.setup();
  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  render(<NotificationPopupCard suppressed={false} />);

  await screen.findByTestId("notification-popup-card");
  await user.click(screen.getByTestId("notification-popup-close-btn"));
  await waitForElementToBeRemoved(() => screen.queryByTestId("notification-popup-card"));
  expect(api.post).toHaveBeenCalledWith("/notifications/p1/read");
});

it("degrades gracefully (shows nothing, doesn't crash) if the fetch fails", async () => {
  api.get.mockRejectedValue(new Error("network error"));
  render(<NotificationPopupCard suppressed={false} />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();
});

it("polls for a newly-sent popup every 20s, without needing a page refresh", async () => {
  jest.useFakeTimers();
  api.get.mockResolvedValue({ data: { popups: [] } });
  render(<NotificationPopupCard suppressed={false} />);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();

  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  act(() => {
    jest.advanceTimersByTime(20000);
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId("notification-popup-title")).toHaveTextContent("Your plan renews soon"));

  jest.useRealTimers();
});

it("following a link/button inside the pop-up marks it read (and never blocks the navigation)", async () => {
  api.get.mockResolvedValue({ data: { popups: [{ ...POPUP_A, bodyHtml: 'Hi <a href="/?go=signup">Get started</a>' }] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  render(<NotificationPopupCard suppressed={false} />);
  await screen.findByTestId("notification-popup-card");

  const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByText("Get started").dispatchEvent(clickEvent);
  expect(clickEvent.defaultPrevented).toBe(false);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/notifications/p1/read"));
  await waitFor(() => expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument());
});

it("stops polling once unmounted", async () => {
  jest.useFakeTimers();
  api.get.mockResolvedValue({ data: { popups: [] } });
  const { unmount } = render(<NotificationPopupCard suppressed={false} />);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  unmount();
  act(() => {
    jest.advanceTimersByTime(60000);
  });
  expect(api.get).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
