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

Open RunningHub signed in **in the browser running the code**. If address-bar
paste becomes a search or loses the scheme, save the copied URL as a bookmark
or favorite and invoke it on the signed-in RunningHub tab. A browser that
forbids JavaScript URLs, or a page policy blocking them, can still prevent the
exporter from starting; this change does not weaken browser settings or CSP.

Validation uses synthetic session fixtures, denied storage/clipboard access,
and actual JavaScript-URL navigation in Chromium, Firefox, Microsoft Edge and
WebKit at mobile and desktop widths. These engine tests do not claim physical
Android/iOS app or address-bar coverage.
