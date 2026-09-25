import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import * as api from "../api/account";
import PlotsPage from "../pages/account/PlotsPage";
import PlotDetail from "../pages/account/PlotDetail";
import ExpertQueue from "../pages/account/ExpertQueue";
import RiskPanel from "../pages/account/RiskPanel";
import { renderWithProviders, DEMO_USER } from "../test-utils";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "fetchImageUrl").mockResolvedValue("blob:img");
});

const TIMELINE = {
  plot: { id: 3, name: "North field", crop: "Tomato", lat: null },
  timeline: [
    {
      id: 11, crop: "Tomato", diagnosis: "healthy", confidence: 0.9, confidence_level: "high", created_at: "2026-09-20T10:00:00Z",
      has_image: true, actions: [], followup: { outcome: "improved", basis: {} }, expert_label: null, disputed: false,
    },
    {
      id: 10, crop: "Tomato", diagnosis: "Late blight", confidence: 0.93, confidence_level: "high", created_at: "2026-09-10T10:00:00Z",
      has_image: true, actions: [{ id: 1, action_type: "removed_leaves", remind_at: "2026-09-17T10:00:00Z" }], followup: null,
      expert_label: "Tomato___Late_blight", disputed: false,
    },
  ],
};

describe("Account Mode pages", () => {
  it("creates a plot", async () => {
    vi.spyOn(api, "listPlots").mockResolvedValue({ plots: [] });
    const create = vi.spyOn(api, "createPlot").mockResolvedValue({ plot: { id: 1 } });
    renderWithProviders(<PlotsPage />, { user: DEMO_USER });
    fireEvent.change(await screen.findByLabelText("Plot name"), { target: { value: "North field" } });
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Tomato" } });
    fireEvent.click(screen.getByRole("button", { name: "Add plot" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "North field", crop: "Tomato" }));
    expect(screen.getByText(/coordinates are not stored unless/i)).toBeInTheDocument();
  });

  it("shows the plot timeline with follow-up outcome labelled indicative, actions and expert label", async () => {
    vi.spyOn(api, "getTimeline").mockResolvedValue(TIMELINE);
    const log = vi.spyOn(api, "logAction").mockResolvedValue({});
    renderWithProviders(
      <Routes>
        <Route path="/account/plots/:id" element={<PlotDetail />} />
      </Routes>,
      { route: "/account/plots/3", user: DEMO_USER }
    );
    expect(await screen.findByRole("heading", { name: "North field" })).toBeInTheDocument();
    expect(screen.getByText("Improved")).toBeInTheDocument();
    expect(screen.getAllByText(/indicative only/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/✔ Removed affected leaves/)).toBeInTheDocument();
    expect(screen.getByText(/Expert label/)).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("combobox", { name: /Log what you did/i })[0], { target: { value: "sprayed" } });
    await waitFor(() => expect(log).toHaveBeenCalledWith(11, { action_type: "sprayed", remind_in_days: 7 }));
  });

  it("risk panel calls it an indicator and shows the citation", async () => {
    vi.spyOn(api, "getRisk").mockResolvedValue({
      label: "risk indicator",
      disclaimer: "This is a weather-based risk indicator from documented conditions, not a prediction that the disease will appear.",
      weather_available: true,
      rules_available: 1,
      results: [
        {
          rule_id: "r1", class_key: "Tomato___Late_blight", description: "desc", source_is_placeholder: true,
          citation: { file: "tomato_late_blight_guide.pdf", page: 1, quote: "60 to 78 degrees" },
          days: [{ date: "2026-10-01", hours: 24, matching_hours: 5, level: "favourable_conditions_forecast" }],
        },
      ],
    });
    renderWithProviders(<RiskPanel plot={{ id: 3, lat: 26.8, lng: 80.9 }} />, { user: DEMO_USER });
    fireEvent.click(screen.getByRole("button", { name: "Check forecast" }));
    expect(await screen.findByText(/not a prediction/)).toBeInTheDocument();
    expect(screen.getByText("Favourable conditions forecast")).toBeInTheDocument();
    expect(screen.getByText(/60 to 78 degrees/)).toBeInTheDocument();
    expect(screen.getByText("placeholder source")).toBeInTheDocument();
    expect(screen.queryByText(/will get|prediction:/i)).not.toBeInTheDocument();
  });

  it("expert confirms or corrects a queued scan", async () => {
    vi.spyOn(api, "getExpertQueue").mockResolvedValue({
      queue: [{ id: 7, crop: "Tomato", diagnosis: "Late blight", class_key: "Tomato___Late_blight", confidence: 0.7, confidence_level: "low",
        alternatives: [{ disease: "Early blight", confidence: 0.25 }], sources: [], retrieval_status: "success", has_image: true, has_gradcam: true }],
    });
    const review = vi.spyOn(api, "reviewScan").mockResolvedValue({});
    renderWithProviders(<ExpertQueue />, { user: { ...DEMO_USER, role: "expert" } });
    expect(await screen.findByText(/Early blight 25%/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correct class key"), { target: { value: "Tomato___Early_blight" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith(7, { decision: "correct", corrected_class_key: "Tomato___Early_blight" }));
  });
});

describe("Admin monitoring", () => {
  it("renders headline numbers, per-day and per-class tables", async () => {
    const { default: AdminMonitor } = await import("../pages/account/AdminMonitor");
    vi.spyOn(api, "getAdminMetrics").mockResolvedValue({
      total_scans: 3,
      share_low_or_unreliable: 0.5,
      ood_rejections: 1,
      scans_per_day: [{ date: "2026-09-20", farmer: 2, account: 1 }],
      confidence_levels: { high: { n: 1, share: 0.33 } },
      unreliable_reasons: { not_a_leaf: 1 },
      retrieval_status: { success: 2 },
      per_class: [{ class_key: "Tomato___Late_blight", n: 2, mean_confidence: 0.8, share_low_or_unreliable: 0.5, weekly: [{ week: "2026-W38", n: 2, mean_confidence: 0.8 }] }],
      expert_labels: { n_reviewed: 2, accuracy: 0.5, note: "biased sample" },
    });
    renderWithProviders(<AdminMonitor />, { user: { ...DEMO_USER, role: "admin" } });
    expect(await screen.findByText("Tomato___Late_blight")).toBeInTheDocument();
    expect(screen.getByText(/Accuracy vs expert labels \(n=2\)/)).toBeInTheDocument();
    expect(screen.getByText("2026-09-20")).toBeInTheDocument();
    expect(screen.getByText(/biased sample/)).toBeInTheDocument();
  });
});
