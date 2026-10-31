# Publishing Fasten Classic on Publik

Fasten Classic is structured to meet [Publik](https://publikhq.com/)'s repository and release scanner requirements out of the box.

## Verified Publik Listing Metadata

| Field | Value | Constraint Check |
| --- | --- | --- |
| `name` | `Fasten Classic` | 14 characters (max 18) |
| `summary` | `Your household finances, on your computer. No subscription.` | 59 characters, no URLs (max 80) |
| `category` | `Finance` / `Productivity` | Consumer desktop personal finance |
| `alternativeTo` | `Quicken Classic` | Direct subscription-free desktop alternative |
| `license` | `MIT` | Matches root `LICENSE` and `Cargo.toml` / `package.json` |
| `platforms` | `windows`, `macos` | Built via Tauri v2 (`.exe` / `.msi` & `.dmg`) |
| `publikApi.enabled` | `false` | 100% local offline application; calls zero external AI or web APIs |

## Step-by-Step Submission Checklist

1. **Push to a public GitHub repository**:
   ```bash
   git remote add origin https://github.com/<your-handle>/fastenclassic.git
   git push -u origin main
   ```
2. **Tag `v0.1.0` to build Windows & macOS installers**:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   Wait for the `CI & Cross-Platform Desktop Release` GitHub Action (`.github/workflows/release.yml`) to attach the Windows `.exe`/`.msi` and macOS `.dmg` artifacts to the `v0.1.0` GitHub Release.
3. **List on Publik**:
   - Either open [https://publikhq.com/submit](https://publikhq.com/submit) and paste your public GitHub repository URL, **or**
   - Run Publik's interactive publishing flow (`https://publikhq.com/skills/publish.md`) and approve the device verification link in your browser.
