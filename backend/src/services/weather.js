import fetch from "node-fetch";
import { config } from "../config/index.js";
import { roundCoord, TtlCache } from "./geo.js";

/**
 * Hourly forecast behind a small interface: forecast(lat, lng) ->
 * { available, source, hourly:[{time, temperature_c, relative_humidity, precipitation_mm}] }.
 * Outages never throw to the caller (available:false + reason).
 */
export class OpenMeteoProvider {
  constructor({ url = config.weather.openMeteoUrl, timeoutMs = config.weather.timeoutMs, fetchImpl = fetch } = {}) {
    this.name = "open-meteo";
    this.attribution = "Weather data by Open-Meteo.com (CC BY 4.0)";
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async forecast(lat, lng, days = 7) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      hourly: "temperature_2m,relative_humidity_2m,precipitation",
      forecast_days: String(days),
      timezone: "auto",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(`${this.url}?${params}`, { signal: controller.signal });
      if (!res.ok) throw Object.assign(new Error(`weather ${res.status}`), { code: "PROVIDER_ERROR" });
      const data = await res.json();
      const h = data.hourly || {};
      const hourly = (h.time || []).map((time, i) => ({
        time,
        temperature_c: h.temperature_2m?.[i] ?? null,
        relative_humidity: h.relative_humidity_2m?.[i] ?? null,
        precipitation_mm: h.precipitation?.[i] ?? null,
      }));
      return { available: true, source: this.name, attribution: this.attribution, hourly };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WeatherService {
  constructor(provider = new OpenMeteoProvider(), ttlSeconds = config.weather.cacheTtlSeconds) {
    this.provider = provider;
    this.cache = new TtlCache(ttlSeconds);
  }

  async forecast(lat, lng, days = 7) {
    const rlat = roundCoord(lat, 2);
    const rlng = roundCoord(lng, 2);
    const key = `${rlat},${rlng},${days}`;
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };
    try {
      const out = await this.provider.forecast(rlat, rlng, days);
      this.cache.set(key, out);
      return { ...out, cached: false };
    } catch (err) {
      console.warn(`[weather] provider ${this.provider.name} failed: ${err.code || err.name || "error"}`);
      return { available: false, source: this.provider.name, reason: "weather_unavailable", hourly: [] };
    }
  }
}
