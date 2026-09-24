import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/api";
import LandingPopupCard from "./LandingPopupCard";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// Pop-ups for LOGGED-OUT visitors on the landing page — fetched from the
// public /landing-popups, dismissed per browser SESSION (sessionStorage), so
// they come back in a new session but not on a plain reload.

const POPUP_A = { id: "a", title: "Spring sale", bodyHtml: 'Get <b>50% off</b> <a href="/?go=signup">Sign up</a>', version: 100 };
const POPUP_B = { id: "b", title: "Second notice", bodyHtml: "Body two", version: 200 };

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
});

it("renders nothing when no pop-up is active", async () => {
  api.get.mockResolvedValue({ data: { popups: [] } });
  render(<LandingPopupCard />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/landing-popups"));
  expect(screen.queryByTestId("landing-popup-card")).not.toBeInTheDocument();
});

it("shows the first active pop-up with its title and rendered body — no login involved", async () => {
  api.get.mockResolvedValue({ data: { popups: [POPUP_A, POPUP_B] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");
  expect(screen.getByTestId("landing-popup-title")).toHaveTextContent("Spring sale");
  expect(screen.getByTestId("landing-popup-body").querySelector("b")).toHaveTextContent("50% off");
  // it only ever calls the public endpoint
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
});

it("dismissing shows the next queued pop-up, and remembers the dismissal for this session", async () => {
  const user = userEvent.setup();
  api.get.mockResolvedValue({ data: { popups: [POPUP_A, POPUP_B] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");

  await user.click(screen.getByTestId("landing-popup-dismiss-btn"));
  await waitFor(() => expect(screen.getByTestId("landing-popup-title")).toHaveTextContent("Second notice"));
  expect(JSON.parse(sessionStorage.getItem("dive:landingPopupsDismissed"))).toEqual(["a:100"]);
});

it("does not show a pop-up already dismissed earlier in this session (e.g. after a reload)", async () => {
  sessionStorage.setItem("dive:landingPopupsDismissed", JSON.stringify(["a:100"]));
  api.get.mockResolvedValue({ data: { popups: [POPUP_A, POPUP_B] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");
  expect(screen.getByTestId("landing-popup-title")).toHaveTextContent("Second notice");
});

it("shows it again in a NEW session — sessionStorage starts empty", async () => {
  sessionStorage.setItem("dive:landingPopupsDismissed", JSON.stringify(["a:100"]));
  sessionStorage.clear(); // what a brand-new tab/session looks like
  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");
  expect(screen.getByTestId("landing-popup-title")).toHaveTextContent("Spring sale");
});

it("treats a re-activated (new version) pop-up as new even if the old version was dismissed this session", async () => {
  sessionStorage.setItem("dive:landingPopupsDismissed", JSON.stringify(["a:100"]));
  api.get.mockResolvedValue({ data: { popups: [{ ...POPUP_A, version: 999 }] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");
  expect(screen.getByTestId("landing-popup-title")).toHaveTextContent("Spring sale");
});

it("following a link inside the pop-up counts as dismissing it (and never blocks the navigation)", async () => {
  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");

  const link = screen.getByText("Sign up");
  const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(clickEvent);
  expect(clickEvent.defaultPrevented).toBe(false);
  await waitFor(() => expect(screen.queryByTestId("landing-popup-card")).not.toBeInTheDocument());
  expect(JSON.parse(sessionStorage.getItem("dive:landingPopupsDismissed"))).toEqual(["a:100"]);
});

it("degrades gracefully (shows nothing, doesn't crash) if the fetch fails", async () => {
  api.get.mockRejectedValue(new Error("network error"));
  render(<LandingPopupCard />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByTestId("landing-popup-card")).not.toBeInTheDocument();
});

it("the close (X) button dismisses it too", async () => {
  const user = userEvent.setup();
  api.get.mockResolvedValue({ data: { popups: [POPUP_A] } });
  render(<LandingPopupCard />);
  await screen.findByTestId("landing-popup-card");
  await user.click(screen.getByTestId("landing-popup-close-btn"));
  await waitFor(() => expect(screen.queryByTestId("landing-popup-card")).not.toBeInTheDocument());
});
