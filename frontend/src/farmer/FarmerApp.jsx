import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Placeholder -- the camera-first, voice-first flow is built in Step 3.
export default function FarmerApp() {
  const { t } = useTranslation();
  return (
    <main className="page-center">
      <div>
        <h1>{t("landing.farmer")}</h1>
        <Link to="/">{t("common.home")}</Link>
      </div>
    </main>
  );
}
