const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') throw new Error('macOS is required to generate the app icon.');

const root = path.resolve(__dirname, '..');
const ico = readFileSync(path.join(root, 'assets', 'app.ico'));
const count = ico.readUInt16LE(4);
let largest;
for (let index = 0; index < count; index += 1) {
	const entry = 6 + index * 16;
	const width = ico[entry] || 256;
	const height = ico[entry + 1] || 256;
	if (!largest || width * height > largest.width * largest.height) {
		largest = { width, height, size: ico.readUInt32LE(entry + 8), offset: ico.readUInt32LE(entry + 12) };
	}
}
if (!largest || largest.width !== 256 || largest.height !== 256) throw new Error('Expected a 256px ICO image.');
const image = ico.subarray(largest.offset, largest.offset + largest.size);
if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Expected a PNG ICO image.');

const temporary = mkdtempSync(path.join(os.tmpdir(), 'witb-icon-'));
try {
	const source = path.join(temporary, 'source.png');
	const iconset = path.join(temporary, 'app.iconset');
	mkdirSync(iconset);
	writeFileSync(source, image);
	for (const size of [16, 32, 128, 256, 512]) {
		for (const scale of [1, 2]) {
			const suffix = scale === 2 ? '@2x' : '';
			const output = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
			execFileSync('sips', ['-z', String(size * scale), String(size * scale), source, '--out', output], { stdio: 'ignore' });
		}
	}
	const release = path.join(root, 'release');
	mkdirSync(release, { recursive: true });
	execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(release, 'app.icns')], { stdio: 'inherit' });
} finally {
	rmSync(temporary, { recursive: true, force: true });
}