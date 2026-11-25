# NextCode for Orca

A community sidebar for reading NextCode merge requests and issues, opening original details, and associating items with existing local or remote Orca workspaces.

Requires Orca 1.4.248 or newer. The plugin runs a Node worker with access to its host account. Approval covers private storage, encrypted secrets, workspace reading, and workspace navigation.

## Install

Run `orca plugin install zwbx/orca-nextcode@v0.1.0 --json`. Orca prints the exact approval required for the worker and workspace access. Approve that reviewed plugin using the command Orca returns.

## Connect

1. Prepare a private instance JSON file outside any public repository using your authorized NextCode API documentation. The supplied example uses a synthetic API contract.
2. Open the NextCode sidebar, enter the exact HTTPS origin and any SSH execution alias, and import the file using an absolute path on the Orca host.
3. Enter a credential or import a local credential file. Saving requires Orca to report `os-keyring` protection. The input field is cleared after submission. Remove temporary input files after import.
4. Select a project and item type. Select a row to open its original details, save a workspace association, or open that workspace.

The package provides configurable request and response mappings. Users provide their own authorized instance contract. Issue support requires an Issue mapping and corresponding read permission.

## Private instance configuration

Copy [examples/instance.example.json](examples/instance.example.json) to a private location and replace its synthetic fields. `origin` must be an HTTPS domain with no credentials or path. `auth` declares the credential header and prefix. Each operation defines a read-only GET or POST request, a same-origin path, optional query/body values, an item-array path and item field mappings.

Dot-separated paths address response objects. An empty path addresses the response root. Placeholders `$project`, `$cursor`, `$limit` and `$state` are substituted in body and query values. Whole-value placeholders retain their numeric type for page numbers and limits. Query values are URL-encoded. `$state` is `open`.

Cursor pagination uses a `next` response path and an optional boolean `hasMore` path. Page pagination uses `total` or a boolean `hasMore`, with `start` defaulting to 1. Configure API error paths, including source-policy message patterns, so HTTP and application-level failures appear correctly.

### Request execution host

If your instance requires a particular request environment, add `sshHost` with a trusted OpenSSH alias. That host needs Python 3 and trusted TLS certificates. SSH uses batch authentication and strict host-key verification. Request data and credentials travel through encrypted stdin to a single in-memory Python process. The remote process sends HTTPS requests directly. The plugin stores no remote credential files.

The HTTPS origin and SSH execution alias bind the saved credential. Changing either requires explicit credential configuration for that destination. Follow your instance’s official authentication and allowed-source requirements.

## Data handling

Instance configuration and workspace associations use plugin-private Orca storage. Credentials use Orca encrypted secrets. Requests stay on the confirmed origin and redirects are refused. Returned detail links must match that origin. Request errors display classified messages without raw server responses. The plugin has no telemetry and writes no service data to a repository.

Workspace associations live in this plugin’s storage. The selector shows the workspaces the current Orca Host API returns, including host labels. Paired-host visibility depends on the installed Orca runtime. Orca’s public plugin API exposes workspace selection and navigation. Native Tasks data-source registration is unavailable.

## Version 0.1.0 validation

MR list reading, pagination, status mapping, same-origin details links, encrypted credential storage and local workspace association were exercised against an authorized instance. Requests used a permitted SSH execution host.

Issue reading was exercised with synthetic fixtures. This release requires users to supply an authorized Issue API mapping. Real Issue permissions have yet to be verified.

Local workspace association was exercised with the desktop Host API. Paired-host selection was exercised with synthetic fixtures. The tested desktop runtime returned local workspaces, while its paired-host CLI returned additional remote workspaces. The plugin exposes the current Host API results and reports this scope in its interface.

Eight regression tests cover request failures, pagination, retry, same-origin restrictions, credential origin and SSH binding, OS keyring refusal, and serialized association writes. Six render scenarios cover fresh, populated, empty, authentication, permission and source-policy states.

## Development

Run `orca plugin types . --json`, `orca plugin validate . --json`, `orca plugin test . --json`, and `orca plugin check . --json`. Run `npx --yes -p typescript tsc -p .` for type checking. `orca plugin dev load . --json` prints the exact approval required to run the worker. Check scenarios and tests use synthetic data.

MIT licensed. Published independently by zwbx.
