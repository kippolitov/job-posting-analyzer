import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArrangementBadge } from "../../components/JobPanel/ArrangementBadge";

describe("ArrangementBadge", () => {
  it("renders Remote", () => {
    render(<ArrangementBadge arrangement="remote" daysInOffice={null} daysRemote={null} />);
    expect(screen.getByText("Remote")).toBeInTheDocument();
  });

  it("renders On-site", () => {
    render(<ArrangementBadge arrangement="onsite" daysInOffice={null} daysRemote={null} />);
    expect(screen.getByText("On-site")).toBeInTheDocument();
  });

  it("renders Unspecified rather than guessing", () => {
    render(
      <ArrangementBadge arrangement="unspecified" daysInOffice={null} daysRemote={null} />
    );
    expect(screen.getByText("Unspecified")).toBeInTheDocument();
  });

  it("renders hybrid day counts when known", () => {
    render(<ArrangementBadge arrangement="hybrid" daysInOffice={3} daysRemote={2} />);
    expect(screen.getByText("Hybrid · 3 days office / 2 remote")).toBeInTheDocument();
  });

  it("renders plain Hybrid when day counts are unknown", () => {
    render(<ArrangementBadge arrangement="hybrid" daysInOffice={null} daysRemote={null} />);
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
  });

  it("uses singular day and carries an accessible label", () => {
    render(<ArrangementBadge arrangement="hybrid" daysInOffice={1} daysRemote={null} />);
    expect(
      screen.getByLabelText("Work arrangement: Hybrid · 1 day office")
    ).toBeInTheDocument();
  });
});
