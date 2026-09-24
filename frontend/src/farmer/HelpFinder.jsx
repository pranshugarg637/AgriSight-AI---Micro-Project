import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "./api";

const km = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

function Place({ place, office }) {
  const { t } = useTranslation();
  return (
    <li className={`fhelp__item ${office ? "fhelp__item--office" : ""}`}>
      <span className="fhelp__name">
        <span aria-hidden="true">{office ? "🏛️" : "🏪"}</span> {place.name || t("farmer.help.unnamedShop")}
      </span>
      <span className="fhelp__meta">
        {place.distance_m != null && <>📍 {km(place.distance_m)} · </>}
        {place.district || place.address || ""}
      </span>
      <span className="fhelp__links">
        {place.phone && (
          <a className="fbtn fbtn--small fbtn--primary" href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
            📞 {t("farmer.help.call")}
          </a>
        )}
        {place.map_url && (
          <a className="fbtn fbtn--small" href={place.map_url} target="_blank" rel="noopener noreferrer">
            🗺️ {t("farmer.help.map")}
          </a>
        )}
      </span>
    </li>
  );
}

/**
 * Nearby help. Location is asked for explicitly (spoken + visual), used for
 * one request and never stored. Without consent the farmer picks a
 * state/district (curated offices) or types a village name.
 * For low/unreliable results the agriculture office is listed first.
 */
export default function HelpFinder({ primary = "office", onBack, say }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState("consent"); // consent | locating | results | manual
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [index, setIndex] = useState([]);
  const [stateSlug, setStateSlug] = useState("");
  const [district, setDistrict] = useState("");
  const [village, setVillage] = useState("");

  useEffect(() => {
    say?.("location_consent");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchAt(lat, lng) {
    const res = await api.getShops(lat, lng);
    setData(res);
    setStage("results");
    say?.(res.office_fallback ? "no_shops_found" : "stock_disclaimer");
  }

  async function useLocation() {
    setError(null);
    setStage("locating");
    try {
      const { lat, lng } = await api.getPositionOnce();
      await searchAt(lat, lng);
    } catch {
      setError(t("farmer.help.locationFailed"));
      openManual();
    }
  }

  async function openManual() {
    setStage("manual");
    try {
      setIndex((await api.getHelpIndex()).states || []);
    } catch {
      setIndex([]);
    }
  }

  async function showDistrict() {
    const res = await api.getHelpCenters(stateSlug, district);
    setData({ shops: [], offices: res.centers, office_fallback: true, manual: true });
    setStage("results");
  }

  async function searchVillage() {
    try {
      const { places } = await api.geocodePlace(village);
      if (!places?.length) return setError(t("farmer.help.placeNotFound"));
      await searchAt(places[0].lat, places[0].lng);
    } catch {
      setError(t("farmer.help.searchFailed"));
    }
  }

  const offices = data?.offices || [];
  const shops = data?.shops || [];
  const officeFirst = primary !== "shops" || shops.length === 0;
  const districts = index.find((s) => s.state_slug === stateSlug)?.districts || [];

  return (
    <main className="fhelp">
      <button type="button" className="fbtn fbtn--big" onClick={onBack}>
        ⬅ {t("common.back")}
      </button>

      {stage === "consent" && (
        <>
          <p className="fq__text">
            <span aria-hidden="true">📍</span> {t("farmer.help.consent")}
          </p>
          <div className="fq__buttons">
            <button type="button" className="fbtn fq__yes" onClick={useLocation} aria-label={t("farmer.help.allow")}>
              ✔
            </button>
            <button type="button" className="fbtn fq__no" onClick={openManual} aria-label={t("farmer.help.deny")}>
              ✖
            </button>
          </div>
        </>
      )}

      {stage === "locating" && (
        <p role="status" className="fq__text">
          {t("common.pleaseWait")}
        </p>
      )}

      {error && (
        <p role="alert" className="farmer__error">
          {error}
        </p>
      )}

      {stage === "manual" && (
        <>
          {index.length > 0 ? (
            <>
              <select aria-label={t("farmer.help.state")} value={stateSlug} onChange={(e) => setStateSlug(e.target.value)}>
                <option value="">{t("farmer.help.state")}</option>
                {index.map((s) => (
                  <option key={s.state_slug} value={s.state_slug}>
                    {s.state}
                  </option>
                ))}
              </select>
              <select aria-label={t("farmer.help.district")} value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!stateSlug}>
                <option value="">{t("farmer.help.district")}</option>
                {districts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <button type="button" className="fbtn fbtn--big fbtn--primary" disabled={!stateSlug} onClick={showDistrict}>
                🏛️ {t("farmer.help.showOffices")}
              </button>
            </>
          ) : (
            <p className="fhelp__note">{t("farmer.help.noOfficeData")}</p>
          )}
          <label className="fhelp__note">
            {t("farmer.help.village")}
            <input value={village} onChange={(e) => setVillage(e.target.value)} className="fhelp__input" />
          </label>
          <button type="button" className="fbtn fbtn--big" disabled={village.trim().length < 2} onClick={searchVillage}>
            🔍 {t("farmer.help.searchVillage")}
          </button>
        </>
      )}

      {stage === "results" && data && (
        <>
          {data.office_fallback && !data.manual && <p className="fhelp__note">{t("farmer.help.noShops")}</p>}
          {(officeFirst ? ["offices", "shops"] : ["shops", "offices"]).map((group) =>
            group === "offices" ? (
              offices.length > 0 ? (
                <section key="o" aria-label={t("farmer.help.offices")}>
                  <h2>{t("farmer.help.offices")}</h2>
                  <ul className="fhelp__list">
                    {offices.map((o, i) => (
                      <Place key={`o${i}`} place={o} office />
                    ))}
                  </ul>
                </section>
              ) : (
                <p key="o" className="fhelp__note">
                  {t("farmer.help.noOfficeData")}
                </p>
              )
            ) : shops.length > 0 ? (
              <section key="s" aria-label={t("farmer.help.shops")}>
                <h2>{t("farmer.help.shops")}</h2>
                <p className="fhelp__note" role="note">
                  ⚠️ {t("farmer.help.stockDisclaimer")}
                </p>
                <ul className="fhelp__list">
                  {shops.map((s) => (
                    <Place key={s.id} place={s} />
                  ))}
                </ul>
                {data.attribution && <p className="fhelp__attr">{data.attribution}</p>}
              </section>
            ) : null
          )}
        </>
      )}
    </main>
  );
}
