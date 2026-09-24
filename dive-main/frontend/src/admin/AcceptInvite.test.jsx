import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import AcceptInvite from "./AcceptInvite";

// AcceptInvite.jsx creates its own axios instance at module-load time
// (`const publicApi = axios.create(...)`, deliberately bypassing the shared
// `api` singleton's auth interceptor — see the component's own comment), so
// the mock's `create()` must return one STABLE object from the very first
// call — lib/api.js's own module-level `axios.create(...)` (triggered
// transitively via AcceptInvite's `API_BASE` import) also needs that same
// call to succeed, since it immediately wires up `.interceptors.*.use(...)`.
jest.mock("axios", () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { create: jest.fn(() => instance), __mockInstance: instance };
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AcceptInvite />
    </MemoryRouter>
  );
}

describe("AcceptInvite", () => {
  const publicApi = axios.__mockInstance;
  afterEach(() => {
    publicApi.get.mockReset();
    publicApi.post.mockReset();
  });

  it("shows an invalid-invite message when the token doesn't resolve", async () => {
    publicApi.get.mockRejectedValue(new Error("not found"));
    renderAt("/admin/accept-invite?token=bad");
    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-invalid")).toBeInTheDocument());
  });

  it("previews the invite (email + role) once the token resolves", async () => {
    publicApi.get.mockResolvedValue({ data: { email: "new@example.com", staffRole: "admin" } });
    renderAt("/admin/accept-invite?token=good");
    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-preview")).toHaveTextContent("new@example.com"));
    expect(screen.getByText("Join Divve as admin")).toBeInTheDocument();
    expect(publicApi.get).toHaveBeenCalledWith("/auth/staff/invite/good");
  });

  it("submits the form and shows success", async () => {
    publicApi.get.mockResolvedValue({ data: { email: "new@example.com", staffRole: "admin" } });
    publicApi.post.mockResolvedValue({ data: { message: "ok", email: "new@example.com" } });
    renderAt("/admin/accept-invite?token=good");
    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-name-input")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-accept-invite-name-input"), { target: { value: "New Admin" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-mobile-input"), { target: { value: "9800000001" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-age-input"), { target: { value: "30" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-password-input"), { target: { value: "Passw0rd!" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-confirmpassword-input"), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByTestId("admin-accept-invite-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-success")).toBeInTheDocument());
    expect(publicApi.post).toHaveBeenCalledWith("/auth/staff/accept-invite", {
      token: "good", name: "New Admin", mobile: "9800000001", age: "30", password: "Passw0rd!", confirmPassword: "Passw0rd!",
    });
    expect(screen.getByTestId("admin-accept-invite-login-link")).toHaveAttribute("href", "/admin");
  });

  it("shows the backend's error message on a failed submission", async () => {
    publicApi.get.mockResolvedValue({ data: { email: "new@example.com", staffRole: "admin" } });
    publicApi.post.mockRejectedValue({ response: { data: { message: "Passwords do not match" } } });
    renderAt("/admin/accept-invite?token=good");
    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-name-input")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-accept-invite-name-input"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-mobile-input"), { target: { value: "9800000001" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-age-input"), { target: { value: "30" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-password-input"), { target: { value: "Passw0rd!" } });
    fireEvent.change(screen.getByTestId("admin-accept-invite-confirmpassword-input"), { target: { value: "Different1!" } });
    fireEvent.click(screen.getByTestId("admin-accept-invite-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-accept-invite-error")).toHaveTextContent("Passwords do not match"));
  });
});
