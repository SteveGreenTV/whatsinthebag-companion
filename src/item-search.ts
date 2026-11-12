import { getSnapshotEquipmentSlots, numberValue, snapshotItemMatchesStatus, stringValue, type LuaTable, type LuaValue } from './saved-variables.ts';

interface SearchTerm {
	field: 'text' | 'name' | 'category' | 'subtype' | 'slot' | 'armor' | 'status';
	value: string;
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
const statusTerms = new Set(['equipment', 'soulbound', 'warbound', 'upgradeable', 'openable', 'usable']);
const statusAliases: Record<string, string> = {
	open: 'openable', loot: 'openable', war: 'warbound', band: 'warbound', up: 'upgradeable', upgrade: 'upgradeable',
};

export function parseSearch(query: string, filters: Set<string>): SearchTerm[] {
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

export function itemMatchesSearch(item: LuaTable, terms: SearchTerm[]): boolean {
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
			if (value === 'equipment') {
				if (!getSnapshotEquipmentSlots(item).length) return false;
			} else {
				if (item.statusUnavailable === true && ['soulbound', 'warbound', 'upgradeable'].includes(value)) return false;
				if (!snapshotItemMatchesStatus(item, value)) return false;
			}
		} else {
			const searchable = [item.name, item.category, item.itemSubtype, item.itemLevel, item.equipLoc]
				.map((part) => String(part ?? '').toLocaleLowerCase()).join(' ');
			if (!searchable.includes(value)) return false;
		}
	}
	return true;
}
