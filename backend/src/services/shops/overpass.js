import fetch from "node-fetch";
import { haversineMeters, osmMapUrl } from "../geo.js";

/**
 * OpenStreetMap Overpass provider (no API key). Searches for agricultural
 * input shops (shop=agrarian: seeds, fertiliser, pesticides, tools) and
 * garden centres around a point. Respect the Overpass usage policy: results
 * are cached by the caller, requests carry a descriptive User-Agent, and
 * the UI shows "© OpenStreetMap contributors" (ODbL).
 */
export class OverpassShopProvider {
  constructor({ url, userAgent, timeoutMs = 15000, fetchImpl = fetch }) {
    this.name = "overpass";
    this.attribution = "© OpenStreetMap contributors (ODbL) — data via Overpass API";
    this.url = url;
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  buildQuery(lat, lng, radiusM) {
    const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
    return `[out:json][timeout:${Math.ceil(this.timeoutMs / 1000)}];(
node["shop"="agrarian"]${around};way["shop"="agrarian"]${around};
node["shop"="garden_centre"]${around};way["shop"="garden_centre"]${around};
);out center tags 60;`;
  }

  async search({ lat, lng, radiusM, limit }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.userAgent },
        body: new URLSearchParams({ data: this.buildQuery(lat, lng, radiusM) }).toString(),
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
    return (data.elements || [])
      .map((el) => {
        const t = el.tags || {};
        const plat = el.lat ?? el.center?.lat;
        const plng = el.lon ?? el.center?.lon;
        if (!Number.isFinite(plat) || !Number.isFinite(plng)) return null;
        const address = [t["addr:housenumber"], t["addr:street"], t["addr:place"] || t["addr:village"], t["addr:city"] || t["addr:district"]]
          .filter(Boolean)
          .join(", ");
        return {
          id: `osm:${el.type}/${el.id}`,
          name: t.name || t["name:en"] || null,
          kind: t.shop === "agrarian" ? "agri_input" : "garden_centre",
          lat: plat,
          lng: plng,
          phone: t.phone || t["contact:phone"] || null,
          address: address || null,
          opening_hours: t.opening_hours || null,
          distance_m: Math.round(haversineMeters(lat, lng, plat, plng)),
          map_url: osmMapUrl(plat, plng),
          source: "openstreetmap",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);
  }
}
