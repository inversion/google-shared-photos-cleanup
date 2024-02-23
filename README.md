# google-shared-photos-cleanup

Organize Google Photos originating from shared albums and WhatsApp. It processes a Google Takeout and adds all media (photos & videos) that are saved to your Photos feed from Partner Sharing and WhatsApp to new albums. You can then review the albums and delete the photos if everything looks good.

NB: Adding Photos to albums alone does not remove them from your main feed.

NB: Partner photos could probably be deleted more easily by just removing the partner. I'm not aware of an easier way to organize WhatsApp photos though.

## How this tool works

1. Traverses a Photos Takeout (code in `takeout.ts`), building a list of files which come from Partner sharing or WhatsApp respectively.
1. Using the Photos API (`photosApi.ts`), creates albums called `Cleanup - Partner Photos` and `Cleanup - WhatsApp Photos`.
1. Fetches the Takeout private item URLs and parses the redirect targets to get the media item IDs for the Takeout items, caching to a sqlite database `links.sqlite`.
    - Cookies are loaded from a Firefox profile.
1. Uses the Photos UI API (`photosWebApi.ts`) to add the items that aren't already in these albums respectively.
    - The lists of existing items in the albums are fetched with the Photos API.

*NB*: This tool is pretty flaky due to opaque rate-limits on the Photos UI API. You'll probably need to re-run it several times - it should be idempotent.

### Why are you using Takeout, Google Photos API *and* the Photos UI API?!

The official Google Photos API is not very useful:
- API 'apps' can only add photos created by the app to albums, so you can't use the API to organize an existing set of photos.
- There is no access to the partner sharing / WhatsApp source metadata.
- The 'Media Item' IDs it exposes are not included or readily mappable to the Takeout image URLs/identifiers.

So we use a Frankenstein combination of the Google Photos API, the undocumented & obfuscated Photos UI API, and Takeout data.

NB: It might be possible to cut Takeout out of the process if the Photos UI API has the relevant info - I'm not sure if it does or not.

## How to use

### Requirements

- Google account
- Firefox install logged into that Google account (for filling the cookie jar in `photosWebApi.ts`).
    - The script could be adapted to use hardcoded cookies or another source.

### Checkout
1. `git clone https://github.com/inversion/google-shared-photos-cleanup`
1. `cd google-shared-photos-cleanup`

### Takeout download
1. Generate a [Google Takeout](https://takeout.google.com/) - you can select 'Google Photos' only to save time generating it. I used `tgz` with 50GB segments.
1. Download the `tgz` files to the current directory.
1. Extract the metadata JSON from all of them: `for file in *.tgz; do tar -zxvf "$file" --wildcards --no-anchored '*/*.json'; done`
   - Extracting only the JSON saves time and disk space, but this might take a long time anyway - about 15-20 minutes with my ~150GB library.
1. There should now be a 'Takeout' directory in the current directory.

### Google Photos API setup
1. Create a project at console.cloud.google.com
1. Activate the 'Photos Library API' from the search box.
1. Hit 'Create Credentials'
1. Select 'User data'.
1. 'Add or Remove Scopes'
1. Select `auth/photoslibrary` and `auth/photoslibrary.sharing`.
1. Application type 'Desktop App'
1. Download the client secret JSON and save it as `client_secret.json` in the current directory.

### Configure & run the tool
1. `cp .env{.example,}`
1. Open `.env`:
    1. Open photos.google.com with the logged-in Firefox.
    1. Set `WIZ_*` values in .env (based on https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c):
        1. Open Firefox dev tools.
        1. `copy(window.WIZ_global_data.FdrFJe)` -> WIZ_SID
        1. `copy(window.WIZ_global_data.SNlM0e)` -> WIZ_AT
    1. Set `FIREFOX_COOKIES_DB_PATH` to your real profile's path.
1. `npm install`
1. `npm run main`
1. (First-run only) Follow the OAuth instructions to generate auth credentials for your Photos API app, which will be saved to `oauth_tokens.json`.
1. Watch the output and re-run it if it fails. You will probably need to update WIZ_SID and WIZ_AT if it starts consistently failing.

## References/Credits

- https://webapps.stackexchange.com/a/172517 ([jjspierx](https://webapps.stackexchange.com/users/318072/jjspierx))
- https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c
- https://stackoverflow.com/questions/70616324/what-is-mediaitemid-in-google-photos-api
- https://github.com/wong2/batchexecute
 