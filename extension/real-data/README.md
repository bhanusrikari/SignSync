# Real personalized-gesture data

This directory holds REAL, webcam-captured personalized gesture exports used by
`src/ai/personalizedGestureMatcher.realdata.test.ts` to validate the matcher
against actual MediaPipe landmarks instead of synthetic fixtures.

**Never committed** (see `.gitignore`) -- this is real, personally captured
hand geometry.

## How to produce `personalized-gestures.json`

1. Load the unpacked extension (`npm run build`, then load `extension/dist`
   in `chrome://extensions`).
2. Open the popup, click **"My Gestures" → "+"**, and record several distinct
   personalized gestures with 5+ examples each -- deliberately varying hand
   position, distance from the camera, rotation, and natural repetition
   between examples (e.g. `Fist`, `Fist_OppositeHand`, `OpenHand`, `ThumbOut`).
3. Once recorded, open DevTools on any extension page (the popup, `record.html`,
   or the background service worker's inspect view) and run:

   ```js
   chrome.storage.local.get("signSyncPersonalizedGestures").then((r) =>
     copy(JSON.stringify(r.signSyncPersonalizedGestures, null, 2)),
   );
   ```

   This copies the full stored array to your clipboard.
4. Paste the clipboard contents into `extension/real-data/personalized-gestures.json`
   in this repo (create the file with that exact name).
5. `npm test` automatically picks it up and runs the real-data validation
   suite; without this file, that suite skips cleanly rather than failing.
