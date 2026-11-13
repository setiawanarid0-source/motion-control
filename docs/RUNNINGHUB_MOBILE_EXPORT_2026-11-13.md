# RunningHub session popup on mobile browsers

The Account Pool button still exports the same four fields: access token,
refresh token, upload identity and upload authorization. Export remains local
to the RunningHub page and makes no request. Backend refresh and imports stay
unchanged.

The copied `javascript:` URL now encodes its source so URL delimiters and
whitespace survive address-bar and bookmark handling. The exported function
uses older JavaScript and DOM syntax. Storage objects and cookie access have
independent exception guards. A dialog can attach to the document root when
the body is unavailable, with a native prompt as the last local DOM fallback.

The dialog offers Copy and Select All; failed clipboard permission leaves the
token visible for native selection. Closing or replacing it clears the old
field and ignores pending clipboard callbacks. Vanta also exposes the code in
a visible manual field when its own clipboard operation fails.

Open RunningHub signed in **in the browser running the code**. On browsers
that allow JavaScript URLs, a bookmark can preserve a scheme that address-bar
paste strips. This does **not** solve Edge mobile's native "Cannot Run Script"
dialog. The user's screenshot confirms rejection before the exporter starts.
Desktop Edge tests were insufficient evidence for the mobile address bar.

## Edge Android: explicit extension channel

The Account Pool now links to the official Tampermonkey installation page and
`public/vanta-runninghub-session.user.js` on raw GitHub. Installing the
extension and script is a one-time user action. It is not installed or granted
permissions by Vanta or by these changes.

After installation, reload the signed-in RunningHub tab and tap **Salin sesi ke
Vanta**. Only that tap reads the session. The same canonical exporter opens the
same local popup; copy its JSON into Vanta's existing import field. The script
does not fetch, upload, auto-copy, write storage, auto-update or share cookies
across browsers. It cannot renew a session rejected by RunningHub.

The script matches only the two HTTPS RunningHub origins, refuses subframes
and unrelated origins, and requests Tampermonkey's DOM sandbox without GM
privileges. It needs no page globals or injected inline script. Existing
bookmarklet support and the backend import/refresh protocol remain unchanged.
Rebuild it with `node scripts/build-rh-session-userscript.mjs` after any exporter
change; the unit test rejects drift from the canonical function.

Primary references:

- https://www.tampermonkey.net/faq.php?q=Q406 (official Edge Android availability)
- https://www.tampermonkey.net/documentation.php?q=sandbox (DOM isolation)
- https://www.tampermonkey.net/documentation.php?q=grant (omitting grants retains isolation)
- https://playwright.dev/docs/chrome-extensions (isolated extension test harness)

No browser protection or page CSP is disabled. This route is scoped to Edge
Android with Tampermonkey; it is not a claim of Edge iOS compatibility.

Validation uses synthetic session fixtures, denied storage/clipboard access,
and actual JavaScript-URL navigation in Chromium, Firefox, Microsoft Edge and
WebKit at mobile and desktop widths. These engine tests do not claim physical
Android/iOS app or address-bar coverage.

The extension test loads the actual userscript through an isolated MV3 content
script against synthetic RH pages with `script-src 'none'`, at the same three
viewport widths. It checks the launcher, four-field export, rotated refresh
token, manual selection, clearing/reopening and absence of export requests.
It tests the extension execution context, **not Tampermonkey's installer or a
physical Edge Android app**. Device confirmation remains outstanding.
