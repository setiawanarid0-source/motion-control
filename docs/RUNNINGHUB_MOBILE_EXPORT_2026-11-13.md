# RunningHub session export through bookmarks

The user runs the code from a saved bookmark/favorite on a signed-in RunningHub
page. This is the intended route; it does not require an extension. The Edge
screenshot reports "Cannot Run Script". It does not establish that the user
pasted the code into the address bar.

The earlier extension detour has been removed from Account Pool, along with its
installer, generated userscript and isolated-extension test. Desktop extension
or link tests did not verify the user's requested mobile bookmark route.

## Existing exporter

The self-contained ES5 function remains unchanged. It exports only access,
refresh, identify and comfyAuth, plus the site marker, into a local popup and
makes no request. The latest stored refresh token takes precedence over an old
cookie. Storage/cookie denial guards, manual selection, clipboard fallbacks
and clearing on dismissal remain supported. Backend token import, encrypted
storage and renewal are unchanged.

Save the complete copied JavaScript URL, including `javascript:`, as the URL of
a bookmark. Open RunningHub signed in in the same browser and invoke the saved
bookmark on that tab. Code encoding preserves URL delimiters; encoding is not
claimed to solve Edge's execution refusal.

## Minimal bookmark diagnostic

Account Pool now exposes a separate, optional diagnostic bookmark URL:

    javascript:void(alert('VANTA bookmark berjalan'))

It only displays that message, reads no credentials and sends no requests. Save
it as a separate bookmark and invoke it on the same RunningHub tab through the
same bookmark UI that failed for the exporter.

- A displayed message confirms JavaScript execution through that bookmark path
  on that page. The exporter still needs investigation if it fails.
- The same native refusal with this minimal code narrows the problem to the
  execution path/browser/page policy before this test executes. It is not
  evidence of an invalid access token or a failed clipboard permission.

The device result is pending. Do not claim that Edge mobile is fixed, that every
Edge version rejects bookmarks, or that a desktop browser with a narrow viewport
verifies an Android/iOS app. Do not change browser protection settings or CSP.

Primary references checked:

- https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/javascript
- https://github.com/liriliri/eruda/issues/497 (original Android Edge bug report;
  reporter observations, not a current Microsoft support guarantee)

## Validation

Unit tests cover the unchanged export format, browser storage/clipboard denial,
clearing/reopening, and the diagnostic's no-session-read behavior. Browser CI
exercises actual `javascript:` links and visible manual code selection in
Chromium, Firefox, desktop Edge and WebKit at 320/430/1280px. It does not exercise
the native Favorites UI or a physical phone. A user device diagnostic is required
to distinguish the current reported bookmark failure.
