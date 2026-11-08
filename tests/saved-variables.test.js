import assert from 'node:assert/strict';
import test from 'node:test';
import { isLuaTable, parseSavedVariables, snapshotMatchesNameSearch, tableValues } from '../src/saved-variables.ts';

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