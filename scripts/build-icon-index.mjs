import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const [listfilePath, sourceVersion] = process.argv.slice(2);
if (!listfilePath) {
	console.error('Usage: npm run icons:build -- <community-listfile.csv> [listfile-version]');
	process.exitCode = 2;
} else {
	const paths = Object.create(null);
	const lines = createInterface({ input: createReadStream(listfilePath, { encoding: 'utf8' }), crlfDelay: Infinity });
	for await (const line of lines) {
		const separator = line.indexOf(';');
		if (separator < 1) continue;
		const id = line.slice(0, separator);
		const path = line.slice(separator + 1).replaceAll('\\', '/').toLowerCase();
		if (/^\d+$/.test(id) && path.startsWith('interface/icons/') && path.endsWith('.blp')) paths[id] = path;
	}

	const sortedPaths = Object.fromEntries(Object.entries(paths).sort(([left], [right]) => Number(left) - Number(right)));
	const outputPath = fileURLToPath(new URL('../src/icon-paths.json', import.meta.url));
	const manifest = {
		source: 'wowdev/wow-listfile community-listfile.csv',
		version: sourceVersion || 'unspecified',
		count: Object.keys(sortedPaths).length,
		paths: sortedPaths,
	};
	await writeFile(outputPath, `${JSON.stringify(manifest)}\n`, 'utf8');
	console.log(`Wrote ${manifest.count} Interface/Icons paths to ${outputPath}`);
}