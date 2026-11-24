# Encrypted family tree

A family-tree viewer and owner editor for GitHub Pages. The complete diagram supports pointer-centred wheel zoom, drag-to-pan, touch gestures, keyboard controls, branch navigation, name search and person-detail dialogs.

## Owner editing

Open the tree with the family code, then choose **Owner editing**. Connect using a fine-grained GitHub personal access token belonging to `rueffy-git`, limited to this repository with **Contents: Read and write**. The setup link and steps appear in the connection dialog. Keep the token in a password manager; do not share it with family members or paste it into chat. It stays in memory for the editing session and is cleared on Finish editing, Lock tree, navigation or reload. No token is included in source, browser storage, URLs, commit messages or backups.

GitHub checks write access on every save. A separate family code only decrypts the records; it grants no publishing rights. The client additionally requires the immutable owner ID `198278663` and repository ID `1469793768`. These checks improve the interface but are not the security boundary: GitHub's repository permissions are. Do not add other repository collaborators if editing must remain owner-only. Someone who can read the tree can always alter a downloaded copy, but cannot replace the shared tree without repository write access.

Use **Add person**, or select someone and choose **Edit this person**. Names, other names, recorded sex, dates, events, descriptions, labels and personal notes are editable. Use **Family connections** to add or remove partners/parents, link existing children, change the relationship description or reorder children. One known parent is sufficient. Removing a connection keeps its people; removing a person removes their links. All changes remain in a draft until **Review and publish**. Undo and Redo apply to the current draft. Closing or reloading loses an unpublished draft, with a browser warning; **Private backup** downloads an encrypted copy that **Open backup** can restore.

Publishing verifies the existing family code, encrypts the records in the browser and updates only `docs/tree.enc.json`. It checks the current GitHub file version and uses GitHub's conditional update to prevent overwriting another change. Failed and uncertain writes preserve the draft; a lost response triggers a read check, never an automatic repeated write. Names and notes are not placed in Git commit messages. The existing code and printed cards continue working. The page reports when GitHub has saved the file and when Pages serves the new version.

The existing arrangement is retained for ordinary additions. Valid complex connections use the locally bundled ELK layout engine, with each person shown once and family junctions marked by dots. Impossible ancestry loops, missing people, repeated links, overlapping cards and lines through cards are rejected before publishing. ELK is distributed under its EPL-2.0 option; its licence, pinned version and package integrity are in `docs/vendor/`.

Once browser editing is used, the online encrypted records are the current source. Edits do not update the older Gramps database. Before any work from a local export, fetch the latest repository and merge all online changes; the local Gramps publisher refuses to overwrite a payload marked with online edits.

## Privacy

Only `docs/` is published. It contains generic HTML, CSS and JavaScript plus `tree.enc.json`, an encrypted payload. No readable family records, original scans, private configuration, access codes or browser test captures belong in this repository, its issues, its logs or its commit history. Tests use synthetic records.

The payload uses AES-256-GCM, a fresh 16-byte salt and 12-byte IV, and PBKDF2-HMAC-SHA256 with 600,000 iterations. A 12-character code is generated locally with Node's cryptographic random generator. It uses letters and digits, excludes I, L, O, 0 and 1, and is printed in three groups of four. Upper/lower case, spaces and hyphens are equivalent. The new code format uses envelope version 2; version 1 retains the previous passphrase rules for older releases. The browser derives a non-exportable key and decrypts the payload in memory. Reloading or pressing **Lock tree** clears the displayed records. No access code or decrypted records are written to browser storage. All data is rendered as text, never inserted as HTML.

This is shared-secret encryption, not individual account authentication. Anyone with the access code can view or copy the records. Old encrypted releases remain in Git history; changing an access code cannot revoke previously saved data. The HTML and application code are public. The host and repository maintainers must remain trusted because they can change the code delivered to visitors. `noindex` is only a search-engine request, not an access-control mechanism.

## Local development

Requires Node.js 20+ and Python 3.10+. No package installation is required. The pinned layout library is served locally; there are no externally loaded fonts, scripts or analytics.

```text
npm test
npm run serve
```

Open the printed localhost address. The local server serves only `docs/` and uses the same `/family-tree/` path as the live site. Stop it with Ctrl+C when finished.

## Updating records

1. Update the private Gramps tree. Export a native `.gramps` backup outside this repository.
2. Keep the private layout configuration and access JSON outside this repository. The layout configuration contains `focusFamily` (the central Gramps family ID) and `updated` (the publication date, `YYYY-MM-DD`). The access file contains the existing `code` and `version: 2`. Keep it private and backed up separately.
3. Run the local publisher. It rejects source, configuration and access files inside this repository.

```text
node scripts/publish.mjs --source <private-export.gramps> --config <private-layout.json> --access <private-access.json>
```

If the access file does not yet exist, the publisher generates a code and creates it. Use `--rotate-code yes` only to change an existing code; the previous access record is retained privately for recovery. The code is not passed as a command argument or printed. A readable access-details file, a printable sheet of six access cards and a build-verification record are saved next to the private access file. Family data is passed from the Python importer to Node in memory and encrypted before it is written to `docs/`.

4. Run tests and review the entire diagram, the changed records and the privacy scan before committing. Verify the deployed encrypted payload matches the local file.
5. Commit only generic site files and the encrypted payload. Push to `main`.

The importer preserves stable Gramps IDs, recorded events, notes, citations, sources and explicit family links. Unknown surnames, missing parents and uncertain dates are not inferred. It stops on unsupported record fields or complex family connections that need a layout update. The layout checker rejects overlapping boxes, connectors through boxes and crossings between unrelated family connectors.

## Hosting

GitHub Pages publishes `main` → `/docs`. Do not add a custom domain or change the account's existing user-site repository. Project-site URLs inherit the account's current Pages domain. The empty `.nojekyll` file preserves ordinary static publishing.

The public interface is a static HTML page plus a versioned encrypted JSON envelope (`version`, `algorithm`, `kdf`, `iterations`, `salt`, `iv`, `ciphertext`). There is no custom server or public write endpoint. Owner publishing uses GitHub's authenticated Contents API directly over HTTPS.

## Validation and recovery

Unit tests cover encryption, incorrect codes, tampering, fresh random values, shared ancestry, parent-only links, unplaced records, complex layouts, record validation, copied shared notes, undo, owner identity checks, concurrent saves and lost responses. `node tests/ui-server.mjs` serves synthetic browser fixtures on port 4174 with an in-memory GitHub substitute. It never contacts GitHub, never serves real records and is outside the published directory. Fixtures prove application behaviour, not a live authenticated save. Before release, test the actual site on desktop and phone sizes and confirm that locking/reloading removes the family data and private editing connection.

References: [GitHub file updates](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents), [fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [ELK](https://github.com/kieler/elkjs).

If a release fails, restore a previous working code-and-ciphertext commit. Keep the matching access code privately. Never upload a plaintext export as a recovery shortcut.
