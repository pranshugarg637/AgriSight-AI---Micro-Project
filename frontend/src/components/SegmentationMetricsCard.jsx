import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSegmentationReport } from "../api/client";

const fmt = (x) => (x == null ? "—" : x.toFixed(3));

/**
 * Shows the saved lesion-segmentation test report (models/seg_evaluation_report.json)
 * exactly as the training run wrote it -- nothing is computed or estimated here.
 */
export default function SegmentationMetricsCard() {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: "loading", report: null });

  useEffect(() => {
    let alive = true;
    getSegmentationReport()
      .then((report) => alive && setState({ status: report ? "ready" : "missing", report }))
      .catch(() => alive && setState({ status: "error", report: null }));
    return () => {
      alive = false;
    };
  }, []);

  const { status, report } = state;
  const m = report?.metrics;

  return (
    <section className="acct-card" data-testid="segmentation-metrics">
      <h2>{t("segmentation.metricsTitle")}</h2>
      <p className="muted">{t("segmentation.metricsExplain")}</p>
      {status === "loading" && <p>{t("common.loading")}</p>}
      {status === "error" && <p className="muted">{t("segmentation.loadFailed")}</p>}
      {status === "missing" && (
        <>
          <p>
            <strong>{t("segmentation.notTrained")}</strong>
          </p>
          <p className="muted">{t("segmentation.notTrainedHint")}</p>
        </>
      )}
      {status === "ready" && m && (
        <>
          <table className="table">
            <tbody>
              <tr>
                <td>{t("segmentation.dataset")}</td>
                <td>{report.dataset_name ?? "—"}</td>
              </tr>
              <tr>
                <td>{t("segmentation.testImages")}</td>
                <td>{report.n_test_images ?? m.n_images}</td>
              </tr>
              <tr>
                <td>{t("segmentation.meanDice")}</td>
                <td>{fmt(m.mean_dice)}</td>
              </tr>
              <tr>
                <td>{t("segmentation.microDice")}</td>
                <td>{fmt(m.micro_dice)}</td>
              </tr>
              <tr>
                <td>{t("segmentation.meanIou")}</td>
                <td>{fmt(m.mean_iou)}</td>
              </tr>
              <tr>
                <td>{t("segmentation.precision")}</td>
                <td>{fmt(m.micro_precision)}</td>
              </tr>
              <tr>
                <td>{t("segmentation.recall")}</td>
                <td>{fmt(m.micro_recall)}</td>
              </tr>
            </tbody>
          </table>
          {m.by_lesion_size && (
            <>
              <h3>{t("segmentation.bySize")}</h3>
              <table className="table">
                <tbody>
                  {Object.entries(m.by_lesion_size)
                    .filter(([, v]) => v.n_images > 0)
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td>{t(`segmentation.size.${k}`, k)}</td>
                        <td>
                          {fmt(v.mean_dice)} (n={v.n_images})
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}
