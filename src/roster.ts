import { isLuaTable, snapshotCharacterMatchesNameSearch, snapshotMatchesNameSearch, stringValue, valueTable, type LuaTable } from './saved-variables.ts';

export type StorageKey = 'bags' | 'characterBank' | 'warband';

export interface Selection {
	characterKey: string | null;
	storage: StorageKey;
}

interface RosterDependencies {
	characterList: HTMLElement;
	characterToggle: HTMLButtonElement;
	characterSelectionLabel: HTMLElement;
	getAccount: () => LuaTable | null;
	getSelection: () => Selection;
	makeEmptyRail: (message: string) => HTMLElement;
	onStorageSelected: (characterKey: string | null, storage: StorageKey) => void;
}

export function createRosterController({
	characterList, characterToggle, characterSelectionLabel, getAccount, getSelection, makeEmptyRail, onStorageSelected,
}: RosterDependencies) {
	const rosterSearchInput = document.createElement('input');
	rosterSearchInput.type = 'search';
	rosterSearchInput.placeholder = 'Search item names';
	rosterSearchInput.autocomplete = 'off';
	rosterSearchInput.setAttribute('aria-label', 'Search item names in alt Bags and Banks');
	rosterSearchInput.addEventListener('input', updateRosterSearch);

	function updateCharacterSelectionLabel(): void {
		const account = getAccount();
		const selection = getSelection();
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
		const selection = getSelection();
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
			onStorageSelected(characterKey, storage);
		});
		return button;
	}

	function updateRosterSearch(): void {
		const account = getAccount();
		const characters = valueTable(account?.characterSnapshots);
		const query = rosterSearchInput.value;
		const searching = query.trim().length > 0;
		let matchingCharacters = 0;
		for (const button of characterList.querySelectorAll<HTMLButtonElement>('.storage-button')) {
			const character = valueTable(characters?.[button.dataset.characterKey || '']);
			const matches = snapshotMatchesNameSearch(character?.[button.dataset.storage || ''], query);
			button.classList.toggle('is-search-match', searching && matches);
			button.classList.toggle('is-search-miss', searching && !matches);
			button.title = searching
				? `${button.textContent}: ${matches ? 'Contains a matching saved item' : 'No matching saved item'}`
				: '';
		}
		for (const entry of characterList.querySelectorAll<HTMLElement>('.character-entry')) {
			const character = valueTable(characters?.[entry.dataset.characterKey || '']);
			const matches = snapshotCharacterMatchesNameSearch(character, query);
			entry.hidden = searching && !matches;
			if (!entry.hidden) matchingCharacters += 1;
		}
		const noMatches = characterList.querySelector<HTMLElement>('.roster-no-matches');
		if (noMatches) noMatches.hidden = !searching || matchingCharacters > 0;
	}

	function renderRoster(): void {
		const account = getAccount();
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
		const searchHint = document.createElement('small');
		searchHint.className = 'roster-search-hint';
		searchHint.textContent = 'All terms must match one item name in Bags or Bank.';
		characterList.append(searchHint);
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
			entry.dataset.characterKey = key;
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
		const noMatches = document.createElement('p');
		noMatches.className = 'rail-empty roster-no-matches';
		noMatches.textContent = 'No characters have matching items in Bags or Bank.';
		noMatches.hidden = true;
		characterList.append(noMatches);

		updateRosterSearch();
		updateCharacterSelectionLabel();
	}

	return { renderRoster, clearSearch: () => { rosterSearchInput.value = ''; } };
}
