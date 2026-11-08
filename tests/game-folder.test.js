import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const require = createRequire(import.meta.url);

async function createHost(context) {
	const temporary = await filesystem.mkdtemp(path.join(os.tmpdir(), 'witb-game-folder-'));
	context.after(() => filesystem.rm(temporary, { recursive: true, force: true }));
	const handlers = new Map();
	const redirects = new Map();
	let pickedFolder;
	const mockRequire = (name) => {
		if (name === 'electron') return {
			app: { whenReady: () => new Promise(() => {}), on: () => {} },
			BrowserWindow: { fromWebContents: () => null },
			dialog: { showOpenDialog: async () => ({ canceled: !pickedFolder, filePaths: pickedFolder ? [pickedFolder] : [] }) },
			ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
		};
		if (name === 'node:fs/promises') return {
			...filesystem,
			realpath: async (target) => redirects.get(target) || filesystem.realpath(target),
		};
		return require(name);
	};
	const sandbox = vm.createContext({ require: mockRequire, __dirname: path.join(root, 'electron'), process, Buffer });
	vm.runInContext(script, sandbox);
	vm.runInContext("appUrl = 'http://127.0.0.1:12345/';", sandbox);
	const event = { sender: { id: 1 }, senderFrame: { url: 'http://127.0.0.1:12345/' } };
	return {
		temporary,
		redirects,
		event,
		select: (folder) => {
			pickedFolder = folder;
			return handlers.get('snapshot:select-game-folder')(event);
		},
		readAccount: (accountName, request = event) => handlers.get('snapshot:read-account')(request, accountName),
		readIcon: (iconPath) => handlers.get('snapshot:read-icon')(event, iconPath),
	};
}

async function createGame(host, name, { icons = true } = {}) {
	const gameRoot = path.join(host.temporary, name);
	const snapshot = path.join(gameRoot, 'WTF', 'Account', 'TestAccount', 'SavedVariables', 'WhatsInTheBag.lua');
	await filesystem.mkdir(path.dirname(snapshot), { recursive: true });
	await filesystem.writeFile(snapshot, `WhatsInTheBagAccountDB = { source = '${name}' }`);
	const iconsRoot = path.join(gameRoot, 'BlizzardInterfaceArt', 'Interface', 'ICONS');
	const icon = path.join(iconsRoot, 'test.blp');
	if (icons) {
		await filesystem.mkdir(iconsRoot, { recursive: true });
		await filesystem.writeFile(icon, Uint8Array.from([1, 2, 3]));
	}
	return { gameRoot, snapshot, iconsRoot, icon };
}

for (const name of ['_retail_', '_forever_', '_RETAIL_', '_FOREVER_']) {
	test(`opens ${name} and reads only discovered snapshots and mapped icons`, async (context) => {
		const host = await createHost(context);
		const game = await createGame(host, name);
		const selection = await host.select(game.gameRoot);
		assert.equal(selection.canceled, false);
		assert.equal(selection.hasIcons, true);
		assert.deepEqual(Array.from(selection.accounts), ['TestAccount']);
		assert.match(await host.readAccount('TestAccount'), new RegExp(name));
		assert.deepEqual(Array.from(new Uint8Array(await host.readIcon('Interface/Icons/test.blp'))), [1, 2, 3]);
		await assert.rejects(host.readAccount('../OtherAccount'), /not found/);
		await assert.rejects(host.readIcon('Interface/Icons/../test.blp'), /Only BLP/);
		await assert.rejects(host.readAccount('TestAccount', { sender: { id: 1 }, senderFrame: { url: 'https://example.invalid/' } }), /Untrusted/);
	});
}

test('rejects unrelated folders and preserves selection on cancellation', async (context) => {
	const host = await createHost(context);
	const game = await createGame(host, '_retail_');
	await host.select(game.gameRoot);
	assert.equal((await host.select()).canceled, true);
	await assert.rejects(host.select(path.join(host.temporary, '_classic_')), /_retail_ or _forever_/);
	assert.match(await host.readAccount('TestAccount'), /_retail_/);
});

test('switches same-name accounts to Forever and tolerates missing icons', async (context) => {
	const host = await createHost(context);
	const retail = await createGame(host, '_retail_');
	const forever = await createGame(host, '_forever_', { icons: false });
	await host.select(retail.gameRoot);
	assert.equal((await host.select(forever.gameRoot)).hasIcons, false);
	assert.match(await host.readAccount('TestAccount'), /_forever_/);
	await assert.rejects(host.readIcon('Interface/Icons/test.blp'), /no exported icon directory/);
});

test('rejects snapshots and icons resolving outside the selected root', async (context) => {
	const host = await createHost(context);
	const game = await createGame(host, '_forever_');
	host.redirects.set(game.snapshot, path.join(host.temporary, 'outside.lua'));
	host.redirects.set(game.iconsRoot, path.join(host.temporary, 'outside-icons'));
	const rejected = await host.select(game.gameRoot);
	assert.equal(rejected.accounts.length, 0);
	assert.equal(rejected.hasIcons, false);
	host.redirects.clear();
	await host.select(game.gameRoot);
	host.redirects.set(game.snapshot, path.join(host.temporary, 'outside.lua'));
	host.redirects.set(game.icon, path.join(host.temporary, 'outside.blp'));
	await assert.rejects(host.readAccount('TestAccount'), /outside the selected game folder/);
	await assert.rejects(host.readIcon('Interface/Icons/test.blp'), /outside the selected game folder/);
});

test('preload exposes the matching game-folder IPC contract', async () => {
	let exposed;
	const calls = [];
	vm.runInNewContext(readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8'), {
		require: () => ({
			contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } },
			ipcRenderer: { invoke: async (channel) => { calls.push(channel); return { canceled: true }; } },
		}),
	});
	assert.equal(exposed.name, 'snapshotHost');
	await exposed.api.selectGameFolder();
	assert.deepEqual(calls, ['snapshot:select-game-folder']);
});