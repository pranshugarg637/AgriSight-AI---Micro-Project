import { Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./auth/ProtectedRoute";
import AccountLayout from "./pages/account/AccountLayout";
import DiagnosePage from "./pages/account/DiagnosePage";
import FarmerApp from "./farmer/FarmerApp";
import PlotsPage from "./pages/account/PlotsPage";
import PlotDetail from "./pages/account/PlotDetail";
import ExpertQueue from "./pages/account/ExpertQueue";
import SettingsPage from "./pages/account/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/farmer/*" element={<FarmerApp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DiagnosePage />} />
        <Route path="plots" element={<PlotsPage />} />
        <Route path="plots/:id" element={<PlotDetail />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="expert"
          element={
            <ProtectedRoute roles={["expert", "admin"]}>
              <ExpertQueue />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
