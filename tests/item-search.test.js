import assert from 'node:assert/strict';
import test from 'node:test';
import { itemMatchesSearch, parseSearch } from '../src/item-search.ts';

test('item search combines text, aliases, and quick filters', () => {
	const robe = { name: 'Crimson Robe', equipLoc: 'INVTYPE_ROBE', classID: 4, subClassID: 1 };
	const terms = parseSearch('slot:chest name:crimson', new Set(['armor:cloth', 'equipment']));
	assert.equal(itemMatchesSearch(robe, terms), true);
	assert.equal(itemMatchesSearch({ ...robe, subClassID: 4 }, terms), false);
	assert.equal(itemMatchesSearch({ ...robe, equipLoc: '' }, terms), false);
	assert.equal(itemMatchesSearch({ ...robe, name: 'Blue Robe' }, terms), false);
});

test('item search respects subtype aliases and unavailable binding data', () => {
	assert.equal(itemMatchesSearch({ classID: 2, subClassID: 8 }, parseSearch('type:sword', new Set())), true);
	assert.equal(itemMatchesSearch({ classID: 2, subClassID: 10 }, parseSearch('type:sword', new Set())), false);
	assert.equal(itemMatchesSearch({ soulbound: true, statusUnavailable: true }, parseSearch('soulbound', new Set())), false);
});
