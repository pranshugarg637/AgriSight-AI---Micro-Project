import { Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./auth/ProtectedRoute";
import AccountLayout from "./pages/account/AccountLayout";
import DiagnosePage from "./pages/account/DiagnosePage";
import FarmerApp from "./farmer/FarmerApp";

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
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
