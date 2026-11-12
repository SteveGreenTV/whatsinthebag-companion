import initBlp, { blpToPng } from 'wow-blp-web';
import blpWasmUrl from 'wow-blp-web/wow_blp_web_bg.wasm?url';
import iconManifest from './icon-paths.json';
import { getSnapshotItemCounts, numberValue, stringValue, valueTable, type LuaTable } from './saved-variables';

export type IconFileSource = File | FileSystemFileHandle;

interface IconSources {
	artFiles: Map<string, IconFileSource>;
	browserIconDirectory: FileSystemDirectoryHandle | null;
	nativeGameSelection: boolean;
	nativeHasIcons: boolean;
}

interface ItemRendererDependencies {
	inventoryContent: HTMLElement;
	getAccount: () => LuaTable | null;
	getShowTooltipCategoryDetails: () => boolean;
	getIconSources: () => IconSources;
	getDirectoryPath: (root: FileSystemDirectoryHandle, path: string[]) => Promise<FileSystemDirectoryHandle | null>;
	readIcon: (iconPath: string) => Promise<ArrayBuffer>;
}

interface IconManifest {
	source: string;
	version: string;
	paths: Record<string, string>;
}

const qualityColors: Record<number, string> = {
	0: '#9d9d9d',
	1: '#f1f0e9',
	2: '#1eff00',
	3: '#0070dd',
	4: '#a335ee',
	5: '#ff8000',
	6: '#e6cc80',
	7: '#00ccff',
};

const upgradeTrackNames: Record<string, string> = {
	E: 'Explorer',
	A: 'Adventurer',
	V: 'Veteran',
	C: 'Champion',
	H: 'Hero',
	M: 'Myth',
};

export function createItemRenderer({
	inventoryContent, getAccount, getShowTooltipCategoryDetails, getIconSources, getDirectoryPath, readIcon,
}: ItemRendererDependencies) {
	const iconPaths = (iconManifest as IconManifest).paths;
	const itemTooltip = document.createElement('aside');
	itemTooltip.className = 'snapshot-item-tooltip';
	itemTooltip.setAttribute('role', 'tooltip');
	itemTooltip.hidden = true;
	document.body.append(itemTooltip);

	let wasmReady: Promise<unknown> | undefined;
	const decodedIcons = new Map<string, string>();
	const decodedBlps = new Map<string, Promise<Uint8Array>>();
	const pendingIconLoads = new WeakMap<HTMLImageElement, { iconPath: string; file?: IconFileSource; frame: HTMLElement }>();
	let iconObserver: IntersectionObserver | null = null;

	function normalizePath(path: string): string {
		const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
		const interfaceIndex = normalized.indexOf('interface/');
		const relative = interfaceIndex >= 0 ? normalized.slice(interfaceIndex)
			: /^icons\//.test(normalized) ? `interface/${normalized}` : normalized;
		if (relative.split('/').some((part) => part === '..')) return '';
		return relative;
	}

	function hideItemTooltip(): void {
		itemTooltip.hidden = true;
		itemTooltip.replaceChildren();
	}

	function showItemTooltip(card: HTMLElement, item: LuaTable): void {
		const account = getAccount();
		const showTooltipCategoryDetails = getShowTooltipCategoryDetails();
		itemTooltip.replaceChildren();
		const quality = numberValue(item.quality);
		const qualityColor = qualityColors[quality ?? 1] || qualityColors[1];
		const name = document.createElement('strong');
		name.className = 'snapshot-item-tooltip-name';
		name.textContent = stringValue(item.name, 'Unknown item');
		name.style.color = qualityColor;
		itemTooltip.append(name);

		const itemLevel = numberValue(item.itemLevel);
		if (itemLevel !== null && itemLevel > 0) {
			const line = document.createElement('div');
			line.className = 'snapshot-item-tooltip-item-level';
			line.textContent = `Item Level ${itemLevel}`;
			itemTooltip.append(line);
		}
		const upgrade = valueTable(item.upgradeInfo);
		if (upgrade) {
			const trackValue = stringValue(upgrade.trackString).trim();
			const track = upgradeTrackNames[trackValue.toLocaleUpperCase()] || trackValue;
			const current = numberValue(upgrade.currentLevel);
			const maximum = numberValue(upgrade.maxLevel);
			if (track && current !== null && maximum !== null && current > 0 && maximum > 0) {
				const line = document.createElement('div');
				line.className = 'snapshot-item-tooltip-upgrade';
				line.textContent = `Upgrade Level: ${track} ${current}/${maximum}`;
				itemTooltip.append(line);
			}
		}
		if (item.warbound === true || item.soulbound === true) {
			const line = document.createElement('div');
			line.className = item.warbound === true
				? 'snapshot-item-tooltip-binding warbound'
				: 'snapshot-item-tooltip-binding soulbound';
			line.textContent = item.warbound === true ? 'Warbound until equipped' : 'Soulbound';
			itemTooltip.append(line);
		}
		const itemID = numberValue(item.itemID);
		if (account && itemID !== null) {
			const counts = getSnapshotItemCounts(account, itemID);
			if (counts.total > 0) {
				const countSection = document.createElement('div');
				countSection.className = 'snapshot-item-tooltip-counts';
				const appendCount = (label: string, value: number, kind = 'character'): void => {
					const row = document.createElement('div');
					row.className = `snapshot-item-tooltip-count ${kind}`;
					const name = document.createElement('span');
					name.textContent = label;
					const amount = document.createElement('span');
					amount.textContent = String(value);
					row.append(name, amount);
					countSection.append(row);
				};
				for (const character of counts.characters) {
					const name = character.realm ? `${character.name} - ${character.realm}` : character.name;
					appendCount(name, character.count);
				}
				if (counts.warbandCount > 0) appendCount('Warband', counts.warbandCount, 'warband');
				appendCount('Overall total', counts.total, 'total');
				itemTooltip.append(countSection);
			}
		}
		const category = stringValue(item.category);
		const subcategory = stringValue(item.itemSubtype);
		if (showTooltipCategoryDetails && (category || subcategory)) {
			const categorySection = document.createElement('div');
			categorySection.className = 'snapshot-item-tooltip-classifications';
			const appendClassification = (label: string, value: string): void => {
				const row = document.createElement('div');
				row.className = 'snapshot-item-tooltip-classification';
				const field = document.createElement('span');
				field.textContent = label;
				const text = document.createElement('span');
				text.textContent = value;
				row.append(field, text);
				categorySection.append(row);
			};
			if (category) appendClassification('Category', category);
			if (subcategory) appendClassification('Subcategory', subcategory);
			itemTooltip.append(categorySection);
		}

		itemTooltip.hidden = false;
		const cardBounds = card.getBoundingClientRect();
		const tooltipBounds = itemTooltip.getBoundingClientRect();
		const gap = 10;
		const viewportPadding = 8;
		const preferredLeft = cardBounds.right + gap;
		const left = preferredLeft + tooltipBounds.width <= window.innerWidth - viewportPadding
			? preferredLeft
			: Math.max(viewportPadding, cardBounds.left - tooltipBounds.width - gap);
		const top = Math.max(viewportPadding,
			Math.min(cardBounds.top, window.innerHeight - tooltipBounds.height - viewportPadding));
		itemTooltip.style.left = `${left}px`;
		itemTooltip.style.top = `${top}px`;
	}

	function createItemCard(item: LuaTable): HTMLElement {
		const { artFiles, browserIconDirectory, nativeGameSelection, nativeHasIcons } = getIconSources();
		const card = document.createElement('article');
		card.className = 'item-card';
		card.addEventListener('pointerenter', () => showItemTooltip(card, item));
		card.addEventListener('pointerleave', hideItemTooltip);
		const iconFrame = document.createElement('div');
		iconFrame.className = 'item-icon-frame';
		const quality = numberValue(item.quality);
		iconFrame.style.setProperty('--quality-color', qualityColors[quality ?? 1] || qualityColors[1]);
		const iconID = numberValue(item.icon);
		const iconPath = iconID === null ? '' : normalizePath(iconPaths[String(iconID)] || '');
		const iconFile = iconPath.startsWith('interface/icons/') ? artFiles.get(iconPath) : undefined;
		const isIconPath = iconPath.startsWith('interface/icons/');
		const hasIcon = Boolean(iconFile) || (browserIconDirectory !== null && isIconPath)
			|| (nativeGameSelection && nativeHasIcons && isIconPath);
		if (hasIcon) {
			const image = document.createElement('img');
			image.className = 'item-icon';
			image.alt = '';
			image.loading = 'lazy';
			image.dataset.filePath = iconPath;
			image.dataset.iconId = String(iconID);
			observeIcon(image, iconPath, iconFile, iconFrame);
			iconFrame.append(image);
		} else {
			iconFrame.classList.add('icon-missing');
		}
		const itemLevel = numberValue(item.itemLevel);
		if (itemLevel !== null && itemLevel > 0) {
			const level = document.createElement('span');
			level.className = 'item-level-overlay';
			level.textContent = String(itemLevel);
			iconFrame.append(level);
		}
		const count = numberValue(item.count);
		if (count !== null && count > 1) {
			const amount = document.createElement('span');
			amount.className = 'item-count-overlay';
			amount.textContent = String(count);
			iconFrame.append(amount);
		}
		const name = document.createElement('div');
		name.className = 'item-name';
		name.textContent = stringValue(item.name, 'Unknown item');
		name.style.color = qualityColors[quality ?? 1] || qualityColors[1];
		const details = document.createElement('div');
		details.className = 'item-details';
		const upgrade = valueTable(item.upgradeInfo);
		if (upgrade) {
			const track = [...stringValue(upgrade.trackString).trim()][0]?.toLocaleUpperCase();
			const current = numberValue(upgrade.currentLevel);
			const maximum = numberValue(upgrade.maxLevel);
			if (track && current !== null && current > 0 && maximum !== null && maximum > 0) {
				const upgradeLevel = document.createElement('span');
				upgradeLevel.className = 'item-upgrade-overlay';
				upgradeLevel.textContent = `${track}${current}/${maximum}`;
				iconFrame.append(upgradeLevel);
			}
		}
		const textWrap = document.createElement('div');
		textWrap.className = 'item-text';
		textWrap.append(name, details);
		card.append(iconFrame, textWrap);
		return card;
	}

	async function getBrowserIconHandle(iconPath: string): Promise<FileSystemFileHandle | undefined> {
		const { browserIconDirectory } = getIconSources();
		if (!browserIconDirectory) return undefined;
		const segments = iconPath.split('/');
		if (segments[0] !== 'interface' || segments[1] !== 'icons') return undefined;
		const fileName = segments.pop();
		if (!fileName) return undefined;
		try {
			const directory = await getDirectoryPath(browserIconDirectory, segments.slice(2));
			return directory ? await directory.getFileHandle(fileName) : undefined;
		} catch {
			return undefined;
		}
	}

	async function decodeBlp(iconPath: string, file?: IconFileSource): Promise<Uint8Array> {
		const key = iconPath;
		const existing = decodedBlps.get(key);
		if (existing) return existing;
		const decoding = (async () => {
			wasmReady ??= initBlp({ module_or_path: blpWasmUrl });
			await wasmReady;
			let blpBytes: Uint8Array;
			const { browserIconDirectory } = getIconSources();
			if (file) {
				blpBytes = new Uint8Array(await (file instanceof File ? file : await file.getFile()).arrayBuffer());
			} else if (browserIconDirectory) {
				const iconHandle = await getBrowserIconHandle(iconPath);
				if (!iconHandle) throw new Error(`Icon not found: ${iconPath}`);
				blpBytes = new Uint8Array(await (await iconHandle.getFile()).arrayBuffer());
			} else {
				blpBytes = new Uint8Array(await readIcon(iconPath));
			}
			return new Uint8Array(blpToPng(blpBytes));
		})();
		decodedBlps.set(key, decoding);
		try {
			return await decoding;
		} catch (error) {
			decodedBlps.delete(key);
			throw error;
		}
	}

	function pngBlob(bytes: Uint8Array): Blob {
		const buffer = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(buffer).set(bytes);
		return new Blob([buffer], { type: 'image/png' });
	}

	async function loadIcon(iconPath: string, file?: IconFileSource): Promise<string> {
		const existing = decodedIcons.get(iconPath);
		if (existing) return existing;
		const bytes = await decodeBlp(iconPath, file);
		const url = URL.createObjectURL(pngBlob(bytes));
		decodedIcons.set(iconPath, url);
		return url;
	}

	function observeIcon(image: HTMLImageElement, iconPath: string, file: IconFileSource | undefined, frame: HTMLElement): void {
		if (typeof IntersectionObserver === 'undefined') {
			void loadIcon(iconPath, file).then((url) => { image.src = url; }).catch(() => frame.classList.add('icon-missing'));
			return;
		}
		iconObserver ??= new IntersectionObserver((entries, observer) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const target = entry.target as HTMLImageElement;
				observer.unobserve(target);
				const pending = pendingIconLoads.get(target);
				pendingIconLoads.delete(target);
				if (!pending || !target.isConnected) continue;
				void loadIcon(pending.iconPath, pending.file)
					.then((url) => { if (target.isConnected) target.src = url; })
					.catch(() => { if (pending.frame.isConnected) pending.frame.classList.add('icon-missing'); });
			}
		}, { root: inventoryContent, rootMargin: '160px' });
		pendingIconLoads.set(image, { iconPath, file, frame });
		iconObserver.observe(image);
	}

	return {
		createItemCard,
		hideItemTooltip,
		disconnectIcons: () => iconObserver?.disconnect(),
		clearIconCache: () => { decodedIcons.clear(); decodedBlps.clear(); },
	};
}
