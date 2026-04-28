import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OverviewPage } from "../pages/portal/Overview";

// Mock the queries module
vi.mock("../hooks/queries", () => ({
  useOverview: vi.fn(() => ({
    data: {
      total_configurations: 3,
      total_agents: 12,
      connected_agents: 8,
      total_active_tokens: 5,
    },
    isLoading: false,
  })),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("OverviewPage", () => {
  it("renders stat cards with data", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders navigation cards", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("🚀 Get Started")).toBeInTheDocument();
    expect(screen.getByText("☰ Configurations")).toBeInTheDocument();
  });
});
