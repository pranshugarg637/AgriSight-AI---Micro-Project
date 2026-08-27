import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../App";
import * as apiClient from "../api/client";

const HIGH_CONFIDENCE_RESULT = {
  diagnosis: "Late blight",
  crop: "Tomato",
  confidence: 0.91,
  confidence_level: "high",
  is_reliable: true,
  confidence_message: "High-confidence prediction.",
  alternatives: [{ crop: "Tomato", disease: "Early blight", confidence: 0.06 }],
  gradcam_image_base64: "ZmFrZWJhc2U2NA==",
  gradcam_note: "Highlighted regions indicate areas that influenced the model's prediction.",
  explanation: "## What is happening?\nYour plant has late blight.\n## Important caution\nConsult an expert.",
  sources: [
    {
      title: "Tomato Late Blight Guide",
      organization: "Sample Extension",
      page: 1,
      source_url: "",
      relevance_score: 0.8,
      excerpt: "Late blight spreads in cool wet weather.",
    },
  ],
  retrieval_status: "success",
  model_version: "1.0.0",
  dataset_disclaimer: "Trained on PlantVillage; real-world performance may differ.",
};

const UNRELIABLE_RESULT = {
  diagnosis: "healthy",
  crop: "Tomato",
  confidence: 0.42,
  confidence_level: "unreliable",
  is_reliable: false,
  confidence_message: "Unable to provide a reliable diagnosis from this image. Please upload a clearer, well-lit photo of the affected leaf.",
  alternatives: [],
  gradcam_image_base64: null,
  gradcam_note: "",
  explanation: null,
  sources: [],
  retrieval_status: "skipped_low_confidence",
  model_version: "1.0.0",
  dataset_disclaimer: "Trained on PlantVillage; real-world performance may differ.",
};

function makeFile() {
  return new File(["fake-image-content"], "leaf.jpg", { type: "image/jpeg" });
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("App upload + diagnosis flow", () => {
  it("renders the empty state initially", () => {
    render(<App />);
    expect(screen.getByText(/Upload a leaf photo to begin/i)).toBeInTheDocument();
  });

  it("shows a loading state while analyzing", async () => {
    vi.spyOn(apiClient, "predictDisease").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(HIGH_CONFIDENCE_RESULT), 100))
    );

    render(<App />);
    const fileInput = screen.getByLabelText(/Upload a leaf photo/i);
    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    const submitButton = screen.getByRole("button", { name: /Diagnose specimen/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Running specialized CNN classification/i)).toBeInTheDocument();
  });

  it("renders a high-confidence diagnosis result with sources", async () => {
    vi.spyOn(apiClient, "predictDisease").mockResolvedValue(HIGH_CONFIDENCE_RESULT);

    render(<App />);
    fireEvent.change(screen.getByLabelText(/Upload a leaf photo/i), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /Diagnose specimen/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Late blight" })).toBeInTheDocument());
    expect(screen.getByText("Tomato")).toBeInTheDocument();
    expect(screen.getByText(/Tomato Late Blight Guide/i)).toBeInTheDocument();
    expect(screen.getByText(/Sample Extension/i)).toBeInTheDocument();
  });

  it("renders the low-confidence / unreliable state distinctly, without sources", async () => {
    vi.spyOn(apiClient, "predictDisease").mockResolvedValue(UNRELIABLE_RESULT);

    render(<App />);
    fireEvent.change(screen.getByLabelText(/Upload a leaf photo/i), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /Diagnose specimen/i }));

    await waitFor(() => expect(screen.getByText("Diagnosis unavailable")).toBeInTheDocument());
    expect(screen.getByText(/upload a clearer, well-lit photo/i)).toBeInTheDocument();
    // Sources/differential should not render in the unreliable state
    expect(screen.queryByText(/Differential diagnosis/i)).not.toBeInTheDocument();
  });

  it("shows an error message when the API call fails", async () => {
    vi.spyOn(apiClient, "predictDisease").mockRejectedValue(
      new apiClient.ApiError("The ML service is unreachable.", 503)
    );

    render(<App />);
    fireEvent.change(screen.getByLabelText(/Upload a leaf photo/i), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /Diagnose specimen/i }));

    await waitFor(() => expect(screen.getByText(/Could not complete diagnosis/i)).toBeInTheDocument());
    expect(screen.getByText(/The ML service is unreachable/i)).toBeInTheDocument();
  });

  it("rejects unsupported file types client-side before submission is possible", () => {
    render(<App />);
    const badFile = new File(["not an image"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/Upload a leaf photo/i), { target: { files: [badFile] } });

    expect(screen.getByRole("alert")).toHaveTextContent(/JPEG, PNG, or WebP/i);
    expect(screen.getByRole("button", { name: /Diagnose specimen/i })).toBeDisabled();
  });
});
