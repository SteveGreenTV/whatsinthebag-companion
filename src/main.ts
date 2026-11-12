import { createItemRenderer, type IconFileSource } from './item-renderer';
import { createRosterController, type Selection, type StorageKey } from './roster';
import { itemMatchesSearch, parseSearch } from './item-search';
import {
	compareSnapshotItems,
	getSnapshotEquipmentSlots,
	groupSnapshotItemsBySubcategory,
	isLuaTable,
	parseSavedVariables,
	numberValue,
	stringValue,
	tableValues,
	valueTable,
	type LuaTable,
	type LuaValue,
} from './saved-variables';

interface FileWithPath extends File {
	webkitRelativePath: string;
}

interface SnapshotFile {
	accountName: string;
	file?: File;
	handle?: FileSystemFileHandle;
}

type AsyncDirectoryHandle = FileSystemDirectoryHandle & {
	entries: () => AsyncIterable<[string, FileSystemHandle]>;
};
type WindowWithDirectoryPicker = Window & {
	showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

interface SnapshotHostSelection {
	canceled: boolean;
	hasIcons?: boolean;
	accounts?: string[];
}

interface SnapshotHost {
	selectGameFolder: () => Promise<SnapshotHostSelection>;
	readAccount: (accountName: string) => Promise<string>;
	readIcon: (iconPath: string) => Promise<ArrayBuffer>;
}

declare global {
	interface Window {
		snapshotHost?: SnapshotHost;
	}
}

interface DecodedIcon {
	width: number;
	height: number;
	rgba: Uint8Array;
}

const labels = {
	bags: 'BAGS',
	characterBank: 'CHARACTER BANK',
	warband: 'WARBAND BANK',
} satisfies Record<StorageKey, string>;

const gameFolderInput = document.querySelector<HTMLInputElement>('#game-folder')!;
const gameFolderControl = document.querySelector<HTMLLabelElement>('#game-folder-control')!;
const accountSelect = document.querySelector<HTMLSelectElement>('#account-select')!;
const accountToggle = document.querySelector<HTMLButtonElement>('#account-toggle')!;
const accountList = document.querySelector<HTMLElement>('#account-list')!;
const sourceStatus = document.querySelector<HTMLElement>('#source-status')!;
const sourceProgress = document.querySelector<HTMLProgressElement>('#source-progress')!;
const frameState = document.querySelector<HTMLElement>('#window-state')!;
const characterList = document.querySelector<HTMLElement>('#character-list')!;
const characterToggle = document.querySelector<HTMLButtonElement>('#character-toggle')!;
const characterSelectionLabel = document.querySelector<HTMLElement>('#character-selection-label')!;
const settingsToggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
const settingsMenu = document.querySelector<HTMLElement>('#settings-menu')!;
const tooltipCategoryToggle = document.querySelector<HTMLInputElement>('#tooltip-category-toggle')!;
const categoryList = document.querySelector<HTMLElement>('#category-list')!;
const categoryTotal = document.querySelector<HTMLElement>('#category-total')!;
const toggleAllCategories = document.querySelector<HTMLButtonElement>('#toggle-all-categories')!;
const inventoryContent = document.querySelector<HTMLElement>('#inventory-content')!;
const searchInput = document.querySelector<HTMLInputElement>('#search')!;
const filterMenu = document.querySelector<HTMLElement>('#filter-menu')!;
const filterToggle = document.querySelector<HTMLButtonElement>('#filter-toggle')!;
const filterClear = document.querySelector<HTMLButtonElement>('#filter-clear')!;
const viewMenu = document.querySelector<HTMLElement>('#view-menu')!;
const viewToggle = document.querySelector<HTMLButtonElement>('#view-toggle')!;
const viewCheckAll = document.querySelector<HTMLButtonElement>('#view-check-all')!;
const viewUncheckAll = document.querySelector<HTMLButtonElement>('#view-uncheck-all')!;
const appFrame = document.querySelector<HTMLElement>('.frame')!;
const accountTitle = document.querySelector<HTMLElement>('#storage-title')!;
const storageLabel = document.querySelector<HTMLElement>('#storage-label')!;
const captureTime = document.querySelector<HTMLElement>('#capture-time')!;
const footerMessage = document.querySelector<HTMLElement>('#footer-message')!;
const windowTitle = document.querySelector<HTMLHeadingElement>('#window-title')!;
let account: LuaTable | null = null;
let loadedAccountName: string | null = null;
const storageWindows = new Set<Window>();
let artFiles = new Map<string, IconFileSource>();
let snapshotFiles: SnapshotFile[] = [];
let gameScanGeneration = 0;
let nativeGameSelection = false;
let nativeHasIcons = false;
let browserIconDirectory: FileSystemDirectoryHandle | null = null;
let useDirectoryInputFallback = false;
const windowParameters = new URLSearchParams(location.search);
const requestedStorage = windowParameters.get('storage');
const requestedCharacterKey = windowParameters.get('characterKey');
const requestedAccountName = windowParameters.get('accountName');
const popupChannelToken = windowParameters.get('snapshotChannel');
const requestedSelection: Selection | null = requestedStorage === 'bags' || requestedStorage === 'characterBank'
	? { characterKey: requestedCharacterKey, storage: requestedStorage }
	: requestedStorage === 'warband' ? { characterKey: null, storage: 'warband' } : null;
if (requestedSelection) appFrame.classList.add('storage-window');
let selection: Selection = requestedSelection || { characterKey: null, storage: 'warband' };
let hiddenCategories = new Set<string>();
let activeCategory: string | null = null;
let viewOptions = { category: true, subcategory: true, itemNames: true, sortByItemLevel: false };
let showTooltipCategoryDetails = readTooltipCategoryPreference();
const { createItemCard, hideItemTooltip, disconnectIcons, clearIconCache } = createItemRenderer({
	inventoryContent,
	getAccount: () => account,
	getShowTooltipCategoryDetails: () => showTooltipCategoryDetails,
	getIconSources: () => ({ artFiles, browserIconDirectory, nativeGameSelection, nativeHasIcons }),
	getDirectoryPath,
	readIcon: (iconPath) => window.snapshotHost!.readIcon(iconPath),
});

const { renderRoster, clearSearch: clearRosterSearch } = createRosterController({
	characterList,
	characterToggle,
	characterSelectionLabel,
	getAccount: () => account,
	getSelection: () => selection,
	makeEmptyRail,
	onStorageSelected: (characterKey, storage) => {
		if (characterKey !== null && storage !== 'warband') {
			closeCharacterMenu();
			openStorageWindow(characterKey, storage);
			return;
		}
		resetSnapshotFilters();
		selection = { characterKey, storage };
		closeCharacterMenu();
		renderRoster();
		renderInventory();
	},
});

function readTooltipCategoryPreference(): boolean {
	try {
		return window.localStorage.getItem('witbCompanion.showTooltipCategoryDetails') === 'true';
	} catch {
		return false;
	}
}

tooltipCategoryToggle.checked = showTooltipCategoryDetails;

function relativeFilePath(file: File): string {
	return ((file as FileWithPath).webkitRelativePath || file.name).replaceAll('\\', '/');
}

function getSnapshotAccountName(path: string): string | null {
	return path.match(/(?:^|\/)WTF\/Account\/([^/]+)\/SavedVariables\/WhatsInTheBag\.lua$/i)?.[1]
		|| path.match(/(?:^|\/)Account\/([^/]+)\/SavedVariables\/WhatsInTheBag\.lua$/i)?.[1]
		|| null;
}

function prepareDirectoryInputFallback(): void {
	useDirectoryInputFallback = true;
	gameFolderControl.title = 'Select WTF/Account inside _retail_ or _forever_';
	gameFolderInput.setAttribute('aria-label', 'Open game folder: select WTF/Account inside _retail_ or _forever_');
	hideSourceProgress();
	sourceStatus.textContent = 'Select the WTF/Account folder';
	frameState.textContent = 'SELECT FOLDER';
}

async function getDirectoryPath(root: FileSystemDirectoryHandle, path: string[]): Promise<FileSystemDirectoryHandle | null> {
	let current = root;
	try {
		for (const part of path) current = await current.getDirectoryHandle(part);
		return current;
	} catch {
		return null;
	}
}

function showSourceProgress(message: string, value?: number): void {
	sourceStatus.textContent = message;
	sourceProgress.hidden = false;
	sourceProgress.removeAttribute('value');
	if (value !== undefined) sourceProgress.value = Math.max(0, Math.min(100, value));
	sourceProgress.setAttribute('aria-valuetext', message);
}

function hideSourceProgress(): void {
	sourceProgress.hidden = true;
	sourceProgress.value = 0;
	sourceProgress.removeAttribute('value');
	sourceProgress.removeAttribute('aria-valuetext');
}

function closeStorageWindows(): void {
	for (const storageWindow of storageWindows) {
		if (!storageWindow.closed) storageWindow.close();
	}
	storageWindows.clear();
}

function clearSnapshotData(message: string): void {
	closeStorageWindows();
	hideSourceProgress();
	hideItemTooltip();
	account = null;
	loadedAccountName = null;
	selection = { characterKey: null, storage: 'warband' };
	accountSelect.value = '';
	renderAccountPicker();
	resetSnapshotFilters();
	characterToggle.disabled = true;
	characterSelectionLabel.textContent = 'Choose character';
	characterList.classList.remove('roster-list');
	clearRosterSearch();
	characterList.replaceChildren(makeEmptyRail(message));
	categoryList.replaceChildren(makeEmptyRail('Load a snapshot to see categories'));
	categoryTotal.textContent = '';
	storageLabel.textContent = 'NO SNAPSHOT SELECTED';
	accountTitle.textContent = 'Choose a character';
	captureTime.textContent = '';
	footerMessage.textContent = 'READ-ONLY SNAPSHOTS';
	inventoryContent.replaceChildren(document.querySelector('.welcome-state')?.cloneNode(true) || document.createElement('div'));
	closeMenus();
}

function setError(message: string): void {
	clearSnapshotData(message);
	storageLabel.textContent = 'SNAPSHOT FILE ERROR';
	accountTitle.textContent = 'Unable to load snapshots';
	footerMessage.textContent = 'FILE WAS NOT MODIFIED';
	sourceStatus.textContent = 'Could not load account snapshot';
	frameState.textContent = 'CHECK FILE';
	showMessage(message, 'error');
}

function makeEmptyRail(message: string): HTMLElement {
	const empty = document.createElement('div');
	empty.className = 'rail-empty';
	const text = document.createElement('span');
	text.textContent = message;
	empty.append(text);
	return empty;
}

function renderAccountPicker(): void {
	const options = [...accountSelect.options].filter((option) => option.value !== '');
	accountToggle.disabled = accountSelect.disabled || options.length === 0;
	const selectedAccount = accountSelect.value ? accountSelect.selectedOptions[0]?.textContent : '';
	accountToggle.title = selectedAccount ? `Select account · ${selectedAccount}` : 'Select account';
	accountToggle.setAttribute('aria-label', 'Select account');
	accountList.replaceChildren();
	const heading = document.createElement('h2');
	heading.className = 'roster-heading';
	heading.id = 'accounts-heading';
	heading.textContent = 'Accounts';
	accountList.setAttribute('aria-labelledby', heading.id);
	accountList.append(heading);
	if (!options.length) {
		accountList.append(makeEmptyRail('Select a snapshot file'));
		return;
	}
	for (const option of options) {
		const button = document.createElement('button');
		button.className = 'menu-reset account-option';
		button.type = 'button';
		button.textContent = option.textContent || option.value;
		button.setAttribute('aria-pressed', String(accountSelect.value === option.value));
		button.addEventListener('click', () => {
			accountSelect.value = option.value;
			closeAccountMenu();
			renderAccountPicker();
			accountSelect.dispatchEvent(new Event('change', { bubbles: true }));
		});
		accountList.append(button);
	}
}

function showMessage(message: string, kind: 'empty' | 'error' = 'empty'): void {
	const panel = document.createElement('div');
	panel.className = `empty-state ${kind}`;
	const title = document.createElement('h3');
	title.textContent = kind === 'error' ? 'Snapshot could not be read' : 'No saved items here';
	const body = document.createElement('p');
	body.textContent = message;
	panel.append(title, body);
	inventoryContent.replaceChildren(panel);
}

function closeCharacterMenu(): void {
	characterList.hidden = true;
	characterToggle.setAttribute('aria-expanded', 'false');
}

function closeAccountMenu(): void {
	accountList.hidden = true;
	accountToggle.setAttribute('aria-expanded', 'false');
}

function closeMenus(): void {
	closeAccountMenu();
	closeCharacterMenu();
	filterMenu.hidden = true;
	viewMenu.hidden = true;
	settingsMenu.hidden = true;
	filterToggle.setAttribute('aria-expanded', 'false');
	viewToggle.setAttribute('aria-expanded', 'false');
	settingsToggle.setAttribute('aria-expanded', 'false');
}

function resetSnapshotFilters(): void {
	for (const input of filterMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
	for (const input of viewMenu.querySelectorAll<HTMLInputElement>('input')) {
		input.checked = input.value !== 'sortByItemLevel';
	}
	viewOptions = { category: true, subcategory: true, itemNames: true, sortByItemLevel: false };
	hiddenCategories = new Set();
	activeCategory = null;
	searchInput.value = '';
}

function openStorageWindow(characterKey: string, storage: 'bags' | 'characterBank'): void {
	if (!account) return;
	const url = new URL(location.href);
	url.searchParams.set('characterKey', characterKey);
	url.searchParams.set('storage', storage);
	if (loadedAccountName) url.searchParams.set('accountName', loadedAccountName);
	url.searchParams.set('icons', String(nativeHasIcons));
	let channel: BroadcastChannel | null = null;
	if (!window.snapshotHost) {
		const token = crypto.randomUUID();
		url.searchParams.set('snapshotChannel', token);
		channel = new BroadcastChannel(token);
		channel.addEventListener('message', (event: MessageEvent) => {
			if (event.data?.type === 'window-closed') {
				channel?.close();
				return;
			}
			if (event.data?.type !== 'request-snapshot' || !account) return;
			const payload = { type: 'snapshot', account, artFiles: [...artFiles], browserIconDirectory };
			try {
				channel?.postMessage(payload);
			} catch {
				try {
					channel?.postMessage({ type: 'snapshot', account, artFiles: [...artFiles] });
				} catch {
					channel?.postMessage({ type: 'snapshot', account });
				}
			}
		});
	}
	const child = window.open(url, '_blank');
	if (!child) {
		channel?.close();
		sourceStatus.textContent = 'Allow popups to open the selected storage in a new window';
	} else {
		storageWindows.add(child);
	}
}

function currentSnapshot(): LuaTable | null {
	if (!account) return null;
	if (selection.storage === 'warband') return valueTable(account.warbandSnapshot);
	const character = valueTable(valueTable(account.characterSnapshots)?.[selection.characterKey || '']);
	if (!character) return null;
	return valueTable(character[selection.storage]);
}

function defaultSelection(loadedAccount: LuaTable): Selection {
	if (isLuaTable(loadedAccount.warbandSnapshot)) return { characterKey: null, storage: 'warband' };
	const characters = Object.entries(valueTable(loadedAccount.characterSnapshots) || {});
	const withBags = characters.find(([, record]) => isLuaTable(record) && isLuaTable(record.bags));
	if (withBags) return { characterKey: withBags[0], storage: 'bags' };
	const withBank = characters.find(([, record]) => isLuaTable(record) && isLuaTable(record.characterBank));
	return withBank ? { characterKey: withBank[0], storage: 'characterBank' } : { characterKey: null, storage: 'warband' };
}

function setLoadedAccount(loadedAccount: LuaTable, preferredSelection: Selection | null, accountName: string | null): void {
	clearRosterSearch();
	account = loadedAccount;
	loadedAccountName = accountName;
	selection = preferredSelection || defaultSelection(loadedAccount);
	renderRoster();
	renderInventory();
}

function formatCaptureTime(value: LuaValue | undefined): string {
	const timestamp = numberValue(value);
	if (timestamp === null || timestamp <= 0) return 'Capture time unavailable';
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp * 1000));
}

function addBadge(parent: HTMLElement, text: string): void {
	const badge = document.createElement('span');
	badge.className = 'item-badge';
	badge.textContent = text;
	parent.append(badge);
}

function renderCategoryList(groups: Map<string, LuaTable[]>, groupOrders?: Map<string, number>): void {
	categoryTotal.textContent = groups.size ? String(groups.size) : '';
	toggleAllCategories.disabled = groups.size === 0;
	const anyVisible = [...groups.keys()].some((category) => !hiddenCategories.has(category));
	toggleAllCategories.textContent = anyVisible ? '◉' : '○';
	toggleAllCategories.title = anyVisible ? 'Hide all categories' : 'Show all categories';
	toggleAllCategories.setAttribute('aria-label', toggleAllCategories.title);
	toggleAllCategories.setAttribute('aria-pressed', String(anyVisible));
	categoryList.replaceChildren();
	if (!groups.size) {
		categoryList.append(makeEmptyRail('No matching categories'));
		return;
	}

	for (const [category, items] of [...groups.entries()]
		.sort(([left], [right]) => {
			if (groupOrders) {
				const order = (groupOrders.get(left) ?? Number.MAX_SAFE_INTEGER)
					- (groupOrders.get(right) ?? Number.MAX_SAFE_INTEGER);
				if (order) return order;
			}
			return left.localeCompare(right, undefined, { sensitivity: 'base' });
		})) {
		const row = document.createElement('div');
		row.className = 'category-row';
		const hidden = hiddenCategories.has(category);
		if (hidden) row.classList.add('is-hidden');
		const name = document.createElement('button');
		name.className = 'category-name';
		name.type = 'button';
		name.textContent = category;
		name.title = category;
		name.setAttribute('aria-current', String(activeCategory === category));
		name.addEventListener('click', () => {
			hiddenCategories.delete(category);
			activeCategory = category;
			renderInventory();
			requestAnimationFrame(() => {
				const target = [...inventoryContent.querySelectorAll<HTMLElement>('.category-section')]
					.find((section) => section.dataset.category === category);
				target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
			});
		});
		const count = document.createElement('span');
		count.className = 'category-count';
		count.textContent = String(items.length);
		const eye = document.createElement('button');
		eye.className = 'category-visibility';
		eye.type = 'button';
		eye.textContent = hidden ? '○' : '◉';
		eye.title = hidden ? `Show ${category}` : `Hide ${category}`;
		eye.setAttribute('aria-label', eye.title);
		eye.setAttribute('aria-pressed', String(!hidden));
		eye.addEventListener('click', () => {
			if (hiddenCategories.has(category)) hiddenCategories.delete(category);
			else hiddenCategories.add(category);
			if (activeCategory === category && hiddenCategories.has(category)) activeCategory = null;
			renderInventory();
		});
		row.append(name, count, eye);
		categoryList.append(row);
	}
}

function appendItemGrid(
	parent: HTMLElement,
	items: LuaTable[],
	equipmentOrder = filterMenu.querySelector<HTMLInputElement>('input[value="equipment"]')?.checked === true,
): void {
	const grid = document.createElement('div');
	grid.className = 'item-grid';
	const sortedItems = [...items].sort((left, right) => compareSnapshotItems(left, right, {
		equipment: equipmentOrder,
		sortByItemLevel: viewOptions.sortByItemLevel,
	}));
	for (const item of sortedItems) grid.append(createItemCard(item));
	parent.append(grid);
}

function appendSubcategoryGroups(parent: HTMLElement, items: LuaTable[], equipmentOrder: boolean): void {
	for (const [subtype, subtypeItems] of groupSnapshotItemsBySubcategory(items)) {
		const heading = document.createElement('h4');
		heading.className = 'subtype-heading';
		heading.textContent = subtype || 'Other';
		parent.append(heading);
		appendItemGrid(parent, subtypeItems, equipmentOrder);
	}
}

function renderInventory(): void {
	hideItemTooltip();
	if (!account) return;
	disconnectIcons();
	const snapshot = currentSnapshot();
	const character = valueTable(valueTable(account.characterSnapshots)?.[selection.characterKey || '']);
	const characterName = selection.storage === 'warband'
		? 'Warband'
		: stringValue(character?.name, selection.characterKey || 'Character');
	accountTitle.textContent = `${characterName} · ${labels[selection.storage]}`;
	const realmName = stringValue(character?.realm);
	const storageTitle = selection.storage === 'bags' ? 'Bags' : selection.storage === 'characterBank' ? 'Bank' : 'Warband Bank';
	windowTitle.textContent = requestedSelection
		? [characterName, realmName, storageTitle].filter(Boolean).join(' · ')
		: "What's in the bag?";
	document.title = `${characterName} · ${labels[selection.storage]} | What's in the bag?`;
	storageLabel.textContent = selection.storage === 'bags' ? 'CARRIED SNAPSHOT' : 'SAVED BANK SNAPSHOT';
	captureTime.textContent = snapshot ? formatCaptureTime(snapshot.capturedAt) : '';
	if (!snapshot) {
		renderCategoryList(new Map());
		showMessage(selection.storage === 'characterBank' ? 'This character has no saved bank snapshot.' : 'No snapshot is available for this storage.');
		return;
	}

	const filters = new Set([...filterMenu.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value));
	const equipmentOnly = filters.has('equipment');
	const terms = parseSearch(searchInput.value, filters);
	const bags = tableValues(snapshot.bags).map(valueTable).filter((bag): bag is LuaTable => bag !== null);
	const records = bags.flatMap((bag) => tableValues(bag.items)
		.map(valueTable)
		.filter((item): item is LuaTable => item !== null))
		.filter((item) => itemMatchesSearch(item, terms));
	const equipmentGroupOrders = new Map<string, number>();
	const groups = new Map<string, LuaTable[]>();
	const addToGroup = (name: string, item: LuaTable): void => {
		const groupedItems = groups.get(name) || [];
		groupedItems.push(item);
		groups.set(name, groupedItems);
	};
	if (equipmentOnly) {
		for (const item of records) {
			for (const slot of getSnapshotEquipmentSlots(item)) {
				addToGroup(slot.name, item);
				equipmentGroupOrders.set(slot.name, slot.order);
			}
		}
	} else {
		for (const item of records) addToGroup(stringValue(item.category) || 'Other', item);
	}
	renderCategoryList(groups, equipmentOnly ? equipmentGroupOrders : undefined);
	appFrame.classList.toggle('hide-item-names', !viewOptions.itemNames);
	const visibleGroups = [...groups.entries()]
		.filter(([category]) => !hiddenCategories.has(category))
		.sort(([left], [right]) => equipmentOnly
			? (equipmentGroupOrders.get(left) ?? Number.MAX_SAFE_INTEGER)
				- (equipmentGroupOrders.get(right) ?? Number.MAX_SAFE_INTEGER)
				|| left.localeCompare(right, undefined, { sensitivity: 'base' })
			: left.localeCompare(right, undefined, { sensitivity: 'base' }));
	const visibleItems = visibleGroups.flatMap(([, items]) => items);
	if (!visibleItems.length) {
		showMessage('No items match this search and filter combination.');
		footerMessage.textContent = hiddenCategories.size && records.length
			? `${records.length} MATCHING SLOTS · CATEGORIES HIDDEN`
			: '0 MATCHING SLOTS · READ ONLY';
		return;
	}

	const visibleUniqueItems = new Set(visibleItems).size;
	const fragment = document.createDocumentFragment();
	if (viewOptions.category) {
		for (const [category, items] of visibleGroups) {
			const section = document.createElement('section');
			section.className = 'category-section';
			section.dataset.category = category;
			if (activeCategory === category) section.classList.add('is-active');
			const heading = document.createElement('h3');
			heading.className = 'category-heading';
			heading.textContent = category;
			section.append(heading);
			if (viewOptions.subcategory) appendSubcategoryGroups(section, items, false);
			else appendItemGrid(section, items, false);
			fragment.append(section);
		}
	} else {
		const section = document.createElement('section');
		section.className = 'category-section';
		if (viewOptions.subcategory) appendSubcategoryGroups(section, visibleItems, equipmentOnly);
		else appendItemGrid(section, visibleItems, equipmentOnly);
		fragment.append(section);
	}
	inventoryContent.replaceChildren(fragment);
	footerMessage.textContent = `${visibleUniqueItems} MATCHING SLOTS · READ ONLY`;
}

function getSnapshotCategories(): Set<string> {
	const snapshot = currentSnapshot();
	if (!snapshot) return new Set();
	const categories = new Set<string>();
	const equipmentOnly = filterMenu.querySelector<HTMLInputElement>('input[value="equipment"]')?.checked === true;
	for (const bagValue of tableValues(snapshot.bags)) {
		const bag = valueTable(bagValue);
		if (!bag) continue;
		for (const itemValue of tableValues(bag.items)) {
			const item = valueTable(itemValue);
			if (!item) continue;
			if (equipmentOnly) {
				for (const slot of getSnapshotEquipmentSlots(item)) categories.add(slot.name);
			} else {
				categories.add(stringValue(item.category) || 'Other');
			}
		}
	}
	return categories;
}

function setAllCategoriesVisible(): void {
	const categories = getSnapshotCategories();
	const shouldHide = [...categories].some((category) => !hiddenCategories.has(category));
	for (const category of categories) {
		if (shouldHide) hiddenCategories.add(category);
		else hiddenCategories.delete(category);
	}
	activeCategory = null;
	renderInventory();
}

function handleQuickFilterChange(event: Event): void {
	const changed = event.target;
	if (changed instanceof HTMLInputElement && changed.value === 'equipment') {
		hiddenCategories = new Set();
		activeCategory = null;
	}
	if (!(changed instanceof HTMLInputElement) || changed.type !== 'checkbox' || !changed.checked) {
		renderInventory();
		return;
	}
	if (changed.value === 'soulbound' || changed.value === 'warbound') {
		const opposite = changed.value === 'soulbound' ? 'warbound' : 'soulbound';
		const input = filterMenu.querySelector<HTMLInputElement>(`input[value="${opposite}"]`);
		if (input) input.checked = false;
	} else if (changed.value.startsWith('armor:')) {
		for (const input of filterMenu.querySelectorAll<HTMLInputElement>('input[value^="armor:"]')) {
			if (input !== changed) input.checked = false;
		}
	}
	renderInventory();
}

function syncViewOptions(): void {
	viewOptions = {
		category: viewMenu.querySelector<HTMLInputElement>('input[value="category"]')?.checked === true,
		subcategory: viewMenu.querySelector<HTMLInputElement>('input[value="subcategory"]')?.checked === true,
		itemNames: viewMenu.querySelector<HTMLInputElement>('input[value="itemNames"]')?.checked === true,
		sortByItemLevel: viewMenu.querySelector<HTMLInputElement>('input[value="sortByItemLevel"]')?.checked === true,
	};
	renderInventory();
}

function setAllViewOptions(checked: boolean): void {
	for (const value of ['category', 'subcategory', 'itemNames']) {
		const input = viewMenu.querySelector<HTMLInputElement>(`input[value="${value}"]`);
		if (input) input.checked = checked;
	}
	syncViewOptions();
}

function resetBrowser(): void {
	gameScanGeneration += 1;
	disconnectIcons();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	useDirectoryInputFallback = false;
	artFiles.clear();
	snapshotFiles = [];
	clearIconCache();
	gameFolderInput.value = '';
	gameFolderControl.title = 'Open game folder';
	gameFolderInput.setAttribute('aria-label', 'Open game folder');
	accountSelect.replaceChildren(new Option('Choose account', ''));
	accountSelect.disabled = true;
	sourceStatus.textContent = 'No file loaded';
	frameState.textContent = 'OFFLINE';
	clearSnapshotData('Open a game folder');
}

async function selectNativeGameFolder(): Promise<void> {
	const host = window.snapshotHost;
	if (!host) return;
	showSourceProgress('Choose a game folder...');
	try {
		const result = await host.selectGameFolder();
		if (result.canceled) {
			hideSourceProgress();
			return;
		}
		gameScanGeneration += 1;
		disconnectIcons();
		artFiles.clear();
		clearIconCache();
		gameFolderInput.value = '';
		nativeGameSelection = true;
		nativeHasIcons = result.hasIcons === true;
		browserIconDirectory = null;
		snapshotFiles = (result.accounts || []).map((accountName) => ({ accountName }));
		clearSnapshotData('Select an account from this game folder');
		accountSelect.replaceChildren(new Option('Choose account', ''));
		for (const [index, snapshotFile] of snapshotFiles.entries()) {
			accountSelect.add(new Option(snapshotFile.accountName, String(index)));
		}
		accountSelect.disabled = snapshotFiles.length === 0;
		renderAccountPicker();
		hideSourceProgress();
		sourceStatus.textContent = snapshotFiles.length
			? `${snapshotFiles.length} account snapshot${snapshotFiles.length === 1 ? '' : 's'} found`
			: 'No account snapshots found';
		frameState.textContent = nativeHasIcons ? 'ICONS READY' : 'NO ICONS';
	} catch (error) {
		hideSourceProgress();
		setError(error instanceof Error ? error.message : 'Unable to open the game folder.');
	}
}

async function selectBrowserGameFolder(picker: NonNullable<WindowWithDirectoryPicker['showDirectoryPicker']>): Promise<void> {
	let root: FileSystemDirectoryHandle;
	const previousStatus = sourceStatus.textContent;
	const previousFrameState = frameState.textContent;
	hideSourceProgress();
	sourceStatus.textContent = 'Waiting for folder selection...';
	frameState.textContent = 'SELECT FOLDER';
	try {
		root = await picker({ mode: 'read' });
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			sourceStatus.textContent = previousStatus;
			frameState.textContent = previousFrameState;
			return;
		}
		prepareDirectoryInputFallback();
		return;
	}

	useDirectoryInputFallback = false;
	gameScanGeneration += 1;
	disconnectIcons();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	artFiles.clear();
	snapshotFiles = [];
	clearIconCache();
	gameFolderInput.value = '';
	accountSelect.replaceChildren(new Option('Choose account', ''));
	accountSelect.disabled = true;
	clearSnapshotData('Select an account from this game folder');
	frameState.textContent = 'SCANNING';
	showSourceProgress('Checking WTF/Account and icon paths');

	const accountsDirectory = await getDirectoryPath(root, ['WTF', 'Account']);
	try {
		if (accountsDirectory) {
			for await (const [accountName, entry] of (accountsDirectory as AsyncDirectoryHandle).entries()) {
				if (entry.kind !== 'directory') continue;
				try {
					const savedVariablesDirectory = await (entry as FileSystemDirectoryHandle).getDirectoryHandle('SavedVariables');
					const snapshot = await savedVariablesDirectory.getFileHandle('WhatsInTheBag.lua');
					snapshotFiles.push({ accountName, handle: snapshot });
				} catch {
					continue;
				}
			}
		}
	} catch {
		hideSourceProgress();
		sourceStatus.textContent = 'Could not inspect WTF/Account';
		frameState.textContent = 'SCAN ERROR';
		return;
	}
	snapshotFiles.sort((left, right) => left.accountName.localeCompare(right.accountName, undefined, { sensitivity: 'base' }));
	for (const [index, snapshotFile] of snapshotFiles.entries()) {
		accountSelect.add(new Option(snapshotFile.accountName, String(index)));
	}
	accountSelect.disabled = snapshotFiles.length === 0;
	renderAccountPicker();
	browserIconDirectory = await getDirectoryPath(root, ['BlizzardInterfaceArt', 'Interface', 'ICONS']);
	frameState.textContent = browserIconDirectory ? 'ICONS READY' : 'NO ICONS';
	hideSourceProgress();
	sourceStatus.textContent = snapshotFiles.length
		? `${snapshotFiles.length} account${snapshotFiles.length === 1 ? '' : 's'} found${browserIconDirectory ? ' · icons load on demand' : ' · no exported icons'}`
		: 'No account snapshots found under WTF/Account';
}

gameFolderControl.addEventListener('click', (event) => {
	if (useDirectoryInputFallback) return;
	if (window.snapshotHost) {
		event.preventDefault();
		void selectNativeGameFolder();
		return;
	}
	if (/\bElectron\//i.test(navigator.userAgent)) {
		prepareDirectoryInputFallback();
		return;
	}
	const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
	if (picker) {
		event.preventDefault();
		void selectBrowserGameFolder(picker.bind(window));
	} else {
		prepareDirectoryInputFallback();
	}
});

gameFolderInput.addEventListener('change', async () => {
	useDirectoryInputFallback = false;
	const scanGeneration = ++gameScanGeneration;
	disconnectIcons();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	artFiles.clear();
	snapshotFiles = [];
	clearIconCache();
	accountSelect.replaceChildren(new Option('Choose account', ''));
	accountSelect.disabled = true;
	clearSnapshotData('Select an account from this game folder');
	const files = gameFolderInput.files;
	if (!files?.length) {
		hideSourceProgress();
		sourceStatus.textContent = 'No account files found';
		frameState.textContent = 'NO FILES';
		return;
	}
	frameState.textContent = 'SCANNING';
	const chunkSize = 800;
	showSourceProgress(`Scanning 0% · 0 of ${files.length.toLocaleString()} files`, 0);
	for (let start = 0; start < files.length; start += chunkSize) {
		if (scanGeneration !== gameScanGeneration) return;
		const end = Math.min(start + chunkSize, files.length);
		for (let index = start; index < end; index += 1) {
			const file = files[index];
			const path = relativeFilePath(file);
			const accountName = getSnapshotAccountName(path);
			if (accountName) snapshotFiles.push({ accountName, file });
		}
		if (end < files.length) {
			const progress = Math.round(end / files.length * 100);
			showSourceProgress(`Scanning ${progress}% · ${end.toLocaleString()} of ${files.length.toLocaleString()} files`, progress);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
	}
	if (scanGeneration !== gameScanGeneration) return;
	snapshotFiles.sort((left, right) => left.accountName.localeCompare(right.accountName, undefined, { sensitivity: 'base' }));
	for (const [index, snapshotFile] of snapshotFiles.entries()) {
		accountSelect.add(new Option(snapshotFile.accountName, String(index)));
	}
	accountSelect.disabled = snapshotFiles.length === 0;
	renderAccountPicker();
	hideSourceProgress();
	sourceStatus.textContent = snapshotFiles.length
		? `${snapshotFiles.length} account${snapshotFiles.length === 1 ? '' : 's'} found · icons skipped`
		: 'No account snapshots found under WTF/Account';
	frameState.textContent = artFiles.size || browserIconDirectory ? 'ICONS READY' : 'NO ICONS';
});

accountSelect.addEventListener('change', async () => {
	closeStorageWindows();
	renderAccountPicker();
	if (!accountSelect.value) {
		clearSnapshotData('Select an account from this game folder');
		sourceStatus.textContent = snapshotFiles.length ? `${snapshotFiles.length} account snapshots found` : 'No account snapshots found';
		frameState.textContent = artFiles.size || browserIconDirectory ? 'ICONS READY' : 'NO ICONS';
		return;
	}
	const snapshotFile = snapshotFiles[Number(accountSelect.value)];
	if (!snapshotFile) return;
	resetSnapshotFilters();
	selection = { characterKey: null, storage: 'warband' };
	frameState.textContent = 'LOADING';
	showSourceProgress('Loading account snapshots...');
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	try {
		const savedVariables = snapshotFile.file
			? await snapshotFile.file.text()
			: snapshotFile.handle
				? await (await snapshotFile.handle.getFile()).text()
				: await window.snapshotHost?.readAccount(snapshotFile.accountName);
		if (savedVariables === undefined) throw new Error('The selected account snapshot could not be read.');
		const loadedAccount = parseSavedVariables(savedVariables);
		hideSourceProgress();
		sourceStatus.textContent = 'Snapshots loaded';
		frameState.textContent = artFiles.size || nativeHasIcons || browserIconDirectory ? 'FILE READY' : 'NO ICONS';
		setLoadedAccount(loadedAccount, requestedSelection, snapshotFile.accountName);
	} catch (error) {
		setError(error instanceof Error ? error.message : 'Unknown parse error.');
	}
});

searchInput.addEventListener('input', renderInventory);
accountToggle.addEventListener('click', () => {
	const open = accountList.hidden;
	closeMenus();
	accountList.hidden = !open;
	accountToggle.setAttribute('aria-expanded', String(open));
});
characterToggle.addEventListener('click', () => {
	const open = characterList.hidden;
	closeMenus();
	characterList.hidden = !open;
	characterToggle.setAttribute('aria-expanded', String(open));
});
filterToggle.addEventListener('click', () => {
	const open = filterMenu.hidden;
	closeMenus();
	filterMenu.hidden = !open;
	filterToggle.setAttribute('aria-expanded', String(open));
});
viewToggle.addEventListener('click', () => {
	const open = viewMenu.hidden;
	closeMenus();
	viewMenu.hidden = !open;
	viewToggle.setAttribute('aria-expanded', String(open));
});
settingsToggle.addEventListener('click', () => {
	const open = settingsMenu.hidden;
	closeMenus();
	settingsMenu.hidden = !open;
	settingsToggle.setAttribute('aria-expanded', String(open));
});
tooltipCategoryToggle.addEventListener('change', () => {
	showTooltipCategoryDetails = tooltipCategoryToggle.checked;
	try {
		window.localStorage.setItem('witbCompanion.showTooltipCategoryDetails', String(showTooltipCategoryDetails));
	} catch {
		return;
	}
});
filterMenu.addEventListener('change', handleQuickFilterChange);
filterClear.addEventListener('click', () => {
	for (const input of filterMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
	hiddenCategories = new Set();
	activeCategory = null;
	renderInventory();
});
viewMenu.addEventListener('change', syncViewOptions);
viewCheckAll.addEventListener('click', () => setAllViewOptions(true));
viewUncheckAll.addEventListener('click', () => setAllViewOptions(false));
toggleAllCategories.addEventListener('click', setAllCategoriesVisible);
document.addEventListener('pointerdown', (event) => {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (!accountToggle.contains(target) && !accountList.contains(target)) closeAccountMenu();
	if (!characterToggle.contains(target) && !characterList.contains(target)) closeCharacterMenu();
	if (!filterToggle.contains(target) && !filterMenu.contains(target)) {
		filterMenu.hidden = true;
		filterToggle.setAttribute('aria-expanded', 'false');
	}
	if (!viewToggle.contains(target) && !viewMenu.contains(target)) {
		viewMenu.hidden = true;
		viewToggle.setAttribute('aria-expanded', 'false');
	}
	if (!settingsToggle.contains(target) && !settingsMenu.contains(target)) {
		settingsMenu.hidden = true;
		settingsToggle.setAttribute('aria-expanded', 'false');
	}
});
document.querySelector('.close-button')?.addEventListener('click', resetBrowser);

async function initializeRequestedWindow(): Promise<void> {
	if (!requestedSelection) return;
	if (window.snapshotHost && requestedAccountName) {
		try {
			frameState.textContent = 'LOADING';
			const savedVariables = await window.snapshotHost.readAccount(requestedAccountName);
			nativeGameSelection = true;
			nativeHasIcons = windowParameters.get('icons') === 'true';
			setLoadedAccount(parseSavedVariables(savedVariables), requestedSelection, requestedAccountName);
			sourceStatus.textContent = 'Snapshots loaded';
			frameState.textContent = nativeHasIcons ? 'ICONS READY' : 'NO ICONS';
		} catch (error) {
			setError(error instanceof Error ? error.message : 'Could not load the selected storage window.');
		}
		return;
	}
	if (!popupChannelToken) return;
	const channel = new BroadcastChannel(popupChannelToken);
	channel.addEventListener('message', (event: MessageEvent) => {
		if (event.data?.type !== 'snapshot' || !isLuaTable(event.data.account)) return;
		if (Array.isArray(event.data.artFiles)) artFiles = new Map(event.data.artFiles as [string, IconFileSource][]);
		if (event.data.browserIconDirectory) browserIconDirectory = event.data.browserIconDirectory as FileSystemDirectoryHandle;
		setLoadedAccount(event.data.account, requestedSelection, null);
		sourceStatus.textContent = 'Snapshots loaded';
		frameState.textContent = artFiles.size || browserIconDirectory ? 'ICONS READY' : 'NO ICONS';
	});
	window.addEventListener('pagehide', () => {
		channel.postMessage({ type: 'window-closed' });
		channel.close();
	}, { once: true });
	channel.postMessage({ type: 'request-snapshot' });
}

void initializeRequestedWindow();