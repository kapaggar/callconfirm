# Vendored: @mediapipe/tasks-vision 0.10.14

On-device face detection for `photo-review/review.js`. Self-hosted so the Chrome
extension has no remote code and the github.io path has no CDN dependency.
Version is pinned — bump deliberately, re-record hashes below.

Total payload ~18 MB (the two wasm builds are ~9.4 MB each; the runtime loads
only one, picked by SIMD support).

## Sources

- Library + wasm: official npm tarball
  `https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.14.tgz`
  (tarball sha256 `3122ba7a70d414ffbb3a1bd194c370594a1bf1c90e467c375a5b8bd25be2c004`)
- Model: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`

## Re-fetch

```bash
curl -sL -o /tmp/tv.tgz https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.14.tgz
tar -xzf /tmp/tv.tgz -C /tmp
cp /tmp/package/vision_bundle.mjs vendor/mediapipe/
cp /tmp/package/wasm/vision_wasm_internal.{js,wasm} /tmp/package/wasm/vision_wasm_nosimd_internal.{js,wasm} vendor/mediapipe/wasm/
curl -L -o vendor/mediapipe/blaze_face_short_range.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
```

## sha256

| File | sha256 |
|---|---|
| `vision_bundle.mjs` | `e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669` |
| `wasm/vision_wasm_internal.js` | `9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c` |
| `wasm/vision_wasm_internal.wasm` | `f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc` |
| `wasm/vision_wasm_nosimd_internal.js` | `abe9b6fbeaf86fcb53a5edce3926c82ccb0619e18fed4d9d9ce561ee7f55e054` |
| `wasm/vision_wasm_nosimd_internal.wasm` | `38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97` |
| `blaze_face_short_range.tflite` | _record after fetch (blocked in the dev sandbox; fetch manually)_ |
