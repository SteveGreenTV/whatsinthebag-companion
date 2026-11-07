# What's in the Bag? WITB Companion

An offline, read-only desktop viewer for inventory snapshots created by the What's in the bag? WoW addon. Browse carried bags, Character Banks and the Warband Bank, with search, filters, item levels and saved item details.

## Download

Open the [Releases page](https://github.com/SteveGreenTV/whatsinthebag-companion/releases), download `WITB_Companion_<version>.exe`, and run it on Windows x64. No installation or Node.js is required. The executable is unsigned, so Windows may display an unknown-publisher or SmartScreen warning.

Install the What's in the bag? addon in Retail WoW to create snapshots. Log into the characters you want to view and open their bags and banks, then log out or exit WoW so the client writes the SavedVariables file. The companion shows saved snapshots, not live inventory.

## Use

1. Start the app and select the WoW `_retail_` folder.
2. Open the **A** menu and select an account found under `WTF/Account/<Name>/SavedVariables/WhatsInTheBag.lua`.
3. Use **Alts** to open a character's Bags or Bank in its own window. The main window shows the Warband Bank by default when one is available.

Changing accounts or selecting a different Retail folder closes open character windows. Items remain read-only; the companion cannot move or use them. Hover details contain only information captured in the snapshot, not the full live WoW tooltip.

Snapshots and exported textures stay on your computer. The companion does not upload them.

## Export Item Icons

Icons are optional. Without an export, snapshots still load, but items display missing-icon placeholders.

1. Close WoW. In Battle.net, select World of Warcraft and the Retail game version.
2. Open the gear menu beside **Play**, choose **Game Settings**, enable **Additional command line arguments**, and enter `-console`. Preserve any arguments already there.
3. Launch WoW and open the developer console with the console key, usually the backtick/tilde key. The key can vary with your keyboard layout.
4. Enter this command in the developer console, not the chat box:

```text
ExportInterfaceFiles art
```

5. Allow the export to finish. It exports interface artwork, not just item icons, and can take time and substantial disk space.
6. Check that your WoW installation now contains:

```text
World of Warcraft/_retail_/BlizzardInterfaceArt/Interface/ICONS/
```

7. Restart the companion and select that same `_retail_` folder. You can remove `-console` from the Battle.net launch arguments afterward.

The full artwork export is roughly 11 GB (the size varies by WoW version), but the companion only needs `_retail_/BlizzardInterfaceArt/Interface/ICONS/` and its contents. You can delete the other exported files and folders inside `BlizzardInterfaceArt` to reclaim space. Keep the icons folder and its parent directory structure intact; do not delete the client's installed game files.

Keep the exported `.blp` files in that directory structure; do not convert or copy them into the companion folder. Re-export after WoW updates if new items have missing icons. Some icons may remain unavailable if they are not present in the client export or the companion's included icon mapping.

## Run from Source

Install [Git](https://git-scm.com/downloads/win) and [Node.js 24 LTS](https://nodejs.org/), including npm. The public repository uses `main` as its default branch. Open PowerShell and clone it:

```powershell
git clone --branch main https://github.com/SteveGreenTV/whatsinthebag-companion.git WITB_Companion
cd WITB_Companion
npm ci
npm run desktop
```

If you already checked out the repository, open PowerShell in its root folder and run only `npm ci` and `npm run desktop`. The desktop command builds the interface and starts Electron. Select your `_retail_` folder just as you would in the downloaded EXE; WoW snapshots and icon exports are not included in the checkout.

For an optional browser version, run:

```powershell
npm run dev
```

Open the local URL printed by Vite in a Chromium-based browser. Allow folder access and popups for character windows. In an embedded VS Code/Electron browser preview, select only `_retail_/WTF/Account`; that preview can read snapshots but does not load exported icons. Stop the development server with Ctrl+C when finished.

## Build a Windows EXE

After `npm ci`, run this in the repository root on Windows:

```powershell
npm run release:win:portable
```

This builds a Windows x64 portable executable at:

```text
release/WITB_Companion_0.3.0.exe
```

The filename follows the version in `package.json`. Run the EXE directly, or copy it to another Windows x64 computer. It includes Electron and does not require Node.js on that computer. Building locally does not publish a GitHub release.
