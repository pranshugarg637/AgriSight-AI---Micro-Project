import fetch from "node-fetch";
import { config } from "../config/index.js";
import { TtlCache } from "./geo.js";

/**
 * Village/district name -> coordinates via OpenStreetMap Nominatim (for
 * farmers who decline location access). Usage policy: <= 1 request/second,
 * descriptive User-Agent, cache results. Only the typed place name is sent.
 */
export class NominatimGeocoder {
  constructor({ baseUrl = "https://nominatim.openstreetmap.org/search", userAgent = config.help.providerUserAgent, timeoutMs = config.help.providerTimeoutMs, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl;
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.cache = new TtlCache(7 * 86400);
    this.lastCall = 0;
    this.attribution = "© OpenStreetMap contributors (ODbL) — geocoding via Nominatim";
  }

  async search(q) {
    const query = String(q).trim().slice(0, 120);
    const key = query.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const wait = this.lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    const url = `${this.baseUrl}?${new URLSearchParams({ q: query, format: "jsonv2", countrycodes: "in", limit: "5", addressdetails: "0" })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(url, { headers: { "User-Agent": this.userAgent }, signal: controller.signal });
      if (!res.ok) throw Object.assign(new Error(`geocoder ${res.status}`), { code: "PROVIDER_ERROR" });
      const rows = await res.json();
      const out = rows.map((r) => ({ name: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));
      this.cache.set(key, out);
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
