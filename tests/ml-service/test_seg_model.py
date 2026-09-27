"""U-Net forward shapes, encoder freezing, and the BCE+Dice loss."""
import torch

from app.segmentation.losses import BCEDiceLoss, soft_dice_loss
from app.segmentation.model import build_seg_model


def test_forward_shape_matches_input():
    model = build_seg_model(pretrained_encoder=False).eval()
    with torch.no_grad():
        assert model(torch.randn(2, 3, 64, 64)).shape == (2, 1, 64, 64)
        assert model(torch.randn(1, 3, 70, 90)).shape == (1, 1, 70, 90)  # non-multiple-of-32 sizes


def test_freeze_and_unfreeze_encoder():
    model = build_seg_model(pretrained_encoder=False, freeze_encoder=True)
    assert all(not p.requires_grad for p in model.encoder.parameters())
    assert all(p.requires_grad for p in model.head.parameters())
    model.set_encoder_trainable(True)
    assert all(p.requires_grad for p in model.encoder.parameters())


def test_loss_prefers_correct_masks():
    target = torch.zeros(2, 1, 16, 16)
    target[:, :, 4:8, 4:8] = 1
    good = (target * 2 - 1) * 10      # confident, correct logits
    bad = -good
    loss = BCEDiceLoss()
    assert loss(good, target) < 0.05
    assert loss(bad, target) > 1.0
    assert soft_dice_loss(good, target) < 0.05


def test_one_training_step_reduces_loss():
    torch.manual_seed(0)
    model = build_seg_model(pretrained_encoder=False)
    x = torch.randn(4, 3, 32, 32)
    y = (torch.rand(4, 1, 32, 32) > 0.7).float()
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)
    crit = BCEDiceLoss()
    first = None
    for _ in range(5):
        opt.zero_grad()
        loss = crit(model(x), y)
        loss.backward()
        opt.step()
        first = first if first is not None else loss.item()
    assert loss.item() < first
