const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { lstat, readFile, readdir, realpath, stat } = require('node:fs/promises');
const path = require('node:path');

const buildDirectory = path.resolve(__dirname, '..', 'dist');
const appIcon = path.resolve(__dirname, '..', 'assets', 'app.ico');
const contentTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.wasm', 'application/wasm'],
]);

let server;
let appUrl;
const retailSelections = new Map();

function getRetailSelection(event) {
	if (!event.senderFrame?.url.startsWith(appUrl)) throw new Error('Untrusted viewer request.');
	const selection = retailSelections.get(event.sender.id);
	if (!selection) throw new Error('Select a retail folder first.');
	return selection;
}

async function resolveWithin(root, target) {
	const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(target)]);
	const relative = path.relative(resolvedRoot, resolvedTarget);
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error('Requested file is outside the selected retail folder.');
	}
	return resolvedTarget;
}

ipcMain.handle('snapshot:select-retail-folder', async (event) => {
	const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
		title: 'Select the WoW _retail_ folder',
		buttonLabel: 'Select folder',
		properties: ['openDirectory'],
	});
	if (result.canceled || !result.filePaths[0]) return { canceled: true };

	const retailRoot = path.resolve(result.filePaths[0]);
	if (path.basename(retailRoot).toLowerCase() !== '_retail_') {
		throw new Error('Select the _retail_ folder inside your World of Warcraft installation.');
	}

	let iconsRoot = null;
	const candidateIconsRoot = path.join(retailRoot, 'BlizzardInterfaceArt', 'Interface', 'ICONS');
	try {
		if ((await lstat(candidateIconsRoot)).isDirectory()) iconsRoot = await resolveWithin(retailRoot, candidateIconsRoot);
	} catch {}

	const accounts = new Map();
	const accountsRoot = path.join(retailRoot, 'WTF', 'Account');
	const accountDirectories = await readdir(accountsRoot, { withFileTypes: true }).catch(() => []);
	for (const accountDirectory of accountDirectories) {
		if (!accountDirectory.isDirectory()) continue;
		const snapshotPath = path.join(accountsRoot, accountDirectory.name, 'SavedVariables', 'WhatsInTheBag.lua');
		try {
			if (!(await lstat(snapshotPath)).isFile()) continue;
			await resolveWithin(retailRoot, snapshotPath);
			accounts.set(accountDirectory.name, snapshotPath);
		} catch {}
	}

	retailSelections.set(event.sender.id, { retailRoot, iconsRoot, accounts });
	return {
		canceled: false,
		hasIcons: iconsRoot !== null,
		accounts: [...accounts.keys()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
	};
});

ipcMain.handle('snapshot:read-account', async (event, accountName) => {
	if (typeof accountName !== 'string') throw new Error('Invalid account selection.');
	const selection = getRetailSelection(event);
	const snapshotPath = selection.accounts.get(accountName);
	if (!snapshotPath) throw new Error('The selected account snapshot was not found.');
	const safePath = await resolveWithin(selection.retailRoot, snapshotPath);
	if (!(await lstat(safePath)).isFile()) throw new Error('The account snapshot is not a file.');
	return readFile(safePath, 'utf8');
});

ipcMain.handle('snapshot:read-icon', async (event, iconPath) => {
	if (typeof iconPath !== 'string' || iconPath.length > 1024) throw new Error('Invalid icon path.');
	const selection = getRetailSelection(event);
	if (!selection.iconsRoot) throw new Error('The selected retail folder has no exported icon directory.');
	const normalizedPath = iconPath.replaceAll('\\', '/');
	const segments = normalizedPath.split('/');
	if (segments.length < 3 || segments[0].toLowerCase() !== 'interface'
		|| segments[1].toLowerCase() !== 'icons' || segments.some((segment) => !segment || segment === '.' || segment === '..')
		|| path.extname(normalizedPath).toLowerCase() !== '.blp') {
		throw new Error('Only BLP files under Interface/Icons can be read.');
	}
	const iconPathOnDisk = path.resolve(selection.iconsRoot, ...segments.slice(2));
	const safePath = await resolveWithin(selection.iconsRoot, iconPathOnDisk);
	if (!(await lstat(safePath)).isFile()) throw new Error('The requested icon is not a file.');
	const bytes = await readFile(safePath);
	return Uint8Array.from(bytes).buffer;
});

async function serveBuild(request, response) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405).end();
		return;
	}

	let pathname;
	try {
		pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
	} catch {
		response.writeHead(400).end();
		return;
	}

	const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
	const filePath = path.resolve(buildDirectory, relativePath);
	const fromBuild = path.relative(buildDirectory, filePath);
	if (fromBuild.startsWith('..') || path.isAbsolute(fromBuild)) {
		response.writeHead(403).end();
		return;
	}

	try {
		if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
		const contents = await readFile(filePath);
		response.writeHead(200, {
			'Cache-Control': 'no-store',
			'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
		});
		response.end(request.method === 'HEAD' ? undefined : contents);
	} catch {
		response.writeHead(404).end();
	}
}

async function startLocalServer() {
	if (appUrl) return appUrl;
	if (!(await stat(path.join(buildDirectory, 'index.html')).catch(() => null))) {
		throw new Error('The desktop viewer build is missing. Run `npm run build` first.');
	}
	server = createServer((request, response) => { void serveBuild(request, response); });
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	appUrl = `http://127.0.0.1:${address.port}/`;
	return appUrl;
}

function isViewerUrl(target) {
	try {
		const requested = new URL(target);
		const viewer = new URL(appUrl);
		return requested.origin === viewer.origin && requested.pathname === '/';
	} catch {
		return false;
	}
}

function windowOptions() {
	return {
		width: 1180,
		height: 860,
		minWidth: 780,
		minHeight: 620,
		show: false,
		backgroundColor: '#111315',
		...(process.platform === 'darwin' ? {} : { icon: appIcon }),
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	};
}

function configureWindow(window) {
	window.webContents.once('destroyed', () => retailSelections.delete(window.webContents.id));
	window.webContents.setWindowOpenHandler(({ url }) => isViewerUrl(url)
		? { action: 'allow', overrideBrowserWindowOptions: windowOptions() }
		: { action: 'deny' });
	window.webContents.on('did-create-window', (childWindow, details) => {
		if (!isViewerUrl(details.url)) {
			childWindow.close();
			return;
		}
		const selection = retailSelections.get(window.webContents.id);
		if (selection) retailSelections.set(childWindow.webContents.id, selection);
		configureWindow(childWindow);
	});
	window.webContents.on('will-navigate', (event, target) => {
		if (!isViewerUrl(target)) event.preventDefault();
	});
	window.once('ready-to-show', () => window.show());
}

async function createWindow() {
	const url = await startLocalServer();
	const window = new BrowserWindow(windowOptions());
	configureWindow(window);
	await window.loadURL(url);
}

app.whenReady().then(createWindow).catch((error) => {
	dialog.showErrorBox('Snapshot viewer could not start', error.message);
	app.quit();
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => server?.close());
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});