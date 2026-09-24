import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/api";
import UsersList from "./UsersList";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn() } }));

const PAGE = {
  users: [
    { id: "u1", name: "Asha Rao", email: "a***@example.com", mobile: "*******89", age: 29, status: "active", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
};

function renderWithRoute(initialEntry = "/admin/users") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/users" element={<UsersList />} />
        <Route path="/admin/users/:id" element={<div data-testid="landed-on-detail" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("admin UsersList", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads and renders the users table", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-users-table")).toBeInTheDocument());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("a***@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("admin-users-total")).toHaveTextContent("1 total");
  });

  it("shows an empty state when no users match", async () => {
    api.get.mockResolvedValue({ data: { users: [], page: 1, limit: 25, total: 0, totalPages: 1 } });
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-users-empty")).toBeInTheDocument());
  });

  it("clicking a row navigates to that user's detail page", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: PAGE });
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-users-row-u1")).toBeInTheDocument());
    await user.click(screen.getByTestId("admin-users-row-u1"));
    expect(await screen.findByTestId("landed-on-detail")).toBeInTheDocument();
  });

  it("re-fetches (debounced) when the search term changes", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: PAGE });
    renderWithRoute();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    await user.type(screen.getByTestId("admin-users-search-input"), "asha");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/users", { params: { q: "asha", page: 1 } }), { timeout: 2000 });
  });

  it("pagination buttons are disabled at the boundaries", async () => {
    api.get.mockResolvedValue({ data: PAGE }); // totalPages: 1
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-users-prev-btn")).toBeDisabled());
    expect(screen.getByTestId("admin-users-next-btn")).toBeDisabled();
  });
});
