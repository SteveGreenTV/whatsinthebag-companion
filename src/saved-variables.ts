export { parseSavedVariables } from './lua-parser.ts';

export interface LuaTable {
	[key: string]: LuaValue;
}
export type LuaValue = LuaTable | string | number | boolean | null;

export interface SnapshotEquipmentSlot {
	name: string;
	order: number;
}

const equipmentSlotsByLocation: Record<string, SnapshotEquipmentSlot[]> = {
	INVTYPE_HEAD: [{ name: 'Head', order: 0 }],
	INVTYPE_NECK: [{ name: 'Neck', order: 1 }],
	INVTYPE_SHOULDER: [{ name: 'Shoulder', order: 2 }],
	INVTYPE_CLOAK: [{ name: 'Back', order: 3 }],
	INVTYPE_CHEST: [{ name: 'Chest', order: 4 }],
	INVTYPE_ROBE: [{ name: 'Chest', order: 4 }],
	INVTYPE_BODY: [{ name: 'Shirt', order: 5 }],
	INVTYPE_TABARD: [{ name: 'Tabard', order: 6 }],
	INVTYPE_WRIST: [{ name: 'Wrist', order: 7 }],
	INVTYPE_HAND: [{ name: 'Hands', order: 8 }],
	INVTYPE_WAIST: [{ name: 'Waist', order: 9 }],
	INVTYPE_LEGS: [{ name: 'Legs', order: 10 }],
	INVTYPE_FEET: [{ name: 'Feet', order: 11 }],
	INVTYPE_FINGER: [{ name: 'Finger', order: 12 }],
	INVTYPE_TRINKET: [{ name: 'Trinket', order: 13 }],
	INVTYPE_WEAPON: [
		{ name: 'Main Hand', order: 14 },
		{ name: 'Off Hand', order: 15 },
	],
	INVTYPE_WEAPONMAINHAND: [{ name: 'Main Hand', order: 14 }],
	INVTYPE_2HWEAPON: [{ name: 'Main Hand', order: 14 }],
	INVTYPE_RANGED: [{ name: 'Ranged', order: 16 }],
	INVTYPE_RANGEDRIGHT: [{ name: 'Ranged', order: 16 }],
	INVTYPE_THROWN: [{ name: 'Ranged', order: 16 }],
	INVTYPE_RELIC: [{ name: 'Ranged', order: 16 }],
	INVTYPE_WEAPONOFFHAND: [{ name: 'Off Hand', order: 15 }],
	INVTYPE_SHIELD: [{ name: 'Off Hand', order: 15 }],
	INVTYPE_HOLDABLE: [{ name: 'Off Hand', order: 15 }],
	INVTYPE_PROFESSION_TOOL: [{ name: 'Profession Tool', order: 17 }],
	INVTYPE_PROFESSION_GEAR: [{ name: 'Profession Gear', order: 18 }],
};

export function getSnapshotEquipmentSlots(item: LuaTable): SnapshotEquipmentSlot[] {
	const location = typeof item.equipLoc === 'string' ? item.equipLoc.toLocaleUpperCase() : '';
	return equipmentSlotsByLocation[location] || [];
}

export function isSnapshotEquipmentItem(item: LuaTable): boolean {
	return getSnapshotEquipmentSlots(item).length > 0;
}

export function compareSnapshotItems(
	left: LuaTable,
	right: LuaTable,
	options: { equipment: boolean; sortByItemLevel: boolean },
): number {
	if (options.equipment) {
		const leftOrder = getSnapshotEquipmentSlots(left)[0]?.order ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = getSnapshotEquipmentSlots(right)[0]?.order ?? Number.MAX_SAFE_INTEGER;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
	}

	if (options.sortByItemLevel) {
		const leftLevel = typeof left.itemLevel === 'number' && Number.isFinite(left.itemLevel) && left.itemLevel > 0
			? left.itemLevel : null;
		const rightLevel = typeof right.itemLevel === 'number' && Number.isFinite(right.itemLevel) && right.itemLevel > 0
			? right.itemLevel : null;
		if (leftLevel === null && rightLevel !== null) return 1;
		if (leftLevel !== null && rightLevel === null) return -1;
		if (leftLevel !== null && rightLevel !== null && leftLevel !== rightLevel) return rightLevel - leftLevel;
	}

	const leftName = typeof left.name === 'string' && left.name.length ? left.name : null;
	const rightName = typeof right.name === 'string' && right.name.length ? right.name : null;
	if (leftName === null && rightName !== null) return 1;
	if (leftName !== null && rightName === null) return -1;
	const nameOrder = leftName?.localeCompare(rightName || '', undefined, { sensitivity: 'base' }) || 0;
	if (nameOrder) return nameOrder;

	const leftBag = typeof left.bagID === 'number' ? left.bagID : 0;
	const rightBag = typeof right.bagID === 'number' ? right.bagID : 0;
	if (leftBag !== rightBag) return leftBag - rightBag;
	const leftSlot = typeof left.slotIndex === 'number' ? left.slotIndex : 0;
	const rightSlot = typeof right.slotIndex === 'number' ? right.slotIndex : 0;
	return leftSlot - rightSlot;
}

export function sortSnapshotItems(
	items: LuaTable[],
	options: { equipment: boolean; sortByItemLevel: boolean },
): LuaTable[] {
	return [...items].sort((left, right) => compareSnapshotItems(left, right, options));
}

export function groupSnapshotItemsBySubcategory(items: LuaTable[]): [string, LuaTable[]][] {
	const groups = new Map<string, LuaTable[]>();
	for (const item of items) {
		const subcategory = typeof item.itemSubtype === 'string' ? item.itemSubtype : '';
		const groupedItems = groups.get(subcategory) || [];
		groupedItems.push(item);
		groups.set(subcategory, groupedItems);
	}
	return [...groups.entries()].sort(([left], [right]) => {
		if (!left || !right) return left ? -1 : right ? 1 : 0;
		return left.localeCompare(right, undefined, { sensitivity: 'base' });
	});
}

export function snapshotItemMatchesStatus(item: LuaTable, status: string): boolean {
	if (status === 'upgradeable' && isLuaTable(item.upgradeInfo)) {
		const maximum = item.upgradeInfo.maxLevel;
		if (typeof maximum === 'number' && Number.isFinite(maximum) && maximum <= 0) return false;
	}
	if (item[status] !== false) return true;
	if (status !== 'upgradeable' || !isLuaTable(item.upgradeInfo)) return false;
	const current = item.upgradeInfo.currentLevel;
	const maximum = item.upgradeInfo.maxLevel;
	return typeof current === 'number' && Number.isFinite(current)
		&& typeof maximum === 'number' && Number.isFinite(maximum)
		&& maximum > 0 && current >= maximum;
}

export function snapshotMatchesNameSearch(snapshot: LuaValue | undefined, query: string): boolean {
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (!terms.length || !isLuaTable(snapshot)) return false;
	return tableValues(snapshot.bags).some((bag) => isLuaTable(bag)
		&& tableValues(bag.items).some((item) => isLuaTable(item)
			&& typeof item.name === 'string'
			&& terms.every((term) => (item.name as string).toLowerCase().includes(term))));
}

export function snapshotCharacterMatchesNameSearch(character: LuaValue | undefined, query: string): boolean {
	if (!isLuaTable(character)) return false;
	return snapshotMatchesNameSearch(character.bags, query)
		|| snapshotMatchesNameSearch(character.characterBank, query);
}

export interface ItemCountByCharacter {
	name: string;
	realm: string;
	count: number;
}

export interface SnapshotItemCounts {
	characters: ItemCountByCharacter[];
	warbandCount: number;
	total: number;
}

function countItemInSnapshot(snapshot: LuaValue | undefined, itemID: number): number {
	if (!isLuaTable(snapshot)) return 0;
	let total = 0;
	for (const bagValue of tableValues(snapshot.bags)) {
		if (!isLuaTable(bagValue)) continue;
		for (const itemValue of tableValues(bagValue.items)) {
			if (isLuaTable(itemValue) && itemValue.itemID === itemID) {
				total += typeof itemValue.count === 'number' ? itemValue.count : 1;
			}
		}
	}
	return total;
}

export function getSnapshotItemCounts(account: LuaTable, itemID: number): SnapshotItemCounts {
	const charactersTable = account.characterSnapshots;
	const characters: ItemCountByCharacter[] = [];
	let total = 0;
	if (isLuaTable(charactersTable)) {
		for (const [key, characterValue] of Object.entries(charactersTable)) {
			if (!isLuaTable(characterValue)) continue;
			const count = countItemInSnapshot(characterValue.bags, itemID)
				+ countItemInSnapshot(characterValue.characterBank, itemID);
			if (count <= 0) continue;
			characters.push({
				name: typeof characterValue.name === 'string' ? characterValue.name : key,
				realm: typeof characterValue.realm === 'string' ? characterValue.realm : '',
				count,
			});
			total += count;
		}
	}
	characters.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
		|| left.realm.localeCompare(right.realm, undefined, { sensitivity: 'base' }));
	const warbandCount = countItemInSnapshot(account.warbandSnapshot, itemID);
	return { characters, warbandCount, total: total + warbandCount };
}

export function isLuaTable(value: LuaValue | undefined): value is LuaTable {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function valueTable(value: LuaValue | undefined): LuaTable | null {
	return isLuaTable(value) ? value : null;
}

export function tableValues(value: LuaValue | undefined): LuaValue[] {
	if (!isLuaTable(value)) return [];
	return Object.keys(value)
		.sort((left, right) => {
			const leftNumber = Number(left);
			const rightNumber = Number(right);
			if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) return leftNumber - rightNumber;
			return left.localeCompare(right);
		})
		.map((key) => value[key]);
}

export function stringValue(value: LuaValue | undefined, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

export function numberValue(value: LuaValue | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
