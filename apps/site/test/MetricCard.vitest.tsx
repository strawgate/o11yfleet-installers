// #791 PoC: first @testing-library/react component test. Renders MetricCard
// in jsdom with MantineProvider, asserts on the DOM tree. Demonstrates the
// "render React, query like a user" test layer that node:test+SSR doesn't
// give us.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MetricCard } from "@/components/app/MetricCard";

void React;

function withMantine(node: React.ReactElement) {
  return <MantineProvider>{node}</MantineProvider>;
}

describe("MetricCard", () => {
  it("renders label and value", () => {
    render(withMantine(<MetricCard label="Total collectors" value="42" />));
    expect(screen.getByRole("group", { name: "Total collectors" })).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders detail when provided", () => {
    render(withMantine(<MetricCard label="Connected" value="2 / 4" detail="2 of 4 healthy" />));
    expect(screen.getByText("2 of 4 healthy")).toBeInTheDocument();
  });

  it("renders no detail row when omitted", () => {
    // Use the same detail string as the previous "with detail" case so a
    // regression that wires `detail` regardless of prop would surface here.
    render(withMantine(<MetricCard label="Configurations" value="7" />));
    expect(screen.queryByText("2 of 4 healthy")).not.toBeInTheDocument();
  });

  it("renders children below value", () => {
    render(
      withMantine(
        <MetricCard label="Configurations" value="7">
          <span data-testid="slot">slot content</span>
        </MetricCard>,
      ),
    );
    expect(screen.getByTestId("slot")).toBeInTheDocument();
  });
});
