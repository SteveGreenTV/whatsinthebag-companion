import initBlp, { blpToPng } from 'wow-blp-web';
import blpWasmUrl from 'wow-blp-web/wow_blp_web_bg.wasm?url';
import iconManifest from './icon-paths.json';
import { isLuaTable, parseSavedVariables, snapshotMatchesNameSearch, tableValues, type LuaTable, type LuaValue } from './saved-variables';

type StorageKey = 'bags' | 'characterBank' | 'warband';

interface Selection {
	characterKey: string | null;
	storage: StorageKey;
}

interface SearchTerm {
	field: 'text' | 'name' | 'category' | 'subtype' | 'slot' | 'armor' | 'status';
	value: string;
}

interface FileWithPath extends File {
	webkitRelativePath: string;
}

interface SnapshotFile {
	accountName: string;
	file?: File;
	handle?: FileSystemFileHandle;
}

type IconFileSource = File | FileSystemFileHandle;
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

interface IconManifest {
	source: string;
	version: string;
	paths: Record<string, string>;
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

const gameFolderInput = document.querySelector<HTMLInputElement>('#game-folder')!;
const gameFolderControl = document.querySelector<HTMLLabelElement>('#game-folder-control')!;
const accountSelect = document.querySelector<HTMLSelectElement>('#account-select')!;
const accountToggle = document.querySelector<HTMLButtonElement>('#account-toggle')!;
const accountList = document.querySelector<HTMLElement>('#account-list')!;
const sourceStatus = document.querySelector<HTMLElement>('#source-status')!;
const sourceProgress = document.querySelector<HTMLProgressElement>('#source-progress')!;
const frameState = document.querySelector<HTMLElement>('#window-state')!;
const characterList = document.querySelector<HTMLElement>('#character-list')!;
const rosterSearchInput = document.createElement('input');
rosterSearchInput.type = 'search';
rosterSearchInput.placeholder = 'Search items';
rosterSearchInput.autocomplete = 'off';
rosterSearchInput.setAttribute('aria-label', 'Search items across alt bags and banks');
rosterSearchInput.addEventListener('input', updateRosterSearch);
const characterToggle = document.querySelector<HTMLButtonElement>('#character-toggle')!;
const characterSelectionLabel = document.querySelector<HTMLElement>('#character-selection-label')!;
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
const iconPaths = (iconManifest as IconManifest).paths;
const itemTooltip = document.createElement('aside');
itemTooltip.className = 'snapshot-item-tooltip';
itemTooltip.setAttribute('role', 'tooltip');
itemTooltip.hidden = true;
document.body.append(itemTooltip);

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
let viewOptions = { category: true, subcategory: true, itemNames: true };
let wasmReady: Promise<unknown> | undefined;
const decodedIcons = new Map<string, string>();
const decodedBlps = new Map<string, Promise<Uint8Array>>();
const pendingIconLoads = new WeakMap<HTMLImageElement, { iconPath: string; file?: IconFileSource; frame: HTMLElement }>();
let iconObserver: IntersectionObserver | null = null;

function valueTable(value: LuaValue | undefined): LuaTable | null {
	return isLuaTable(value) ? value : null;
}

function stringValue(value: LuaValue | undefined, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function numberValue(value: LuaValue | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePath(path: string): string {
	const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
	const interfaceIndex = normalized.indexOf('interface/');
	const relative = interfaceIndex >= 0 ? normalized.slice(interfaceIndex)
		: /^icons\//.test(normalized) ? `interface/${normalized}` : normalized;
	if (relative.split('/').some((part) => part === '..')) return '';
	return relative;
}

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
	rosterSearchInput.value = '';
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
	filterToggle.setAttribute('aria-expanded', 'false');
	viewToggle.setAttribute('aria-expanded', 'false');
}

function resetSnapshotFilters(): void {
	for (const input of filterMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
	for (const input of viewMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = true;
	viewOptions = { category: true, subcategory: true, itemNames: true };
	hiddenCategories = new Set();
	activeCategory = null;
	searchInput.value = '';
}

function updateCharacterSelectionLabel(): void {
	characterToggle.disabled = !account;
	if (!account) {
		characterSelectionLabel.textContent = 'Choose character';
	} else if (selection.storage === 'warband') {
		characterSelectionLabel.textContent = 'Warband · Shared bank';
	} else {
		const character = valueTable(valueTable(account.characterSnapshots)?.[selection.characterKey || '']);
		const name = stringValue(character?.name, selection.characterKey || 'Character');
		characterSelectionLabel.textContent = `${name} · ${selection.storage === 'bags' ? 'Bags' : 'Bank'}`;
	}
	const currentSelection = characterSelectionLabel.textContent;
	characterToggle.title = currentSelection ? `Alts · ${currentSelection}` : 'Choose character and storage';
	characterToggle.setAttribute('aria-label', `Choose character and storage. Current selection: ${currentSelection || 'none'}`);
}

function makeStorageButton(text: string, characterKey: string | null, storage: StorageKey, disabled = false): HTMLButtonElement {
	const button = document.createElement('button');
	button.className = 'storage-button';
	button.type = 'button';
	button.textContent = text;
	button.disabled = disabled;
	if (characterKey !== null) {
		button.dataset.characterKey = characterKey;
		button.dataset.storage = storage;
	}
	button.setAttribute('aria-pressed', String(selection.characterKey === characterKey && selection.storage === storage));
	button.addEventListener('click', () => {
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
	});
	return button;
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

function updateRosterSearch(): void {
	const characters = valueTable(account?.characterSnapshots);
	const query = rosterSearchInput.value;
	const searching = query.trim().length > 0;
	for (const button of characterList.querySelectorAll<HTMLButtonElement>('.storage-button')) {
		const character = valueTable(characters?.[button.dataset.characterKey || '']);
		const matches = snapshotMatchesNameSearch(character?.[button.dataset.storage || ''], query);
		button.classList.toggle('is-search-match', searching && matches);
		button.classList.toggle('is-search-miss', searching && !matches);
		button.title = searching
			? `${button.textContent}: ${matches ? 'Contains a matching saved item' : 'No matching saved item'}`
			: '';
	}
}

function renderRoster(): void {
	if (!account) return;
	characterList.replaceChildren();
	characterList.classList.add('roster-list');
	const heading = document.createElement('h2');
	heading.className = 'roster-heading';
	heading.id = 'alts-heading';
	heading.textContent = 'Alts';
	characterList.setAttribute('aria-labelledby', heading.id);
	characterList.append(heading);
	const searchBox = document.createElement('label');
	searchBox.className = 'search-box roster-search';
	const searchIcon = document.createElement('span');
	searchIcon.textContent = '\u2315';
	searchIcon.setAttribute('aria-hidden', 'true');
	searchBox.append(searchIcon, rosterSearchInput);
	characterList.append(searchBox);
	const characters = valueTable(account.characterSnapshots);
	const entries = Object.entries(characters || {})
		.filter(([, record]) => isLuaTable(record) && (isLuaTable(record.bags) || isLuaTable(record.characterBank)))
		.sort(([, left], [, right]) => {
			const leftRecord = valueTable(left);
			const rightRecord = valueTable(right);
			const nameOrder = stringValue(leftRecord?.name).localeCompare(stringValue(rightRecord?.name), undefined, { sensitivity: 'base' });
			return nameOrder || stringValue(leftRecord?.realm).localeCompare(stringValue(rightRecord?.realm), undefined, { sensitivity: 'base' });
		});

	if (!entries.length) characterList.append(makeEmptyRail('No character snapshots found'));
	for (const [key, recordValue] of entries) {
		const record = valueTable(recordValue)!;
		const entry = document.createElement('section');
		entry.className = 'character-entry';
		const heading = document.createElement('div');
		heading.className = 'character-name';
		const name = document.createElement('span');
		name.textContent = stringValue(record.name, key);
		const realm = document.createElement('small');
		realm.textContent = stringValue(record.realm);
		heading.append(name, realm);
		const actions = document.createElement('div');
		actions.className = 'storage-actions';
		actions.append(
			makeStorageButton('Bags', key, 'bags', !isLuaTable(record.bags)),
			makeStorageButton('Bank', key, 'characterBank', !isLuaTable(record.characterBank)),
		);
		entry.append(heading, actions);
		characterList.append(entry);
	}

	updateRosterSearch();
	updateCharacterSelectionLabel();
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
	rosterSearchInput.value = '';
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

const slotAliases: Record<string, string> = {
	head: 'INVTYPE_HEAD', neck: 'INVTYPE_NECK', shoulder: 'INVTYPE_SHOULDER', shoulders: 'INVTYPE_SHOULDER',
	chest: 'INVTYPE_CHEST', waist: 'INVTYPE_WAIST', belt: 'INVTYPE_WAIST', legs: 'INVTYPE_LEGS',
	feet: 'INVTYPE_FEET', boots: 'INVTYPE_FEET', wrist: 'INVTYPE_WRIST', hands: 'INVTYPE_HAND',
	finger: 'INVTYPE_FINGER', ring: 'INVTYPE_FINGER', trinket: 'INVTYPE_TRINKET', back: 'INVTYPE_CLOAK',
	cloak: 'INVTYPE_CLOAK', onehand: 'INVTYPE_WEAPON', twohand: 'INVTYPE_2HWEAPON',
	mainhand: 'INVTYPE_WEAPONMAINHAND', offhand: 'INVTYPE_WEAPONOFFHAND', shield: 'INVTYPE_SHIELD',
	held: 'INVTYPE_HOLDABLE', ranged: 'INVTYPE_RANGED', shirt: 'INVTYPE_BODY', tabard: 'INVTYPE_TABARD',
};

const armorAliases: Record<string, number> = { cloth: 1, leather: 2, mail: 3, plate: 4 };
const subtypeAliases: Record<string, { classID: number; subClassIDs: number[] }> = {
	sword: { classID: 2, subClassIDs: [7, 8] }, swords: { classID: 2, subClassIDs: [7, 8] },
	axe: { classID: 2, subClassIDs: [0, 1] }, axes: { classID: 2, subClassIDs: [0, 1] },
	mace: { classID: 2, subClassIDs: [4, 5] }, maces: { classID: 2, subClassIDs: [4, 5] },
	dagger: { classID: 2, subClassIDs: [15] }, daggers: { classID: 2, subClassIDs: [15] },
	staff: { classID: 2, subClassIDs: [10] }, staves: { classID: 2, subClassIDs: [10] },
	polearm: { classID: 2, subClassIDs: [6] }, polearms: { classID: 2, subClassIDs: [6] },
	shield: { classID: 4, subClassIDs: [6] }, shields: { classID: 4, subClassIDs: [6] },
};
const statusTerms = new Set(['soulbound', 'warbound', 'upgradeable', 'openable', 'usable']);
const statusAliases: Record<string, string> = {
	open: 'openable', loot: 'openable', war: 'warbound', band: 'warbound', up: 'upgradeable', upgrade: 'upgradeable',
};

function parseSearch(query: string, filters: Set<string>): SearchTerm[] {
	const terms: SearchTerm[] = [];
	for (const rawTerm of `${query} ${[...filters].join(' ')}`.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)) {
		const separator = rawTerm.indexOf(':');
		let field = separator >= 0 ? rawTerm.slice(0, separator) : '';
		let value = separator >= 0 ? rawTerm.slice(separator + 1) : rawTerm;
		if (field === 'type') field = 'subtype';
		if (field === 'cat') field = 'category';
		if (!['name', 'category', 'subtype', 'slot', 'armor'].includes(field)) {
			value = statusAliases[rawTerm] || rawTerm;
			field = statusTerms.has(value) ? 'status'
				: slotAliases[value] ? 'slot'
					: armorAliases[value] ? 'armor'
						: subtypeAliases[value] ? 'subtype' : 'text';
		}
		if (value) terms.push({ field: field as SearchTerm['field'], value });
	}
	return terms;
}

function includes(value: LuaValue | undefined, term: string): boolean {
	return String(value ?? '').toLocaleLowerCase().includes(term);
}

function itemMatchesSearch(item: LuaTable, terms: SearchTerm[]): boolean {
	for (const { field, value } of terms) {
		if (field === 'name') {
			if (item.name !== undefined && !includes(item.name, value)) return false;
		} else if (field === 'category') {
			const classID = numberValue(item.classID);
			const categoryClass = value === 'armor' ? 4 : value === 'weapon' ? 2 : null;
			if (categoryClass !== null && classID !== null) {
				if (classID !== categoryClass) return false;
			} else if (item.category !== undefined && !includes(item.category, value)) return false;
		} else if (field === 'subtype') {
			const alias = subtypeAliases[value];
			if (alias) {
				const classID = numberValue(item.classID);
				const subClassID = numberValue(item.subClassID);
				if (classID !== null && classID !== alias.classID) return false;
				if (subClassID !== null && !alias.subClassIDs.includes(subClassID)) return false;
				continue;
			}
			if (item.itemSubtype !== undefined && !includes(item.itemSubtype, value)) return false;
		} else if (field === 'slot') {
			const equipLoc = stringValue(item.equipLoc).toLocaleUpperCase();
			if (equipLoc) {
				const expected = slotAliases[value] || (value.startsWith('invtype_') ? value.toLocaleUpperCase() : '');
				const chestRobe = value === 'chest' && equipLoc === 'INVTYPE_ROBE';
				if (expected ? equipLoc !== expected && !chestRobe : !equipLoc.toLocaleLowerCase().includes(value)) return false;
			}
		} else if (field === 'armor') {
			const classID = numberValue(item.classID);
			const subClassID = numberValue(item.subClassID);
			if (classID !== null && classID !== 4) return false;
			if (subClassID !== null && armorAliases[value] !== undefined && subClassID !== armorAliases[value]) return false;
			if (subClassID !== null && armorAliases[value] === undefined && item.itemSubtype !== undefined && !includes(item.itemSubtype, value)) return false;
		} else if (field === 'status') {
			if (item.statusUnavailable === true && ['soulbound', 'warbound', 'upgradeable'].includes(value)) return false;
			if (item[value] === false) return false;
		} else {
			const searchable = [item.name, item.category, item.itemSubtype, item.itemLevel, item.equipLoc]
				.map((part) => String(part ?? '').toLocaleLowerCase()).join(' ');
			if (!searchable.includes(value)) return false;
		}
	}
	return true;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item) || 'Other';
		const values = groups.get(key) || [];
		values.push(item);
		groups.set(key, values);
	}
	return groups;
}

function hideItemTooltip(): void {
	itemTooltip.hidden = true;
	itemTooltip.replaceChildren();
}

function showItemTooltip(card: HTMLElement, item: LuaTable): void {
	itemTooltip.replaceChildren();
	const quality = numberValue(item.quality);
	const qualityColor = qualityColors[quality ?? 1] || qualityColors[1];
	const name = document.createElement('strong');
	name.className = 'snapshot-item-tooltip-name';
	name.textContent = stringValue(item.name, 'Unknown item');
	name.style.color = qualityColor;
	itemTooltip.append(name);

	const classification = [stringValue(item.category), stringValue(item.itemSubtype)].filter(Boolean).join(' · ');
	if (classification) {
		const line = document.createElement('div');
		line.className = 'snapshot-item-tooltip-classification';
		line.textContent = classification;
		itemTooltip.append(line);
	}

	const details: string[] = [];
	const itemLevel = numberValue(item.itemLevel);
	const count = numberValue(item.count);
	if (itemLevel !== null && itemLevel > 0) details.push(`Item level ${itemLevel}`);
	if (count !== null && count > 1) details.push(`Stack ${count}`);
	const upgrade = valueTable(item.upgradeInfo);
	if (upgrade) {
		const track = [...stringValue(upgrade.trackString).trim()][0]?.toLocaleUpperCase();
		const current = numberValue(upgrade.currentLevel);
		const maximum = numberValue(upgrade.maxLevel);
		if (track && current !== null && current > 0 && maximum !== null && maximum > 0) {
			details.push(`Upgrade ${track}${current}/${maximum}`);
		}
	}
	for (const [field, label] of [
		['soulbound', 'Soulbound'], ['warbound', 'Warbound'], ['upgradeable', 'Upgradeable'],
		['openable', 'Openable'], ['usable', 'Usable'],
	] as const) {
		if (item[field] === true) details.push(label);
	}
	for (const detail of details) {
		const line = document.createElement('div');
		line.className = 'snapshot-item-tooltip-detail';
		line.textContent = detail;
		itemTooltip.append(line);
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

function addBadge(parent: HTMLElement, text: string): void {
	const badge = document.createElement('span');
	badge.className = 'item-badge';
	badge.textContent = text;
	parent.append(badge);
}

async function getBrowserIconHandle(iconPath: string): Promise<FileSystemFileHandle | undefined> {
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
		if (file) {
			blpBytes = new Uint8Array(await (file instanceof File ? file : await file.getFile()).arrayBuffer());
		} else if (browserIconDirectory) {
			const iconHandle = await getBrowserIconHandle(iconPath);
			if (!iconHandle) throw new Error(`Icon not found: ${iconPath}`);
			blpBytes = new Uint8Array(await (await iconHandle.getFile()).arrayBuffer());
		} else {
			blpBytes = new Uint8Array(await window.snapshotHost!.readIcon(iconPath));
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

function renderCategoryList(groups: Map<string, LuaTable[]>): void {
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
		.sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))) {
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

function appendItemGrid(parent: HTMLElement, items: LuaTable[]): void {
	const grid = document.createElement('div');
	grid.className = 'item-grid';
	items.sort((left, right) => {
		const nameOrder = stringValue(left.name).localeCompare(stringValue(right.name), undefined, { sensitivity: 'base' });
		if (nameOrder) return nameOrder;
		const bagOrder = (numberValue(left.bagID) ?? 0) - (numberValue(right.bagID) ?? 0);
		return bagOrder || (numberValue(left.slotIndex) ?? 0) - (numberValue(right.slotIndex) ?? 0);
	});
	for (const item of items) grid.append(createItemCard(item));
	parent.append(grid);
}

function appendSubcategoryGroups(parent: HTMLElement, items: LuaTable[]): void {
	for (const [subtype, subtypeItems] of [...groupBy(items, (item) => stringValue(item.itemSubtype)).entries()]
		.sort(([left], [right]) => {
			if (!left || !right) return left ? -1 : right ? 1 : 0;
			return left.localeCompare(right, undefined, { sensitivity: 'base' });
		})) {
		const heading = document.createElement('h4');
		heading.className = 'subtype-heading';
		heading.textContent = subtype || 'Other';
		parent.append(heading);
		appendItemGrid(parent, subtypeItems);
	}
}

function renderInventory(): void {
	hideItemTooltip();
	if (!account) return;
	iconObserver?.disconnect();
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
	const terms = parseSearch(searchInput.value, filters);
	const bags = tableValues(snapshot.bags).map(valueTable).filter((bag): bag is LuaTable => bag !== null);
	const records = bags.flatMap((bag) => tableValues(bag.items)
		.map(valueTable)
		.filter((item): item is LuaTable => item !== null))
		.filter((item) => itemMatchesSearch(item, terms));
	const groups = groupBy(records, (item) => stringValue(item.category, 'Other'));
	renderCategoryList(groups);
	appFrame.classList.toggle('hide-item-names', !viewOptions.itemNames);
	const visibleGroups = [...groups.entries()]
		.filter(([category]) => !hiddenCategories.has(category))
		.sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
	const visibleItems = visibleGroups.flatMap(([, items]) => items);
	if (!visibleItems.length) {
		showMessage('No items match this search and filter combination.');
		footerMessage.textContent = hiddenCategories.size && records.length
			? `${records.length} MATCHING SLOTS · CATEGORIES HIDDEN`
			: '0 MATCHING SLOTS · READ ONLY';
		return;
	}

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
			if (viewOptions.subcategory) appendSubcategoryGroups(section, items);
			else appendItemGrid(section, items);
			fragment.append(section);
		}
	} else {
		const section = document.createElement('section');
		section.className = 'category-section';
		if (viewOptions.subcategory) appendSubcategoryGroups(section, visibleItems);
		else appendItemGrid(section, visibleItems);
		fragment.append(section);
	}
	inventoryContent.replaceChildren(fragment);
	footerMessage.textContent = `${visibleItems.length} MATCHING SLOTS · READ ONLY`;
}

function getSnapshotCategories(): Set<string> {
	const snapshot = currentSnapshot();
	if (!snapshot) return new Set();
	const categories = new Set<string>();
	for (const bagValue of tableValues(snapshot.bags)) {
		const bag = valueTable(bagValue);
		if (!bag) continue;
		for (const itemValue of tableValues(bag.items)) {
			const item = valueTable(itemValue);
			if (item) categories.add(stringValue(item.category, 'Other'));
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
	};
	renderInventory();
}

function resetBrowser(): void {
	gameScanGeneration += 1;
	iconObserver?.disconnect();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	useDirectoryInputFallback = false;
	artFiles.clear();
	snapshotFiles = [];
	decodedIcons.clear();
	decodedBlps.clear();
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
		iconObserver?.disconnect();
		artFiles.clear();
		decodedIcons.clear();
		decodedBlps.clear();
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
	iconObserver?.disconnect();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	artFiles.clear();
	snapshotFiles = [];
	decodedIcons.clear();
	decodedBlps.clear();
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
	iconObserver?.disconnect();
	nativeGameSelection = false;
	nativeHasIcons = false;
	browserIconDirectory = null;
	artFiles.clear();
	snapshotFiles = [];
	decodedIcons.clear();
	decodedBlps.clear();
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
filterMenu.addEventListener('change', handleQuickFilterChange);
filterClear.addEventListener('click', () => {
	for (const input of filterMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
	renderInventory();
});
viewMenu.addEventListener('change', syncViewOptions);
viewCheckAll.addEventListener('click', () => {
	for (const input of viewMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = true;
	syncViewOptions();
});
viewUncheckAll.addEventListener('click', () => {
	for (const input of viewMenu.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
	syncViewOptions();
});
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