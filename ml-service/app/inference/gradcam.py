"""
Grad-CAM (Gradient-weighted Class Activation Mapping) for the trained CNN.

Grad-CAM shows which regions of the input image most influenced the model's
prediction for a given class. It does NOT prove the model's reasoning is
correct -- it visualizes correlation between image regions and the output
activation, which is a diagnostic/explainability aid, not a guarantee.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


@dataclass
class GradCAMResult:
    heatmap: np.ndarray  # HxW, values in [0, 1]
    overlay_image: Image.Image  # original image with heatmap overlaid


class GradCAM:
    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module):
        self.model = model
        self.target_layer = target_layer
        self._activations = None
        self._gradients = None

        self._fwd_handle = target_layer.register_forward_hook(self._save_activation)
        self._bwd_handle = target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, module, input, output):
        self._activations = output.detach()

    def _save_gradient(self, module, grad_input, grad_output):
        self._gradients = grad_output[0].detach()

    def remove_hooks(self):
        self._fwd_handle.remove()
        self._bwd_handle.remove()

    def generate(self, input_tensor: torch.Tensor, target_class: int) -> np.ndarray:
        """
        input_tensor: preprocessed image tensor, shape (1, C, H, W), requires_grad not needed.
        target_class: index of the class to explain.
        Returns a normalized (0-1) heatmap resized to the input's spatial size.
        """
        self.model.eval()
        input_tensor = input_tensor.clone().requires_grad_(True)

        output = self.model(input_tensor)
        score = output[:, target_class]

        self.model.zero_grad()
        score.backward(retain_graph=False)

        # activations/gradients shape: (1, C, h, w)
        gradients = self._gradients[0]      # (C, h, w)
        activations = self._activations[0]  # (C, h, w)

        weights = gradients.mean(dim=(1, 2))  # (C,) global-average-pooled gradients

        cam = torch.zeros(activations.shape[1:], dtype=torch.float32)
        for i, w in enumerate(weights):
            cam += w * activations[i]

        cam = F.relu(cam)
        cam = cam - cam.min()
        max_val = cam.max()
        if max_val > 0:
            cam = cam / max_val
        cam = cam.cpu().numpy()

        # Resize to input image spatial size
        target_h, target_w = input_tensor.shape[2], input_tensor.shape[3]
        cam_img = Image.fromarray((cam * 255).astype(np.uint8)).resize((target_w, target_h), Image.BILINEAR)
        cam_resized = np.array(cam_img).astype(np.float32) / 255.0

        return cam_resized


def overlay_heatmap_on_image(original_image: Image.Image, heatmap: np.ndarray, alpha: float = 0.45) -> Image.Image:
    """
    Overlays a normalized (0-1) heatmap onto the original PIL image using a
    simple red-hot colormap (no matplotlib dependency needed).
    """
    original_resized = original_image.convert("RGB").resize((heatmap.shape[1], heatmap.shape[0]))
    original_arr = np.array(original_resized).astype(np.float32)

    heatmap_color = _apply_colormap(heatmap)  # HxWx3, 0-255

    blended = (1 - alpha) * original_arr + alpha * heatmap_color
    blended = np.clip(blended, 0, 255).astype(np.uint8)

    return Image.fromarray(blended)


def _apply_colormap(heatmap: np.ndarray) -> np.ndarray:
    """Simple jet-like colormap without needing matplotlib/cv2."""
    h = np.clip(heatmap, 0, 1)
    r = np.clip(1.5 - np.abs(4 * h - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * h - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * h - 1), 0, 1)
    color = np.stack([r, g, b], axis=-1) * 255.0
    return color


def image_to_bytes(image: Image.Image, format: str = "PNG") -> bytes:
    buf = io.BytesIO()
    image.save(buf, format=format)
    return buf.getvalue()
