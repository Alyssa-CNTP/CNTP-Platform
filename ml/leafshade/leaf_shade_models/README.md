# leaf_shade_models/

Place the three `.pkl` model files here:

- `leaf_shade_mlp_28feat_balanced_2026v1.pkl`
- `leaf_shade_scaler_28feat_balanced_2026v1.pkl`
- `leaf_shade_label_encoder_28feat_balanced_2026v1.pkl`

These were saved with scikit-learn==1.7.2. Do not upgrade scikit-learn
without retraining and re-saving all three files.

If your .gitignore blocks *.pkl, add this exception:
  !server/leaf_shade_models/*.pkl
