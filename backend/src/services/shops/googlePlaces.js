import fetch from "node-fetch";
import { haversineMeters } from "../geo.js";

/**
 * Google Places (New) Text Search provider -- swap in with
 * SHOP_PROVIDER=google + GOOGLE_PLACES_API_KEY. Not exercised against the
 * live API in this repository (tests mock it); check Google's terms
 * (attribution, caching limits) before enabling.
 */
export class GooglePlacesShopProvider {
  constructor({ apiKey, timeoutMs = 15000, fetchImpl = fetch }) {
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required for SHOP_PROVIDER=google");
    this.name = "google_places";
    this.attribution = "Powered by Google";
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async search({ lat, lng, radiusM, limit }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.googleMapsUri",
        },
        body: JSON.stringify({
          textQuery: "agricultural input shop seeds fertilizer",
          maxResultCount: Math.min(limit, 20),
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const err = new Error(`shop provider responded ${response.status}`);
      err.code = "PROVIDER_ERROR";
      throw err;
    }
    const data = await response.json();
    return (data.places || [])
      .map((p) => ({
        id: `google:${p.id}`,
        name: p.displayName?.text || null,
        kind: "agri_input",
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        phone: p.nationalPhoneNumber || null,
        address: p.formattedAddress || null,
        opening_hours: null,
        distance_m: Math.round(haversineMeters(lat, lng, p.location?.latitude, p.location?.longitude)),
        map_url: p.googleMapsUri || null,
        source: "google_places",
      }))
      .filter((s) => Number.isFinite(s.distance_m))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);
  }
}
