import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as nodeFs from 'node:fs/promises';
import { doMerge, doOverwrite } from './merge';
const cp = require('node:child_process') as typeof import('node:child_process');
const crypto = require('node:crypto') as typeof import('node:crypto');

const FileType = { File: 1, Directory: 2 };

const state = {
    errors: [] as string[],
    warnings: [] as string[],
    infos: [] as string[],
};

const vscodeApi = {
    FileType,
    Uri: {
        file: (fsPath: string) => ({ fsPath }),
    },
    workspace: {
        fs: {
            readDirectory: async (uri: { fsPath: string }) => {
                try {
                    const entries = await nodeFs.readdir(uri.fsPath, { withFileTypes: true });
                    return entries.map(e => [e.name, e.isFile() ? FileType.File : FileType.Directory] as [string, number]);
                } catch (err: any) {
                    if (err?.code === 'ENOENT') {
                        const fsErr = new Error(err.message);
                        (fsErr as any).code = 'FileNotFound';
                        throw fsErr;
                    }
                    throw err;
                }
            },
            readFile: async (uri: { fsPath: string }) => {
                return nodeFs.readFile(uri.fsPath);
            },
        },
    },
    window: {
        showErrorMessage: (msg: string) => {
            state.errors.push(msg);
        },
        showWarningMessage: (msg: string) => {
            state.warnings.push(msg);
        },
        showInformationMessage: (msg: string) => {
            state.infos.push(msg);
        },
    },
};

function makeOutput() {
    const lines: string[] = [];
    return {
        lines,
        appendLine(line: string) {
            lines.push(line);
        },
    };
}

async function makeTmpDir() {
    return nodeFs.mkdtemp(path.join(os.tmpdir(), 'layered-settings-merge-test-'));
}

describe('doMerge', () => {
    const tmpDirs: string[] = [];
    const restoreFns: Array<() => void> = [];

    function patchMethod<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]) {
        const original = obj[key];
        (obj as any)[key] = fn;
        restoreFns.push(() => {
            (obj as any)[key] = original;
        });
    }

    afterEach(async () => {
        state.errors = [];
        state.warnings = [];
        state.infos = [];
        for (const restore of restoreFns.splice(0)) restore();
        for (const dir of tmpDirs.splice(0)) {
            await nodeFs.rm(dir, { recursive: true, force: true });
        }
    });

    it('returns silently when no fragments exist', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        const output = makeOutput();

        await doMerge(dir, output, vscodeApi);

        assert.deepEqual(output.lines, []);
        assert.deepEqual(state.errors, []);
    });

    it('returns silently when settings directory does not exist', async () => {
        const dir = path.join(os.tmpdir(), 'layered-settings-nonexistent-' + Date.now());
        const output = makeOutput();

        await doMerge(dir, output, vscodeApi);

        assert.deepEqual(output.lines, []);
        assert.deepEqual(state.errors, []);
    });

    it('skips merge when evaluated fragments are unchanged', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        await nodeFs.writeFile(path.join(dir, 'settings.a.jsonnet'), '{ a: 1 }');
        await nodeFs.writeFile(path.join(dir, 'settings_generated.json'), '{ "a": 1 }\n');

        patchMethod(cp as any, 'execFile', (_file: any, _args: any, _opts: any, cb: any) => {
            cb(null, '{"a":1}', '');
            return {} as any;
        });

        const output = makeOutput();
        await doMerge(dir, output, vscodeApi);

        assert.deepEqual(output.lines, ['[merge] Fragments unchanged, skipping']);
        assert.deepEqual(state.errors, []);
        const files = await nodeFs.readdir(dir);
        assert.ok(!files.some(name => name.startsWith('.settings') || name.startsWith('.user_diff')));
    });

    it('merges generated and user settings and writes final files', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        await nodeFs.writeFile(path.join(dir, 'settings.a.jsonnet'), '{ gen: 1 }');
        await nodeFs.writeFile(path.join(dir, 'settings_generated.json'), '{ "old": true }\n');
        await nodeFs.writeFile(path.join(dir, 'settings.json'), '{ "user": 2 }\n');

        let callCount = 0;
        patchMethod(cp as any, 'execFile', (_file: any, _args: any, _opts: any, cb: any) => {
            callCount += 1;
            cb(null, callCount === 1 ? '{"gen":1}' : '{"gen":1,"user":2}', '');
            return {} as any;
        });
        patchMethod(crypto as any, 'randomBytes', () => Buffer.from('deadbeef', 'hex') as any);

        const output = makeOutput();
        await doMerge(dir, output, vscodeApi);

        assert.deepEqual(output.lines, ['[merge] Merged 1 fragment(s) into settings.json']);
        assert.deepEqual(state.errors, []);
        assert.equal(await nodeFs.readFile(path.join(dir, 'settings_generated.json'), 'utf8'), '{\n    "gen": 1\n}\n');
        assert.equal(
            await nodeFs.readFile(path.join(dir, 'settings.json'), 'utf8'),
            '{\n    "gen": 1,\n    "user": 2\n}\n',
        );
        const files = await nodeFs.readdir(dir);
        assert.ok(!files.includes('.settings_generated.tmpdeadbeef.json'));
        assert.ok(!files.includes('.user_diff.tmpdeadbeef.jsonnet'));
        assert.ok(!files.includes('.settings.tmpdeadbeef.json'));
    });

    it('reports merge errors and cleans temporary files (doMerge)', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        await nodeFs.writeFile(path.join(dir, 'settings.a.jsonnet'), '{ gen: 1 }');
        await nodeFs.writeFile(path.join(dir, 'settings_generated.json'), '{}\n');
        await nodeFs.writeFile(path.join(dir, 'settings.json'), '{ "user": 2 }\n');

        let callCount = 0;
        patchMethod(cp as any, 'execFile', (_file: any, _args: any, _opts: any, cb: any) => {
            callCount += 1;
            cb(null, callCount === 1 ? '{"gen":1}' : '{not-json', '');
            return {} as any;
        });
        patchMethod(crypto as any, 'randomBytes', () => Buffer.from('cafebabe', 'hex') as any);

        const output = makeOutput();
        await doMerge(dir, output, vscodeApi);

        assert.equal(output.lines.length, 1);
        assert.match(output.lines[0], /^\[error\] /);
        assert.equal(state.errors.length, 1);
        assert.match(state.errors[0], /^Layered Settings: /);
        const files = await nodeFs.readdir(dir);
        assert.ok(!files.includes('.settings_generated.tmpcafebabe.json'));
        assert.ok(!files.includes('.user_diff.tmpcafebabe.jsonnet'));
        assert.ok(!files.includes('.settings.tmpcafebabe.json'));
    });
});

describe('doOverwrite', () => {
    const tmpDirs: string[] = [];
    const restoreFns: Array<() => void> = [];

    function patchMethod<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]) {
        const original = obj[key];
        (obj as any)[key] = fn;
        restoreFns.push(() => {
            (obj as any)[key] = original;
        });
    }

    afterEach(async () => {
        state.errors = [];
        state.warnings = [];
        state.infos = [];
        for (const restore of restoreFns.splice(0)) restore();
        for (const dir of tmpDirs.splice(0)) {
            await nodeFs.rm(dir, { recursive: true, force: true });
        }
    });

    it('shows error when no fragments exist', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        const output = makeOutput();

        await doOverwrite(dir, output, vscodeApi);

        assert.deepEqual(output.lines, []);
        assert.deepEqual(state.errors, ['Layered Settings: No settings.*.jsonnet fragments found']);
    });

    it('backs up existing settings.json before overwriting', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        await nodeFs.writeFile(path.join(dir, 'settings.a.jsonnet'), '{ a: 1 }');
        await nodeFs.writeFile(path.join(dir, 'settings.json'), '{ "old": true }\n');

        patchMethod(cp as any, 'execFile', (_file: any, _args: any, _opts: any, cb: any) => {
            cb(null, '{"a":1}', '');
            return {} as any;
        });

        const output = makeOutput();
        await doOverwrite(dir, output, vscodeApi);

        // settings.json should be overwritten
        assert.equal(await nodeFs.readFile(path.join(dir, 'settings.json'), 'utf8'), '{\n    "a": 1\n}\n');

        // a backup file should exist with the old content
        const files = await nodeFs.readdir(dir);
        const backups = files.filter(f => f.startsWith('.settings.backup_'));
        assert.equal(backups.length, 1);
        assert.match(backups[0], /^\.settings\.backup_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_\d{3}\.json$/);
        assert.equal(await nodeFs.readFile(path.join(dir, backups[0]), 'utf8'), '{ "old": true }\n');

        // should show info notification
        assert.equal(state.infos.length, 1);
        assert.match(state.infos[0], /backed up to \.settings\.backup_/);

        // output log should mention backup
        assert.ok(output.lines.some(l => l.includes('[overwrite] Backed up')));
    });

    it('skips backup gracefully when settings.json does not exist', async () => {
        const dir = await makeTmpDir();
        tmpDirs.push(dir);
        await nodeFs.writeFile(path.join(dir, 'settings.a.jsonnet'), '{ a: 1 }');

        patchMethod(cp as any, 'execFile', (_file: any, _args: any, _opts: any, cb: any) => {
            cb(null, '{"a":1}', '');
            return {} as any;
        });

        const output = makeOutput();
        await doOverwrite(dir, output, vscodeApi);

        // settings.json should be created
        assert.equal(await nodeFs.readFile(path.join(dir, 'settings.json'), 'utf8'), '{\n    "a": 1\n}\n');

        // no backup file should exist
        const files = await nodeFs.readdir(dir);
        assert.ok(!files.some(f => f.startsWith('.settings.backup_')));

        // no info notification, but should log that there was nothing to back up
        assert.deepEqual(state.infos, []);
        assert.deepEqual(state.errors, []);
        assert.ok(output.lines.some(l => l.includes('No existing settings.json to back up')));
    });
});
