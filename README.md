# What's in the Bag? WITB Companion

An offline, read-only desktop viewer for inventory snapshots created by the What's in the bag? WoW addon. Browse carried bags, Character Banks and the Warband Bank, with search, filters, item levels and saved item details.

Browse the [screenshot gallery](https://github.com/SteveGreenTV/whatsinthebag-companion/wiki/Screenshots) for full-resolution previews of character windows, search, filters and item layouts.

## Download

Open the [Releases page](https://github.com/SteveGreenTV/whatsinthebag-companion/releases) and choose the file for your computer:

- Windows x64: `WITB_Companion_<version>.exe` is portable and requires no installation. It is unsigned, so Windows may display an unknown-publisher or SmartScreen warning.
- macOS Apple silicon: `WITB_Companion_<version>_macos_arm64.dmg`.
- macOS Intel: `WITB_Companion_<version>_macos_x64.dmg`.

For macOS, open the disk image and drag the app to Applications. The app is ad-hoc signed, not Apple Developer ID signed or notarized, so Gatekeeper may block it. If you trust the download, attempt to open it, then use **System Settings > Privacy & Security > Open Anyway** to approve it. macOS builds and the WoW icon export path have not yet been verified in a real Mac client. Node.js is not required to run the downloads.

Install the [What's in the bag? addon from CurseForge](https://www.curseforge.com/wow/addons/whats-in-the-bag) for your WoW game version to create snapshots. The companion can open `_retail_` and `_forever_` game folders; Forever requires the addon's Forever/Camelot build. Log into the characters you want to view and open their bags and banks, then log out or exit WoW so the client writes the SavedVariables file. The companion shows saved snapshots, not live inventory.

## What's New in 0.6.0

0.6.0 is a release candidate. The manual GitHub macOS ARM64 build has not yet run; do not produce other release artifacts until it succeeds.

- Filter saved items to Equipment and browse them grouped by equipment slot. The companion shows snapshot items only; it does not add current equipped-item references.
- Add **Sort by item level** to View. It is off by default; when enabled, equipment slot order stays primary and items sort by descending item level within each slot. Without Equipment, item level sorts within the current category or subcategory section; unknown levels come last.
- In the Alts menu, search all terms within one saved item name across Bags or Bank. Characters with no matching item are hidden while searching, and matching storage buttons remain highlighted.
- Exclude invalid `0/0` upgrade tracks from the Upgradeable filter.

## What's New in 0.5.1

- Include fully upgraded items in the upgradeable filter and keep their completed track level, such as `C6/6`, visible.

## What's New in 0.5.0

- Item tooltips show saved item level, full upgrade-track name and bound status, with counts across character Bags, Character Banks and the Warband Bank.
- Use the gear menu beside **Alts** to toggle Category and Subcategory details in tooltips. This companion-only setting is off by default and saved locally.
- Tooltip category details appear below the item counts.

## What's New in 0.4.2

- Keep the category rail at a consistent 220px width across window sizes.

## What's New in 0.4.1

- Open either the WoW `_retail_` or `_forever_` game folder.
- The source buttons now read **Open game folder** and **Select account** instead of R and A, with layouts that fit narrow screens.
- Art-export guidance covers the temporary computer freeze, approximate duration, Retail/Forever data sizes and keeping only the exported icons.

### Included from 0.4.0

- Search saved item names in the Alts popup. Matching Bags and Bank buttons are highlighted independently. All search terms must occur in the same item name, ignoring case.
- The item filter bar spans both panes with a small blank area on its left and more space above the lists.
- The category column fits its contents, and View and Filters share red-and-gold styling.
- Search hints and Alts/account popups render above the controls they overlap.

Snapshots remain read-only. Alts search uses saved item names only and does not change the main item filter.

## Use

1. Start the app, click **Open game folder**, and choose the WoW `_retail_` or `_forever_` folder.
2. Click **Select account** and choose an account found under `WTF/Account/<Name>/SavedVariables/WhatsInTheBag.lua`.
3. Use **Alts** to open a character's Bags or Bank in its own window. Search inside the Alts popup to show only characters whose Bags or Bank contains a matching item name; matching storage buttons are highlighted independently. The hint explains that all terms must occur in the same item name. The main window shows the Warband Bank by default when one is available.

Use **Filters > Equipment** to show saved equippable items in equipment-slot order. This does not add equipped-item references. In **View**, enable **Sort by item level** to sort highest to lowest within the current sections; with Equipment active, slot order remains primary. Missing item levels sort last. Turning the option off retains alphabetical item-name sorting.

Changing accounts or opening a different game folder closes open character windows. Only one game folder is selected at a time. Items remain read-only; the companion cannot move or use them. Hover details contain only information captured in the snapshot, not the full live WoW tooltip.

Snapshots and exported textures stay on your computer. The companion does not upload them.

## Export Item Icons

Icons are optional. Without an export, snapshots still load, but items display missing-icon placeholders.

**Art-export warning:** Exporting can take about **2 minutes**, and your computer will **freeze temporarily** while it runs. Retail handles approximately **11 GB** of art data; Forever handles approximately **10 GB**. Save other work before starting and allow the export to finish. Duration varies by computer; these are art-data sizes, not companion download sizes.

1. Close WoW. In Battle.net, select World of Warcraft and the game version whose art you want to export.
2. Open the gear menu beside **Play**, choose **Game Settings**, enable **Additional command line arguments**, and enter `-console`. Preserve any arguments already there.
3. Launch WoW and open the developer console with the console key, usually the backtick/tilde key. The key can vary with your keyboard layout.
4. Enter this command in the developer console, not the chat box:

```text
ExportInterfaceFiles art
```

5. Allow the export to finish. It exports interface artwork, not just item icons; see the freeze and disk-space warning above.
6. Check that your WoW installation now contains:

```text
World of Warcraft/_retail_/BlizzardInterfaceArt/Interface/ICONS/
World of Warcraft/_forever_/BlizzardInterfaceArt/Interface/ICONS/
```

7. Restart the companion, click **Open game folder**, and choose the same `_retail_` or `_forever_` folder containing the export. You can remove `-console` from the Battle.net launch arguments afterward.

Only the path for the selected game needs to exist. Of the exported art, the companion needs only `BlizzardInterfaceArt/Interface/ICONS/` and its contents at that exact location inside the selected game folder. Other exported files and folders inside `BlizzardInterfaceArt/` can be deleted to reclaim disk space if no other tool needs them. Keep `ICONS`, its parent directory structure and your `WTF/Account` snapshots intact; do not delete the client's installed game files. This cleanup applies only to exported art.

Keep the exported `.blp` files in that directory structure; do not convert or copy them into the companion folder. Re-export after WoW updates if new items have missing icons. Some icons may remain unavailable if they are not present in the client export or the companion's included icon mapping.

Both game-folder selections have been user-tested. The export procedure has not been independently verified in Forever or a real Mac client.

## Run from Source

Install [Git](https://git-scm.com/downloads) and [Node.js 24 LTS](https://nodejs.org/), including npm. The public repository uses `main` as its default branch. Open PowerShell on Windows or Terminal on macOS and clone it:

```powershell
git clone --branch main https://github.com/SteveGreenTV/whatsinthebag-companion.git WITB_Companion
cd WITB_Companion
npm ci
npm run desktop
```

If you already checked out the repository, open a terminal in its root folder and run only `npm ci` and `npm run desktop`. The desktop command builds the interface and starts Electron. Open your `_retail_` or `_forever_` game folder just as you would in the downloaded app; WoW snapshots and icon exports are not included in the checkout.

For an optional browser version, run:

```powershell
npm run dev
```

Open the local URL printed by Vite in a Chromium-based browser. Allow folder access and popups for character windows. In an embedded VS Code/Electron browser preview, select only `_retail_/WTF/Account` or `_forever_/WTF/Account`; that preview can read snapshots but does not load exported icons. Stop the development server with Ctrl+C when finished.

The UI entry point is `src/main.ts`. Roster controls, item rendering and icon loading, and item search live in `src/roster.ts`, `src/item-renderer.ts`, and `src/item-search.ts`. Snapshot helpers are in `src/saved-variables.ts`; the restricted SavedVariables parser is in `src/lua-parser.ts`.

## Build a Windows EXE

After `npm ci`, run this in the repository root on Windows:

```powershell
npm run release:win:portable
```

This builds a Windows x64 portable executable at:

```text
release/WITB_Companion_0.6.0.exe
```

The filename follows the version in `package.json`. Run the EXE directly, or copy it to another Windows x64 computer. It includes Electron and does not require Node.js on that computer. Building locally does not publish a GitHub release.

## Build a macOS DMG

On macOS, after `npm ci`, run the command for your target architecture:

```sh
npm run release:mac:arm64
npm run release:mac:x64
```

Each command builds an ad-hoc-signed, unnotarized DMG in `release/`, named with the package version and architecture. The build uses the macOS `sips`, `iconutil`, and code-signing tools. Building locally does not publish a GitHub release.

## Test the macOS ARM64 Build in GitHub

The **macOS ARM64 test build** GitHub Actions workflow is manually triggered from **Actions > macOS ARM64 test build > Run workflow**. It uses a GitHub-hosted ARM64 macOS runner and runs `npm run release:mac:arm64` without publishing a GitHub release. On success, the generated DMG is uploaded as a workflow artifact. Run this early in release preparation to verify that the runner is available and has enough resources; do not continue with other release artifacts unless the ARM64 build succeeds.
