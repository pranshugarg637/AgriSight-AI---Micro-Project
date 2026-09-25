import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import "./pages/AuthForms.css";
import "./i18n";
import { AuthProvider } from "./auth/AuthContext";
import App from "./App.jsx";
import { registerServiceWorker } from "./offline/pwa";

registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
