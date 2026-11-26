# ELY-IDBox

Chrome and Microsoft Edge extension source, validation, and store-release automation.

## What the workflows do

- Pull requests and pushes to `main` check JavaScript syntax and create a clean ZIP containing only files referenced by the extension manifest.
- Pushing a version tag such as `v2.1` creates a GitHub Release with the installable ZIP.
- If store publishing is enabled and credentials are configured, the same tag also submits the package to the Chrome Web Store and/or Microsoft Edge Add-ons.

The package script uses a manifest-based file list. It does not include `Extracted data.csv`, CSV exports, or the local MRZ screenshot. These files are also excluded from Git by `.gitignore`.

## Automatic updates for installed users

Users must install the extension from the Chrome Web Store or Microsoft Edge Add-ons listing. Users who currently load an unpacked/local copy must switch to the store listing once; browser stores don't migrate those installs from a GitHub ZIP. The browser stores distribute updates to store-installed users after the store accepts and reviews a submission. Browser update checks run periodically, and the stores may take time to review a submission.

The first listing in each store must be created and published manually. The store APIs used by the workflow update an existing listing; they don't create a new listing.

Official update guidance: [Chrome extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle), [Chrome Web Store publishing API](https://developer.chrome.com/docs/webstore/using-api), [Microsoft Edge Add-ons publishing API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api).

## GitHub release setup

1. Create a GitHub repository and push this source to its `main` branch.
2. Keep the manifest version and release tag identical. The current version is `2.3`, so its release tag is `v2.3`.
3. Push a tag to run the release workflow:

   ```sh
   git tag v2.3
   git push origin v2.3
   ```

Each subsequent release needs a higher version in `manifest.json` and a matching `v<version>` tag.

## Store publishing configuration

The GitHub Release works without store credentials. Store publishing is enabled separately with repository Actions variables.

### Chrome Web Store

First create and publish the extension listing manually, then enable the Chrome Web Store API for that publisher. Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

Add these repository variables:

- `PUBLISH_CHROME` = `true`
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

The Google account used for the refresh token must own or have publisher access to the listing.

### Microsoft Edge Add-ons

First create and publish the listing in Partner Center, then enable the Edge Add-ons Update API. Use its current API-key experience and add these repository secrets:

- `EDGE_API_KEY`

Add these repository variables:

- `PUBLISH_EDGE` = `true`
- `EDGE_CLIENT_ID`
- `EDGE_PRODUCT_ID`

The workflow uploads the package, waits for processing, and submits the draft for store review.

## Local packaging

```sh
python scripts/package_extension.py --output dist/ely-idbox.zip
```

For a release build, include the exact tag so the script checks the version:

```sh
python scripts/package_extension.py --tag v2.3 --output dist/ely-idbox.zip
```
