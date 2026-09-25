import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguagePicker from "../components/LanguagePicker";
import { languageMeta } from "../i18n";
import CameraCapture from "./CameraCapture";
import ResultScreen from "./ResultScreen";
import ShopkeeperCard from "./ShopkeeperCard";
import HelpFinder from "./HelpFinder";
import SymptomQuestions from "./SymptomQuestions";
import { ClipPlayer } from "./audioPlayer";
import { buildSpokenResult } from "./safetyGating";
import { farmerPredict, getScriptBundle } from "./api";
import "./Farmer.css";

const STAGE_ICON = { validate: "📷", classify: "🔬", explain: "🔥", retrieve: "📚", generate: "✍️", verify: "✅", translate: "🌐" };

/**
 * Farmer Mode: camera-first, voice-first, no login, minimal text.
 * Screens: home -> camera (or gallery) -> analysing -> result -> help / shopkeeper card.
 */
export default function FarmerApp({ player: injectedPlayer } = {}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [screen, setScreen] = useState("home");
  const [bundle, setBundle] = useState(null);
  const [englishBundle, setEnglishBundle] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState("");
  const [showCard, setShowCard] = useState(false);
  const [stage, setStage] = useState(null);
  const galleryRef = useRef(null);
  const [player] = useState(() => injectedPlayer || new ClipPlayer());

  useEffect(() => {
    let alive = true;
    getScriptBundle(lang)
      .then((b) => alive && setBundle(b))
      .catch(() => alive && setBundle(null));
    getScriptBundle("en")
      .then((b) => alive && setEnglishBundle(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lang]);

  useEffect(() => {
    player.setBundle(bundle, languageMeta(lang).speechLang);
    player.setCaptionListener((_key, text) => setCaption(text));
  }, [bundle, lang, player]);

  useEffect(() => () => player.stop(), [player]);

  const say = useCallback((field) => player.play([`${lang}.prompt.${field}`]), [player, lang]);

  const gating = useMemo(
    () => (result ? buildSpokenResult(result, bundle, { lang, questionsAvailable: Boolean(result.question_pair) }) : null),
    [result, bundle, lang]
  );

  useEffect(() => {
    if (screen === "result" && gating) player.play(gating.playlist);
  }, [screen, gating, player]);

  async function analyse(file) {
    setError(null);
    setResult(null);
    setPhotoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setScreen("analysing");
    setStage(null);
    try {
      const data = await farmerPredict(file, lang, (e) => {
        if (e.status !== "skipped") setStage(e.stage);
      });
      setResult(data);
      setScreen("result");
    } catch (err) {
      if (err?.status === 422) {
        // unusable photo (blurry/too small): same safe message as "cannot tell"
        setResult({ confidence_level: "unreliable", unreliable_reason: "unusable_photo" });
        setScreen("result");
      } else {
        setError(err?.status === 429 ? t("farmer.tooMany") : t("farmer.networkError"));
        setScreen("home");
        say("network_error");
      }
    }
  }

  function restart() {
    player.stop();
    setResult(null);
    setShowCard(false);
    setScreen("home");
  }

  const devUnreviewed = import.meta.env.DEV && bundle?.unreviewed?.length > 0;

  return (
    <div className="farmer" lang={lang}>
      {devUnreviewed && (
        <div className="farmer__devwarn" role="note">
          DEV: {bundle.unreviewed.length} audio script file(s) for “{lang}” are not reviewed by a native speaker.
        </div>
      )}

      <header className="farmer__top">
        <Link to="/" className="fbtn fbtn--icon" aria-label={t("common.home")}>
          🏠
        </Link>
        <LanguagePicker />
        <button type="button" className="fbtn fbtn--icon farmer__replay" onClick={() => player.replay()} aria-label={t("farmer.replay")}>
          🔊
        </button>
      </header>

      {error && (
        <p className="farmer__error" role="alert">
          {error}
        </p>
      )}

      {screen === "home" && (
        <main className="farmer__home">
          <button type="button" className="fbtn fbtn--hero" onClick={() => setScreen("camera")}>
            <span aria-hidden="true">📷</span>
            <span>{t("farmer.checkLeaf")}</span>
          </button>
          <button type="button" className="fbtn fbtn--big" onClick={() => galleryRef.current?.click()}>
            <span aria-hidden="true">🖼️</span> {t("farmer.choosePhoto")}
          </button>
          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            data-testid="farmer-gallery"
            onChange={(e) => e.target.files?.[0] && analyse(e.target.files[0])}
          />
          <p className="fhelp__note">{t("farmer.photoNotStored")}</p>
        </main>
      )}

      {screen === "camera" && (
        <CameraCapture
          onCapture={analyse}
          onPrompt={say}
          onUnavailable={() => {
            setScreen("home");
            setError(t("farmer.cameraUnavailable"));
            say("camera_denied");
          }}
        />
      )}

      {screen === "analysing" && (
        <main className="farmer__busy" role="status" aria-live="polite">
          <div className="farmer__spinner" aria-hidden="true" />
          <p>{t("farmer.checking")}</p>
          {stage && (
            <p className="farmer__stage">
              <span aria-hidden="true">{STAGE_ICON[stage] || "⏳"}</span> {t(`pipeline.${stage}`)}
            </p>
          )}
        </main>
      )}

      {screen === "result" && result && gating && (
        <ResultScreen
          result={result}
          gating={gating}
          bundle={bundle}
          photoUrl={photoUrl}
          onHelp={() => setScreen("help")}
          onQuestions={() => setScreen("questions")}
          onShopkeeper={() => setShowCard(true)}
          onRestart={restart}
        />
      )}

      {screen === "questions" && result && (
        <SymptomQuestions
          result={result}
          player={player}
          onCancel={() => setScreen("result")}
          onDone={(refined) => {
            setResult(refined);
            setScreen("result");
          }}
        />
      )}

      {screen === "help" && gating && (
        <HelpFinder primary={gating.primaryHelp} onBack={() => setScreen("result")} say={say} />
      )}

      {showCard && gating && (
        <ShopkeeperCard
          result={result}
          gating={gating}
          photoUrl={photoUrl}
          bundle={bundle}
          englishBundle={englishBundle}
          onClose={() => setShowCard(false)}
        />
      )}

      {caption && (
        <p className="farmer__caption" aria-live="polite">
          {caption}
        </p>
      )}
    </div>
  );
}
