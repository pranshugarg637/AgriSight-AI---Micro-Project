import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "../i18n";
import DiagnosisCard from "../components/DiagnosisCard";
import SegmentationMetricsCard from "../components/SegmentationMetricsCard";
import ResultScreen from "../farmer/ResultScreen";
import * as apiClient from "../api/client";

const BASE = {
  diagnosis: "Late blight",
  crop: "Tomato",
  class_key: "Tomato___Late_blight",
  confidence: 0.93,
  confidence_level: "high",
  is_reliable: true,
  confidence_message: "High-confidence prediction.",
  alternatives: [],
  gradcam_image_base64: "R1JBRENBTQ==",
  gradcam_note: "Grad-CAM note",
  explanation: null,
  sources: [],
  retrieval_status: "insufficient_evidence",
  dataset_disclaimer: "disclaimer",
  segmentation_status: "model_not_available",
  lesion_mask_base64: null,
  severity_percent: null,
  severity_band: null,
  segmentation_note: "Severity is an estimate.",
};

const WITH_LESION = {
  ...BASE,
  segmentation_status: "success",
  lesion_mask_base64: "TEVTSU9O",
  severity_percent: 18.2,
  severity_band: "moderate",
};

beforeEach(() => vi.restoreAllMocks());

describe("DiagnosisCard affected-area section", () => {
  it("is hidden when segmentation did not succeed", () => {
    render(<DiagnosisCard result={BASE} originalPreviewUrl="blob:orig" />);
    expect(screen.queryByTestId("affected-area")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Affected area" })).not.toBeInTheDocument();
    // Grad-CAM view unchanged
    expect(screen.getByRole("button", { name: "Grad-CAM" })).toBeInTheDocument();
    expect(screen.getByAltText("Grad-CAM heatmap overlay on the leaf")).toHaveAttribute(
      "src",
      "data:image/png;base64,R1JBRENBTQ=="
    );
  });

  it("stays hidden if status is success but no mask came back", () => {
    render(<DiagnosisCard result={{ ...WITH_LESION, lesion_mask_base64: null }} originalPreviewUrl="blob:orig" />);
    expect(screen.queryByTestId("affected-area")).not.toBeInTheDocument();
  });

  it("shows severity, band and note, and toggles between lesion mask and Grad-CAM", () => {
    const { container } = render(<DiagnosisCard result={WITH_LESION} originalPreviewUrl="blob:orig" />);
    const box = screen.getByTestId("affected-area");
    expect(box).toHaveTextContent("About 18.2% of the leaf looks affected (moderate)");
    expect(box).toHaveTextContent("Severity is an estimate.");

    const img = () => container.querySelector(".gradcam__image");
    expect(img()).toHaveAttribute("src", "data:image/png;base64,TEVTSU9O");
    fireEvent.click(screen.getByRole("button", { name: "Grad-CAM" }));
    expect(img()).toHaveAttribute("src", "data:image/png;base64,R1JBRENBTQ==");
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(img()).toHaveAttribute("src", "blob:orig");
    fireEvent.click(screen.getByRole("button", { name: "Affected area" }));
    expect(img()).toHaveAttribute("src", "data:image/png;base64,TEVTSU9O");
  });

  it("explains when a percentage could not be estimated", () => {
    render(<DiagnosisCard result={{ ...WITH_LESION, severity_percent: null, severity_band: null }} originalPreviewUrl="x" />);
    expect(screen.getByTestId("affected-area")).toHaveTextContent(/too unclear to estimate a percentage/);
  });
});

describe("Farmer Mode severity line", () => {
  const gating = { band: "green", level: "high", showDisease: true, askQuestions: false, primaryHelp: "none" };
  const noop = () => {};
  const renderFarmer = (result, g = gating) =>
    render(
      <ResultScreen result={result} gating={g} bundle={null} photoUrl="blob:photo"
        onHelp={noop} onShopkeeper={noop} onQuestions={noop} onRestart={noop} />
    );

  it("shows one simple rounded line and a toggle when segmentation succeeded", () => {
    renderFarmer(WITH_LESION);
    expect(screen.getByTestId("farmer-severity")).toHaveTextContent("About 18% of the leaf looks affected (moderate)");
    fireEvent.click(screen.getByRole("button", { name: "Show affected area" }));
    expect(screen.getByAltText(/marked as diseased/)).toHaveAttribute("src", "data:image/png;base64,TEVTSU9O");
  });

  it("shows nothing extra when segmentation did not run", () => {
    renderFarmer(BASE);
    expect(screen.queryByTestId("farmer-severity")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show affected area" })).not.toBeInTheDocument();
  });

  it("hides the line when the disease itself is not shown", () => {
    renderFarmer(WITH_LESION, { ...gating, showDisease: false, band: "red", level: "unreliable" });
    expect(screen.queryByTestId("farmer-severity")).not.toBeInTheDocument();
  });
});

describe("SegmentationMetricsCard", () => {
  it("says 'Not trained yet' when there is no report", async () => {
    vi.spyOn(apiClient, "getSegmentationReport").mockResolvedValue(null);
    render(<SegmentationMetricsCard />);
    expect(await screen.findByText("Not trained yet")).toBeInTheDocument();
  });

  it("shows the saved report values as-is", async () => {
    vi.spyOn(apiClient, "getSegmentationReport").mockResolvedValue({
      dataset_name: "MyMaskedSet",
      n_test_images: 45,
      metrics: {
        n_images: 45, mean_dice: 0.8123, micro_dice: 0.8456, mean_iou: 0.7011,
        micro_precision: 0.83, micro_recall: 0.86,
        by_lesion_size: { small: { n_images: 10, mean_dice: 0.61 }, medium: { n_images: 0, mean_dice: null } },
      },
    });
    render(<SegmentationMetricsCard />);
    expect(await screen.findByText("MyMaskedSet")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("0.812")).toBeInTheDocument();
    expect(screen.getByText("0.846")).toBeInTheDocument();
    expect(screen.getByText(/0\.610 \(n=10\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Medium/)).not.toBeInTheDocument();
    expect(screen.getByText(/1\.0 = perfect/)).toBeInTheDocument();
  });

  it("shows an error line if the request fails", async () => {
    vi.spyOn(apiClient, "getSegmentationReport").mockRejectedValue(new Error("down"));
    render(<SegmentationMetricsCard />);
    expect(await screen.findByText("Could not load the segmentation report.")).toBeInTheDocument();
  });
});
