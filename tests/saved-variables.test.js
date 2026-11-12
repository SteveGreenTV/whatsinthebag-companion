import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getSnapshotEquipmentSlots,
	getSnapshotItemCounts,
	groupSnapshotItemsBySubcategory,
	isLuaTable,
	isSnapshotEquipmentItem,
	parseSavedVariables,
	snapshotCharacterMatchesNameSearch,
	snapshotItemMatchesStatus,
	snapshotMatchesNameSearch,
	sortSnapshotItems,
	tableValues,
} from '../src/saved-variables.ts';

test('alt search matches literal case-insensitive terms in one saved item name', () => {
	const bags = { bags: { 1: { items: {
		1: { name: 'Greater Healing Potion', category: 'Consumable' },
		3: { name: 'Plate [Helm]' },
		4: { itemID: 123, category: 'Healing' },
	} } } };
	const bank = { bags: { 2: { items: { 1: { name: 'Greater Mana Potion' } } } } };
	assert.equal(snapshotMatchesNameSearch(bags, '  HEALING\t potion  '), true);
	assert.equal(snapshotMatchesNameSearch(bank, 'healing potion'), false);
	assert.equal(snapshotMatchesNameSearch(bank, 'mana potion'), true);
	assert.equal(snapshotMatchesNameSearch(bags, 'potion helm'), false);
	assert.equal(snapshotMatchesNameSearch(bags, '[helm]'), true);
	assert.equal(snapshotMatchesNameSearch(bags, 'name:plate'), false);
	assert.equal(snapshotMatchesNameSearch(bags, 'consumable'), false);
	assert.equal(snapshotMatchesNameSearch(bags, '123'), false);
	assert.equal(snapshotMatchesNameSearch(bags, '  '), false);
	assert.equal(snapshotMatchesNameSearch(undefined, 'potion'), false);
	assert.equal(snapshotMatchesNameSearch({ bags: {} }, 'potion'), false);
});

test('upgradeable status also matches fully upgraded snapshot items', () => {
	assert.equal(snapshotItemMatchesStatus({ upgradeable: true }, 'upgradeable'), true);
	assert.equal(snapshotItemMatchesStatus({
		upgradeable: false,
		upgradeInfo: { trackString: 'Champion', currentLevel: 6, maxLevel: 6 },
	}, 'upgradeable'), true);
	assert.equal(snapshotItemMatchesStatus({
		upgradeable: false,
		upgradeInfo: { trackString: 'Champion', currentLevel: 5, maxLevel: 6 },
	}, 'upgradeable'), false);
	assert.equal(snapshotItemMatchesStatus({ upgradeable: false }, 'upgradeable'), false);
	assert.equal(snapshotItemMatchesStatus({}, 'upgradeable'), true);
	assert.equal(snapshotItemMatchesStatus({
		upgradeable: true,
		upgradeInfo: { trackString: 'Champion', currentLevel: 0, maxLevel: 0 },
	}, 'upgradeable'), false);
});

test('equipment filters and item-level sorting follow addon precedence only when enabled', () => {
	const items = [
		{ name: 'Chest', equipLoc: 'INVTYPE_CHEST', itemLevel: 300 },
		{ name: 'Zulu Head', equipLoc: 'INVTYPE_HEAD', itemLevel: 100 },
		{ name: 'Unknown Head', equipLoc: 'INVTYPE_HEAD' },
		{ name: 'Alpha Head', equipLoc: 'INVTYPE_HEAD', itemLevel: 200 },
		{ name: 'Potion', equipLoc: '' },
	];
	assert.equal(isSnapshotEquipmentItem(items[0]), true);
	assert.equal(isSnapshotEquipmentItem(items[4]), false);
	assert.deepEqual(getSnapshotEquipmentSlots({ equipLoc: 'INVTYPE_WEAPON' }).map((slot) => slot.name), ['Main Hand', 'Off Hand']);
	assert.deepEqual(
		sortSnapshotItems(items, { equipment: false, sortByItemLevel: false }).map((item) => item.name),
		['Alpha Head', 'Chest', 'Potion', 'Unknown Head', 'Zulu Head'],
	);
	assert.deepEqual(
		sortSnapshotItems(items, { equipment: false, sortByItemLevel: true }).map((item) => item.name),
		['Chest', 'Alpha Head', 'Zulu Head', 'Potion', 'Unknown Head'],
	);
	assert.deepEqual(
		sortSnapshotItems(items, { equipment: true, sortByItemLevel: true }).map((item) => item.name),
		['Alpha Head', 'Zulu Head', 'Unknown Head', 'Chest', 'Potion'],
	);
});

test('subcategory grouping merges across categories and keeps unresolved metadata last', () => {
	const items = [
		{ category: 'Armor', itemSubtype: 'Cloth', name: 'Zulu' },
		{ category: 'Weapon', itemSubtype: 'Cloth', name: 'Alpha' },
		{ category: 'Armor', itemSubtype: 'Leather', name: 'Hide' },
		{ category: 'Other', name: 'Unresolved' },
	];
	const groups = groupSnapshotItemsBySubcategory(items);
	assert.deepEqual(groups.map(([subcategory]) => subcategory), ['Cloth', 'Leather', '']);
	assert.deepEqual(sortSnapshotItems(groups[0][1], { equipment: false, sortByItemLevel: false }).map((item) => item.name), ['Alpha', 'Zulu']);
});

test('Alt character search matches either storage without combining terms across items', () => {
	const character = {
		bags: { bags: { 1: { items: { 1: { name: 'Greater Healing Potion' } } } } },
		characterBank: { bags: { 2: { items: { 1: { name: 'Greater Mana Potion' } } } } },
	};
	assert.equal(snapshotCharacterMatchesNameSearch(character, 'mana potion'), true);
	assert.equal(snapshotCharacterMatchesNameSearch(character, 'healing mana'), false);
	assert.equal(snapshotCharacterMatchesNameSearch(character, '  '), false);
});

test('counts item stacks across each character and the Warband Bank', () => {
	const account = {
		characterSnapshots: {
			'Player-1': {
				name: 'Ada', realm: 'Area 52',
				bags: { bags: { 1: { items: { 1: { itemID: 42, count: 3 }, 2: { itemID: 42 } } } } },
				characterBank: { bags: { 2: { items: { 1: { itemID: 42, count: 2 } } } } },
			},
			'Player-2': {
				name: 'Bex', realm: 'Dalaran',
				characterBank: { bags: { 3: { items: { 1: { itemID: 42, count: 4 } } } } },
			},
		},
		warbandSnapshot: { bags: { 4: { items: { 1: { itemID: 42, count: 2 }, 2: { itemID: 7, count: 9 } } } } },
	};

	assert.deepEqual(getSnapshotItemCounts(account, 42), {
		characters: [
			{ name: 'Ada', realm: 'Area 52', count: 6 },
			{ name: 'Bex', realm: 'Dalaran', count: 4 },
		],
		warbandCount: 2,
		total: 12,
	});
	assert.deepEqual(getSnapshotItemCounts(account, 99), { characters: [], warbandCount: 0, total: 0 });
});

test('parses character and shared bank snapshots with escaped strings', () => {
	const account = parseSavedVariables(String.raw`-- SavedVariables
WhatsInTheBagAccountDB = {
	characterSnapshots = {
		["Player-1"] = {
			name = "A\"da",
			realm = "Area 52",
			bags = { capturedAt = 1700000000, bags = { [1] = { name = "Backpack", capacity = 4, items = {} } } },
			characterBank = nil,
		},
	},
	warbandSnapshot = { capturedAt = 1700001000, bags = {} },
	unknownFutureField = true,
}`);

	assert.equal(isLuaTable(account.characterSnapshots), true);
	assert.equal(account.characterSnapshots['Player-1'].name, 'A"da');
	assert.equal(account.characterSnapshots['Player-1'].characterBank, undefined);
	assert.equal(account.warbandSnapshot.capturedAt, 1700001000);
});

test('supports implicit table entries, semicolon separators, and sparse numeric keys', () => {
	const account = parseSavedVariables('WhatsInTheBagAccountDB = { characterSnapshots = {}, values = { "first"; [3] = "third"; "second" } }');
	assert.deepEqual(tableValues(account.values), ['first', 'second', 'third']);
});

test('rejects executable Lua and non-literal expressions', () => {
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = os.execute("bad")'));
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = { value = function() end }'), /Only literal values/);
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = setmetatable({}, {})'));
});

test('rejects unexpected root variables, malformed tables, and wrong snapshot shapes', () => {
	assert.throws(() => parseSavedVariables('SomeOtherDB = {}'), /Expected the WhatsInTheBagAccountDB assignment/);
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = { x = { }'));
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = { characterSnapshots = true }'), /characterSnapshots field must be a table/);
	assert.throws(() => parseSavedVariables('WhatsInTheBagAccountDB = {}; run()'));
});