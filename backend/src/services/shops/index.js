import { config } from "../../config/index.js";
import { roundCoord, TtlCache } from "../geo.js";
import { OverpassShopProvider } from "./overpass.js";
import { GooglePlacesShopProvider } from "./googlePlaces.js";

export function createShopProvider(name = config.help.shopProvider) {
  if (name === "google") {
    return new GooglePlacesShopProvider({ apiKey: config.help.googlePlacesApiKey, timeoutMs: config.help.providerTimeoutMs });
  }
  return new OverpassShopProvider({
    url: config.help.overpassUrl,
    userAgent: config.help.providerUserAgent,
    timeoutMs: config.help.providerTimeoutMs,
  });
}

/**
 * Wraps a provider with: coordinate rounding (~110 m) before anything leaves
 * the server, an in-memory TTL cache keyed on the rounded point (so repeated
 * requests from the same village do not hit the provider), and error
 * isolation (provider outage -> empty list + `provider_error`, never a crash).
 */
export class ShopFinder {
  constructor(provider, { ttlSeconds = config.help.shopCacheTtlSeconds, radiusM = config.help.shopSearchRadiusM, limit = config.help.shopMaxResults } = {}) {
    this.provider = provider;
    this.cache = new TtlCache(ttlSeconds);
    this.radiusM = radiusM;
    this.limit = limit;
  }

  async find(lat, lng) {
    const rlat = roundCoord(lat);
    const rlng = roundCoord(lng);
    const key = `${this.provider.name}:${rlat},${rlng}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached, cached: true };
    try {
      const shops = await this.provider.search({ lat: rlat, lng: rlng, radiusM: this.radiusM, limit: this.limit });
      const out = { provider: this.provider.name, attribution: this.provider.attribution, shops, provider_error: false };
      this.cache.set(key, out);
      return { ...out, cached: false };
    } catch (err) {
      // log without coordinates
      console.warn(`[shops] provider ${this.provider.name} failed: ${err.code || err.name || "error"}`);
      return { provider: this.provider.name, attribution: this.provider.attribution, shops: [], provider_error: true, cached: false };
    }
  }
}
