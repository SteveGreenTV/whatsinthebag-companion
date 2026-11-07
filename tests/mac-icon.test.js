import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(path.join(root, 'scripts', 'build-mac-icon.cjs'), 'utf8');
const require = createRequire(import.meta.url);

test('generates all macOS icon sizes from the existing 256px ICO image', () => {
	const commands = [];
	const writes = [];
	const removed = [];
	const filesystem = {
		readFileSync,
		mkdtempSync: () => path.join(root, 'temporary-icon-test'),
		mkdirSync: () => {},
		writeFileSync: (name, data) => writes.push({ name, data }),
		rmSync: (name) => removed.push(name),
	};
	const mockRequire = (name) => {
		if (name === 'node:fs') return filesystem;
		if (name === 'node:child_process') return { execFileSync: (command, args) => commands.push({ command, args }) };
		return require(name);
	};
	vm.runInNewContext(script, { require: mockRequire, __dirname: path.join(root, 'scripts'), process: { platform: 'darwin' }, Buffer });

	assert.equal(writes.length, 1);
	assert.equal(writes[0].data.readUInt32BE(16), 256);
	assert.equal(writes[0].data.readUInt32BE(20), 256);
	assert.deepEqual(commands.filter(({ command }) => command === 'sips').map(({ args }) => Number(args[1])), [16, 32, 32, 64, 128, 256, 256, 512, 512, 1024]);
	assert.equal(commands.at(-1).command, 'iconutil');
	assert.equal(commands.at(-1).args.at(-1), path.join(root, 'release', 'app.icns'));
	assert.equal(removed.length, 1);
});

test('rejects icon generation outside macOS', () => {
	assert.throws(() => vm.runInNewContext(script, { require, __dirname: path.join(root, 'scripts'), process: { platform: 'win32' }, Buffer }), /macOS is required/);
});