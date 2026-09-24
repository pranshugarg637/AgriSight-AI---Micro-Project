import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HelpFinder from "../farmer/HelpFinder";
import * as api from "../farmer/api";

const OFFICE = { name: "Test KVK", type: "kvk", district: "Lucknow", phone: "+91 000", distance_m: 1200, map_url: "https://osm/x" };
const SHOP = { id: "osm:1", name: "Kisan Seva Kendra", distance_m: 800, phone: "+91 111", map_url: "https://osm/y" };

beforeEach(() => vi.restoreAllMocks());

describe("HelpFinder", () => {
  it("asks for consent (spoken + visual) before touching location", () => {
    const geo = vi.spyOn(api, "getPositionOnce");
    const say = vi.fn();
    render(<HelpFinder primary="office" onBack={() => {}} say={say} />);
    expect(say).toHaveBeenCalledWith("location_consent");
    expect(screen.getByText(/needs your location one time/i)).toBeInTheDocument();
    expect(geo).not.toHaveBeenCalled();
  });

  it("consent denied -> district picker path (no geolocation call)", async () => {
    const geo = vi.spyOn(api, "getPositionOnce");
    vi.spyOn(api, "getHelpIndex").mockResolvedValue({ states: [{ state_slug: "up", state: "Uttar Pradesh", districts: ["Lucknow"] }] });
    vi.spyOn(api, "getHelpCenters").mockResolvedValue({ centers: [OFFICE] });
    render(<HelpFinder primary="office" onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /No, I will choose/i }));
    fireEvent.change(await screen.findByRole("combobox", { name: "State" }), { target: { value: "up" } });
    fireEvent.change(screen.getByRole("combobox", { name: "District" }), { target: { value: "Lucknow" } });
    fireEvent.click(screen.getByRole("button", { name: /Show offices/i }));
    expect(await screen.findByText("Test KVK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call/i })).toHaveAttribute("href", "tel:+91000");
    expect(geo).not.toHaveBeenCalled();
  });

  it("no curated data -> honest message instead of invented offices", async () => {
    vi.spyOn(api, "getHelpIndex").mockResolvedValue({ states: [] });
    render(<HelpFinder onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /No, I will choose/i }));
    expect(await screen.findByText(/No agriculture office list for your area/i)).toBeInTheDocument();
  });

  it("location allowed -> shops with stock disclaimer + attribution; office first for low confidence", async () => {
    vi.spyOn(api, "getPositionOnce").mockResolvedValue({ lat: 26.8, lng: 80.9 });
    vi.spyOn(api, "getShops").mockResolvedValue({ shops: [SHOP], offices: [OFFICE], office_fallback: false, attribution: "© OpenStreetMap contributors" });
    const say = vi.fn();
    render(<HelpFinder primary="office" onBack={() => {}} say={say} />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, use my location/i }));
    expect(await screen.findByText("Kisan Seva Kendra")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/may not have the product/i);
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Agriculture offices", "Agri-input shops"]);
    expect(say).toHaveBeenCalledWith("stock_disclaimer");
  });

  it("high confidence with cited advice -> shops listed first", async () => {
    vi.spyOn(api, "getPositionOnce").mockResolvedValue({ lat: 1, lng: 2 });
    vi.spyOn(api, "getShops").mockResolvedValue({ shops: [SHOP], offices: [OFFICE], office_fallback: false });
    render(<HelpFinder primary="shops" onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, use my location/i }));
    await screen.findByText("Kisan Seva Kendra");
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Agri-input shops", "Agriculture offices"]);
  });

  it("no shops found -> office fallback message and spoken prompt", async () => {
    vi.spyOn(api, "getPositionOnce").mockResolvedValue({ lat: 1, lng: 2 });
    vi.spyOn(api, "getShops").mockResolvedValue({ shops: [], offices: [OFFICE], office_fallback: true });
    const say = vi.fn();
    render(<HelpFinder primary="shops" onBack={() => {}} say={say} />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, use my location/i }));
    expect(await screen.findByText(/No shops were found nearby/i)).toBeInTheDocument();
    expect(screen.getByText("Test KVK")).toBeInTheDocument();
    expect(say).toHaveBeenCalledWith("no_shops_found");
  });

  it("location error -> manual picker", async () => {
    vi.spyOn(api, "getPositionOnce").mockRejectedValue(new Error("denied"));
    vi.spyOn(api, "getHelpIndex").mockResolvedValue({ states: [] });
    render(<HelpFinder onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, use my location/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not get your location/i);
    await waitFor(() => expect(screen.getByText(/type your village/i)).toBeInTheDocument());
  });
});
