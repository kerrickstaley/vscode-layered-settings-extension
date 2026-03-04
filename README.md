# VSCode Layered Settings
> "Onions have layers. Ogres have layers. Onions have layers... You get it? We both have layers."
>
> — Mike Myers dba Shrek

A VSCode extension that lets you split your `settings.json` into multiple [Jsonnet](https://jsonnet.org/) files and automatically merges them together.

[Install it from the VSCode extension marketplace.](https://marketplace.visualstudio.com/items?itemName=KerrickStaley.layered-settings)

[Look at this VSCode issue for background on what problem this tries to solve.](https://github.com/microsoft/vscode/issues/15909)

## Prerequisites
Install the [Jsonnet](https://jsonnet.org/) CLI:

```sh
# macOS
brew install jsonnet

# or from source
go install github.com/google/go-jsonnet/cmd/jsonnet@latest
```

Optionally, install the [Jsonnet NG extension](https://marketplace.visualstudio.com/items?itemName=Sebbia.jsonnetng) to get syntax highlighting.

## Quickstart
1. Install the extension and the prerequisites above. Make sure you're not working in a remote VSCode session.
2. Run "Preferences: Open User Settings (JSON)" from the command palette.
3. In the settings.json file that opens, run "File: Save As..." from the command palette.
4. Name the file `settings.original.jsonnet` and save.

After these steps, any changes you make to `settings.original.jsonnet` will be merged into `settings.json`. If you manually edit `settings.json` to be different from `settings.original.jsonnet`, those manual changes will be preserved; see below for merge semantics. You can check `settings.original.json` into version control.

## Use-cases
### Sharing settings between machines
1. Run "Preferences: Open User Settings (JSON)" in the command palette; this will open `settings.json`.
2. Create `settings.60_user.jsonnet` next to this `settings.json` file.
3. Copy settings that you want to share from `settings.json` into `settings.60_user.jsonnet`.
4. Check `settings.60_user.jsonnet` into your dotfiles repo, like [this](https://github.com/kerrickstaley/homedir/blob/main/Library/Application%20Support/Code/User/settings.global.jsonnet).
5. After syncing `settings.60_user.jsonnet` to a new machine, run "Layered Settings: Overwrite settings.json" from the command palette.

Then, when extensions dump random non-config state into your `settings.json`, it stays there and doesn't need to be added to your dotfiles.

### Defining default settings for your team and allowing individuals to override them
1. Create `<git root>/.vscode/settings.20_team.jsonnet` in your team's shared repo.
2. Users can change settings in `<git root>/.vscode/settings.json` and their changes will take precedence.
3. Optionally, users can create e.g. `<git root>/.vscode/settings.60_user.jsonnet` to have more control over their settings.

### Defining base settings for a monorepo and allowing sub-projects to override them
1. Create `<git root>/.vscode/settings.20_team.jsonnet` with common org-wide settings.
2. In each sub-project, symlink `<git root>/.vscode/settings.20_team.jsonnet` to `<git root>/subproject/.vscode/settings.20_team.jsonnet` and also create `<git root>/subproject/.vscode/settings.40_project.jsonnet`.

## Why jsonnet?
Jsonnet has a built-in grammar for extending objects from other objects with its `+:` syntax. This allows things like

```
# settings.20_team.jsonnet
{
    abc: {
        def: 1,
        ghi: 2,
    }
}
```

```
# settings.60_user.jsonnet
{
    abc+: {
        def: 3,
    }
}
```

which merges to
```
// settings.json
{
    "abc": {
        "def": 3,
        "ghi": 2,
    }
}
```

## How are settings combined?
Whenever any `settings.*.jsonnet` file changes, the extension automatically:

1. Combines all `settings.*.jsonnet` files by sorting them lexicographically and combining them with Jsonnet's `+` operator.
2. Diffs `settings.json` and the previous result of combining `settings.*.jsonnet` (before your change) to capture any manual edits you've made.
3. Applies that diff on top of the new combined file.
4. Writes the result to `settings.json` and the new combined `settings.*.jsonnet` file to `settings_generated.json`.

This means you can still edit `settings.json` directly in VS Code's settings UI — your manual changes are preserved across merges.

The `settings_generated.json` file tracks the result of combining the `settings.*.jsonnet` files, so that the extension knows what you manually edited in `settings.json`. You should not edit this file.

This merging process means that if a setting differs between `settings.json` and `settings.*.jsonnet`, it will be "sticky": changing `settings.*.jsonnet` won't have any effect on it. If you update `settings.json` to match `settings.*.jsonnet` (or run "Layered Settings: Overwrite settings.json" to do this for all settings), the setting will then "unstick" and start tracking `settings.*.jsonnet`.

## Scopes

Layered settings work in user, workspace, and remote settings directories.

If you use VSCode remotely, the extension will install on the remote host and will only be able to manage the workspace and remote settings. To manage the client-side user settings, open a new non-remote window and also install the extension there. The local user `settings.*.jsonnet` files will only be auto-merged into the local user `settings.json` file while you have a local VSCode window open. This is a limitation of VSCode extensions.

## Commands

- **Layered Settings: Generate Diff** — Show a read-only Jsonnet overlay representing the diff between `settings.*.jsonnet` and `settings.json`, useful for seeing what manual edits exist
- **Layered Settings: Overwrite settings.json** — Overwrite `settings.json` with the combined `settings.*.jsonnet` files, discarding all manual edits

## Development

```sh
npm install
npm run compile   # build with esbuild
npm run check     # type-check
npm run test      # run tests
npm run watch     # rebuild on change
npm run package   # produce .vsix
```
