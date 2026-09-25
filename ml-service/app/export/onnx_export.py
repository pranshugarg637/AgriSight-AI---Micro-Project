"""
Export the trained classifier for OFFLINE use in the browser (Step 8).

    cd ml-service
    pip install onnx onnxruntime
    python -m app.export.onnx_export                     # -> frontend/public/models/
    python -m app.export.onnx_export --compare-on-test 1000   # accuracy fp32 vs int8 on YOUR test split

Writes:
  plant_disease_model.onnx        fp32, same weights as the .pt (default for the web app)
  plant_disease_model.int8.onnx   dynamically quantised (smaller; opt-in, see below)
  model_web.json                  classes, image size, normalisation, temperature,
                                  confidence thresholds, OOD thresholds, checksums

Checks performed every time (and printed): max |logit| difference between
PyTorch and ONNX fp32 on random inputs (numerical parity, not accuracy).
Quantisation accuracy is only reported when --compare-on-test is run on the
real test split; it is never estimated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from app.config import get_settings


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(models_dir: Path, out_dir: Path, quantize: bool = True, opset: int = 17) -> dict:
    import torch

    from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD
    from app.training.model_factory import build_model

    s = get_settings()
    cfg = json.loads((models_dir / "model_config.json").read_text())
    classes = json.loads((models_dir / "class_names.json").read_text())
    model = build_model(cfg["backbone"], num_classes=cfg["num_classes"], freeze_backbone=False, pretrained=False)
    model.load_state_dict(torch.load(models_dir / "plant_disease_model.pt", map_location="cpu"))
    model.eval()
    size = cfg["image_size"]
    out_dir.mkdir(parents=True, exist_ok=True)
    fp32 = out_dir / "plant_disease_model.onnx"
    dummy = torch.randn(1, 3, size, size)
    torch.onnx.export(model, dummy, str(fp32), input_names=["input"], output_names=["logits"],
                      dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=opset,
                      dynamo=False)

    import onnxruntime as ort

    sess = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    x = np.random.default_rng(0).standard_normal((4, 3, size, size)).astype(np.float32)
    with torch.no_grad():
        ref = model(torch.from_numpy(x)).numpy()
    got = sess.run(None, {"input": x})[0]
    parity = float(np.abs(ref - got).max())

    files = {"fp32": {"file": fp32.name, "bytes": fp32.stat().st_size, "sha256": sha256(fp32)}}
    if quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        int8 = out_dir / "plant_disease_model.int8.onnx"
        quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QUInt8)
        files["int8"] = {"file": int8.name, "bytes": int8.stat().st_size, "sha256": sha256(int8),
                         "note": "dynamic quantisation; accuracy change unmeasured unless --compare-on-test was run"}

    web = {
        "model_version": cfg.get("model_version"),
        "backbone": cfg["backbone"],
        "image_size": size,
        "mean": IMAGENET_MEAN,
        "std": IMAGENET_STD,
        "class_names": classes,
        "temperature": cfg.get("temperature", 1.0),
        "calibrated": "temperature" in cfg,
        "high_confidence_threshold": s.HIGH_CONFIDENCE_THRESHOLD,
        "low_confidence_threshold": s.LOW_CONFIDENCE_THRESHOLD,
        "ood": cfg.get("ood"),
        "files": files,
        "default_file": files["fp32"]["file"],
        "onnx_parity_max_abs_logit_diff": parity,
    }
    (out_dir / "model_web.json").write_text(json.dumps(web, indent=2))
    return web


def compare_on_test(models_dir: Path, out_dir: Path, dataset_path: Path, max_samples: int) -> dict:
    import onnxruntime as ort
    from PIL import Image

    from app.calibration.fit import load_split_items

    web = json.loads((out_dir / "model_web.json").read_text())
    _, test_items, _ = load_split_items(dataset_path, max_samples, 0)
    size, mean, std = web["image_size"], np.array(web["mean"]), np.array(web["std"])

    def prep(path):
        im = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
        a = (np.asarray(im, dtype=np.float32) / 255.0 - mean) / std
        return a.transpose(2, 0, 1).astype(np.float32)

    x = np.stack([prep(p) for p, _ in test_items])
    y = np.array([t for _, t in test_items])
    out = {"n": int(len(y))}
    preds = {}
    for key, meta in web["files"].items():
        sess = ort.InferenceSession(str(out_dir / meta["file"]), providers=["CPUExecutionProvider"])
        logits = np.concatenate([sess.run(None, {"input": x[i:i + 64]})[0] for i in range(0, len(x), 64)])
        preds[key] = logits.argmax(1)
        out[f"accuracy_{key}"] = float((preds[key] == y).mean())
    if "int8" in preds:
        out["top1_agreement_fp32_vs_int8"] = float((preds["fp32"] == preds["int8"]).mean())
    web["quantisation_eval"] = out
    (out_dir / "model_web.json").write_text(json.dumps(web, indent=2))
    return out


def main(argv=None) -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models-dir", type=Path, default=s.MODEL_PATH.parent)
    ap.add_argument("--out-dir", type=Path, default=s.PROJECT_ROOT / "frontend" / "public" / "models")
    ap.add_argument("--no-quantize", action="store_true")
    ap.add_argument("--compare-on-test", type=int, default=0, metavar="N", help="evaluate fp32 vs int8 on N test images")
    ap.add_argument("--dataset-path", type=Path, default=s.DATASET_PATH)
    a = ap.parse_args(argv)
    web = export(a.models_dir, a.out_dir, quantize=not a.no_quantize)
    print(json.dumps({k: web[k] for k in ("files", "onnx_parity_max_abs_logit_diff", "calibrated")}, indent=2))
    if a.compare_on_test:
        print(json.dumps(compare_on_test(a.models_dir, a.out_dir, a.dataset_path, a.compare_on_test), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
