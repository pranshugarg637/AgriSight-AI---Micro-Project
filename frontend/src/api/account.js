import { authJson, authFetch, parseResponse } from "./http";

export const listPlots = () => authJson("/api/v2/plots");
export const createPlot = (plot) => authJson("/api/v2/plots", { method: "POST", body: plot });
export const deletePlot = (id) => authJson(`/api/v2/plots/${id}`, { method: "DELETE" });
export const getTimeline = (id) => authJson(`/api/v2/plots/${id}/timeline`);
export const deleteScan = (id) => authJson(`/api/v2/scans/${id}`, { method: "DELETE" });
export const disputeScan = (id) => authJson(`/api/v2/scans/${id}/dispute`, { method: "POST" });
export const logAction = (scanId, body) => authJson(`/api/v2/scans/${scanId}/actions`, { method: "POST", body });
export const getReminders = () => authJson("/api/v2/reminders");
export const getRisk = (plotId, coords) =>
  authJson(`/api/v2/risk?plot_id=${plotId}${coords ? `&lat=${coords.lat}&lng=${coords.lng}` : ""}`);
export const getExpertQueue = () => authJson("/api/v2/expert/queue");
export const reviewScan = (id, body) => authJson(`/api/v2/expert/scans/${id}/review`, { method: "POST", body });
export const getAdminMetrics = (days = 30) => authJson(`/api/v2/admin/metrics?days=${days}`);

/** Fetch a protected image as an object URL (Bearer header, so <img src> cannot be used directly). */
export async function fetchImageUrl(path) {
  const res = await authFetch(path);
  if (!res.ok) await parseResponse(res);
  return URL.createObjectURL(await res.blob());
}
