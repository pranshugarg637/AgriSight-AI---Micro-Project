import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div className="page-center" role="status">
        {t("common.loading")}
      </div>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="page-center" role="alert">
        {t("auth.forbidden")}
      </div>
    );
  }
  return children;
}
