import { useTranslation } from "react-i18next";
import { classSlug } from "./safetyGating";

/**
 * A screen the farmer can simply show at a shop or office: crop + disease in
 * English AND the farmer's language, the confidence level and a thumbnail.
 * Deliberately contains NO product recommendation.
 */
export default function ShopkeeperCard({ result, gating, photoUrl, bundle, englishBundle, onClose }) {
  const { t, i18n } = useTranslation();
  const tEn = i18n.getFixedT("en");
  const slug = classSlug(result?.class_key);
  const nameLocal = gating.showDisease ? bundle?.classes?.[slug]?.clips?.name : null;
  const nameEn = gating.showDisease ? englishBundle?.classes?.[slug]?.clips?.name || `${result.crop}: ${result.diagnosis}` : null;

  return (
    <div className="fshop" role="dialog" aria-modal="true" aria-label={t("farmer.shopkeeper.title")}>
      <div className={`fshop__band fshop__band--${gating.band}`}>
        {tEn(`farmer.level.${gating.level}`)}
        {i18n.language !== "en" && <span lang={i18n.language}> · {t(`farmer.level.${gating.level}`)}</span>}
      </div>
      {photoUrl && <img src={photoUrl} alt="" className="fshop__photo" />}
      {gating.showDisease ? (
        <>
          <p className="fshop__name" lang="en">
            {nameEn}
            {gating.level === "low" && ` (${tEn("farmer.shopkeeper.possible")})`}
          </p>
          {i18n.language !== "en" && nameLocal && (
            <p className="fshop__name fshop__name--local" lang={i18n.language}>
              {nameLocal}
            </p>
          )}
        </>
      ) : (
        <p className="fshop__name">
          <span lang="en">{tEn("farmer.shopkeeper.notIdentified")}</span>
          {i18n.language !== "en" && (
            <span className="fshop__name--local" lang={i18n.language}>
              {" "}
              / {t("farmer.shopkeeper.notIdentified")}
            </span>
          )}
        </p>
      )}
      <p className="fshop__note" lang="en">
        {tEn("farmer.shopkeeper.note")}
      </p>
      <button type="button" className="fbtn fbtn--big" onClick={onClose} aria-label={t("common.close")}>
        ✖
      </button>
    </div>
  );
}
