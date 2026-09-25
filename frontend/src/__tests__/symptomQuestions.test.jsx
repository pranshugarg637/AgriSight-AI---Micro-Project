import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SymptomQuestions from "../farmer/SymptomQuestions";
import * as api from "../farmer/api";

const RESULT = {
  class_key: "Tomato___Late_blight",
  crop: "Tomato",
  diagnosis: "Late blight",
  confidence: 0.55,
  confidence_level: "low",
  retrieval_status: "success",
  question_pair: "tomato_early_blight__vs__tomato_late_blight",
  top_candidates: [
    { class_key: "Tomato___Late_blight", probability: 0.55 },
    { class_key: "Tomato___Early_blight", probability: 0.41 },
  ],
};
const QSET = {
  audio_slug: "q_tomato_early_blight_vs_tomato_late_blight",
  questions: [
    { id: "q1", text: "Rings like a target?" },
    { id: "q2", text: "White fuzzy growth below?" },
  ],
};

beforeEach(() => vi.restoreAllMocks());

describe("SymptomQuestions", () => {
  it("speaks each question, collects yes/no/unsure and applies the refined result", async () => {
    vi.spyOn(api, "getQuestions").mockResolvedValue(QSET);
    const refine = vi.spyOn(api, "refineDiagnosis").mockResolvedValue({
      class_key: "Tomato___Early_blight",
      crop: "Tomato",
      diagnosis: "Early blight",
      confidence: 0.86,
      confidence_level: "high",
      candidates: [
        { class_key: "Tomato___Early_blight", probability: 0.86 },
        { class_key: "Tomato___Late_blight", probability: 0.1 },
      ],
    });
    const player = { play: vi.fn() };
    const onDone = vi.fn();
    render(<SymptomQuestions result={RESULT} player={player} onDone={onDone} onCancel={() => {}} />);
    expect(await screen.findByText("Rings like a target?")).toBeInTheDocument();
    expect(player.play).toHaveBeenCalledWith(["en.q_tomato_early_blight_vs_tomato_late_blight.q1"]);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("White fuzzy growth below?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(refine.mock.calls[0][1]).toEqual({ q1: "yes", q2: "unsure" });
    const merged = onDone.mock.calls[0][0];
    expect(merged.class_key).toBe("Tomato___Early_blight");
    expect(merged.confidence_level).toBe("high");
    expect(merged.refined).toBe(true);
    expect(merged.question_pair).toBeNull();
    expect(merged.retrieval_status).toBe("success");
  });

  it("shows an error when no question set exists", async () => {
    vi.spyOn(api, "getQuestions").mockRejectedValue(new Error("404"));
    render(<SymptomQuestions result={RESULT} player={null} onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not available/i);
  });
});
