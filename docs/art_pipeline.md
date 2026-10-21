# Art Pipeline — Draft 1

## Stable Diffusion WebUI (A1111 v1.10, `E:\StableFusion\stable-diffusion-webui`)

**Hardware:** RTX 3060 Ti with 8 GB VRAM and 16 GB system RAM. SDXL needs `--medvram-sdxl` on this machine.

**Pixel Art XL is a LoRA, not a checkpoint.** `pixel-art-xl-v1.1.safetensors` is 170 MB. It modifies an SDXL base model and doesn't work on its own. Required setup:

| Setting | Value |
|---|---|
| Launch args (`webui-user.bat`) | `--api --medvram-sdxl --no-half-vae` |
| LoRA file location | `models\Lora\pixel-art-xl-v1.1.safetensors` |
| Checkpoint | An SDXL model. `juggernautXL_v9Rdphoto2Lightning` is already installed. `sd_xl_base_1.0` is what the LoRA was trained on. |
| SD VAE | `Automatic`. The current `vae-ft-mse-840000` is an SD 1.5 VAE and breaks SDXL output. |
| Clip skip | 1 |

### Generation settings

| | Juggernaut XL Lightning | SDXL base 1.0 (+ optional LCM LoRA) |
|---|---|---|
| Sampler / schedule | DPM++ SDE / Karras | DPM++ 2M / Karras (or LCM sampler with the LCM LoRA) |
| Steps | 6–8 | 25–30 (8 with LCM) |
| CFG | 1.5–2 | 5–7 (1.5 with LCM) |
| LoRA tag | `<lora:pixel-art-xl-v1.1:1.0>` (0.8–1.2) | same |
| Size | 1024×1024, or SDXL aspect buckets such as 1216×832 | same |

**Prompt pattern:** `pixel art, <subject>, <setting>, <palette/mood>, <lora:pixel-art-xl-v1.1:1>`

> **Tested on 2026-10-20 (seed 1556087656, Juggernaut Lightning, 6 steps):**
> - **The words "pixel art" must be in the prompt.** Without them, the LoRA barely shows and the photo model's painterly style wins.
> - With the trigger, a bare subject gives a clean sprite on a flat gray background, ideal for background removal.
> - Adding a scene ("in the vastness of space") pulls in a starfield, and the subject gets less coherent. **Generate sprites and backgrounds separately.**
> - LoRA 1.2 + CFG 2 strengthens the pixel look but warps shapes on this model. Stay at 1.0 and CFG 1.5–2.
**Negative:** `3d render, photo, realistic, blurry, smooth shading, text, watermark, signature`

### Post-processing (scripted)
1. **Nearest-neighbor downscale by 8×** (1024 → 128 px) to get true pixel-grid output. Use 4× for larger portraits.
2. **Palette quantization** to a shared project palette (e.g. 32–48 colors), so all assets match.
3. **Background removal** for sprites (e.g. `rembg`), then trim.
4. Integer-scale upward in-engine. Never use smooth filtering.

### Consistency rules
- One checkpoint and one LoRA weight for the whole project.
- A fixed style suffix appended to every prompt.
- Recorded seeds, so each asset can be regenerated.
- Every asset is defined in a manifest (`assets/manifest.yaml`: id, prompt, seed, size, post-process steps). A script calls the WebUI API (`/sdapi/v1/txt2img`) and writes the outputs.

## MOSS-Image (`E:\MOSS-Image`)
- A 5B DiT text-to-image model with a Qwen text encoder; Apache-2.0 weights. It's strong at layout and in-image text, which makes it a candidate for title screens, UI mockups and concept art.
- The full bf16 weights are about 27 GB, beyond this GPU. It runs through `run_lowvram.py` with NF4 quantization and CPU offload.
- Launch on port 7870, so it doesn't collide with the SD WebUI on 7860. Don't run both at the same time: they compete for 8 GB of VRAM.
