import * as vscode from 'vscode';

const DIFF_NAME = 'settings.~diff.jsonnet';
const DIFF_SCHEME = 'layered-settings-diff';

class DiffProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this._onDidChange.event;
    private _content = '';

    update(content: string) {
        this._content = content;
        this._onDidChange.fire(DIFF_URI);
    }

    provideTextDocumentContent(): string { return this._content; }
}

const DIFF_URI = vscode.Uri.from({ scheme: DIFF_SCHEME, path: DIFF_NAME });
const diffProvider = new DiffProvider();

export function registerDiffProvider(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    );
}

export async function showDiff(content: string) {
    diffProvider.update(content);
    const doc = await vscode.workspace.openTextDocument(DIFF_URI);
    await vscode.window.showTextDocument(doc);
}
