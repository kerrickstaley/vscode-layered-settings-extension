import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { parse, ParseError } from 'jsonc-parser';
import { deepEqual, jsonnetDiff } from './diff';

const FRAGMENT_RE = /^settings\.(.+)\.jsonnet$/;

type VscodeLike = {
    FileType: { File: number };
    Uri: { file(fsPath: string): { fsPath: string } };
    workspace: {
        fs: {
            readDirectory(uri: { fsPath: string }): PromiseLike<[string, number][]>;
            readFile(uri: { fsPath: string }): PromiseLike<Uint8Array>;
        };
    };
    window: {
        showErrorMessage(message: string): unknown;
        showWarningMessage(message: string): unknown;
        showInformationMessage(message: string): unknown;
    };
};

type OutputLike = {
    appendLine(line: string): unknown;
};

export async function findFragments(userDir: string, vscodeApi: VscodeLike): Promise<string[]> {
    const dirUri = vscodeApi.Uri.file(userDir);
    let entries: [string, number][];
    try {
        entries = await vscodeApi.workspace.fs.readDirectory(dirUri);
    } catch (err: any) {
        if (err?.code === 'FileNotFound') return [];
        throw err;
    }
    return entries
        .filter(([n, t]) => t === vscodeApi.FileType.File && FRAGMENT_RE.test(n))
        .sort((a, b) => a[0].match(FRAGMENT_RE)![1].localeCompare(b[0].match(FRAGMENT_RE)![1]))
        .map(([n]) => n);
}

async function evalFragments(userDir: string, files: string[]): Promise<Record<string, any>> {
    const expr = files
        .map(f => `(import '${f}')`)
        .join('\n+ ');

    const result = await execJsonnet(['-J', userDir, '-e', expr]);
    const parsed = JSON.parse(result);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Jsonnet evaluation did not produce a JSON object');
    }
    return parsed;
}

function execJsonnet(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.execFile('jsonnet', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr.trim() || err.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

async function readJsonc(filePath: string, vscodeApi: VscodeLike): Promise<Record<string, any> | undefined> {
    try {
        const data = await vscodeApi.workspace.fs.readFile(vscodeApi.Uri.file(filePath));
        const text = Buffer.from(data).toString('utf8');
        const errors: ParseError[] = [];
        const obj = parse(text, errors, {
            allowTrailingComma: true,
            disallowComments: false,
        });
        if (errors.length) {
            vscodeApi.window.showWarningMessage(`Layered Settings: Parse errors in ${path.basename(filePath)}`);
        }
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? obj : undefined;
    } catch {
        return undefined;
    }
}

export async function doOverwrite(settingsDir: string, output: OutputLike, vscodeApi: VscodeLike) {
    try {
        const fragments = await findFragments(settingsDir, vscodeApi);
        if (!fragments.length) {
            vscodeApi.window.showErrorMessage('Layered Settings: No settings.*.jsonnet fragments found');
            return;
        }
        const generated = await evalFragments(settingsDir, fragments);
        const content = JSON.stringify(generated, null, 4) + '\n';
        await fs.writeFile(path.join(settingsDir, 'settings_generated.json'), content);

        const settingsPath = path.join(settingsDir, 'settings.json');
        const now = new Date();
        const pad = (n: number, w = 2) => String(n).padStart(w, '0');
        const backupName = `.settings.backup_${now.getFullYear()}_${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}.json`;
        try {
            await fs.copyFile(settingsPath, path.join(settingsDir, backupName));
            vscodeApi.window.showInformationMessage(`Layered Settings: Old settings.json backed up to ${backupName}`);
            output.appendLine(`[overwrite] Backed up settings.json to ${backupName}`);
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                output.appendLine('[overwrite] No existing settings.json to back up');
            } else {
                throw err;
            }
        }

        await fs.writeFile(settingsPath, content);
        output.appendLine(`[overwrite] Overwrote settings.json from ${fragments.length} fragment(s)`);
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        output.appendLine(`[error] ${msg}`);
        vscodeApi.window.showErrorMessage(`Layered Settings: ${msg}`);
    }
}

export async function doMerge(settingsDir: string, output: OutputLike, vscodeApi: VscodeLike) {
    try {
        const fragments = await findFragments(settingsDir, vscodeApi);
        if (!fragments.length) return;
        const newGenerated = await evalFragments(settingsDir, fragments);
        const oldGenerated = await readJsonc(path.join(settingsDir, 'settings_generated.json'), vscodeApi) ?? {};
        if (deepEqual(newGenerated, oldGenerated)) {
            output.appendLine('[merge] Fragments unchanged, skipping');
            return;
        }
        const currentSettings = await readJsonc(path.join(settingsDir, 'settings.json'), vscodeApi) ?? {};
        const diffBody = jsonnetDiff(oldGenerated, currentSettings, 1);
        const rand = crypto.randomBytes(4).toString('hex');
        const genName = `.settings_generated.tmp${rand}.json`;
        const diffName = `.user_diff.tmp${rand}.jsonnet`;
        const mergedName = `.settings.tmp${rand}.json`;
        const genPath = path.join(settingsDir, genName);
        const diffPath = path.join(settingsDir, diffName);
        const mergedPath = path.join(settingsDir, mergedName);
        try {
            await fs.writeFile(genPath, JSON.stringify(newGenerated, null, 4) + '\n', { mode: 0o444 });
            await fs.writeFile(diffPath, '{\n' + diffBody + '}\n');

            const merged = await execJsonnet([
                '-J', settingsDir,
                '-e', `(import '${genName}') + (import '${diffName}')`,
            ]);
            const mergedObj = JSON.parse(merged);

            await fs.writeFile(mergedPath, JSON.stringify(mergedObj, null, 4) + '\n');

            await fs.rename(genPath, path.join(settingsDir, 'settings_generated.json'));
            await fs.rename(mergedPath, path.join(settingsDir, 'settings.json'));
        } finally {
            await Promise.all([
                fs.unlink(genPath).catch(() => {}),
                fs.unlink(diffPath).catch(() => {}),
                fs.unlink(mergedPath).catch(() => {}),
            ]);
        }
        output.appendLine(`[merge] Merged ${fragments.length} fragment(s) into settings.json`);
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        output.appendLine(`[error] ${msg}`);
        vscodeApi.window.showErrorMessage(`Layered Settings: ${msg}`);
    }
}
