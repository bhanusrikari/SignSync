# SignSync — Manual Test Plan

Run this after `npm run build` (from `extension/`) and loading `extension/dist/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked). This plan covers the behavior that automated tests cannot — see `docs/testing.md` for why. Fill in "Actual behavior" and check Pass/Fail as you go.

| # | Test | Expected behavior | Actual behavior | Pass/Fail |
|---|---|---|---|---|
| 1 | Install/reload extension | Loads with no console errors on `chrome://extensions`; icon appears in the toolbar | | [ ] |
| 2 | First-run onboarding | Opening the popup for the first time shows the Onboarding screen, not the Dashboard | | [ ] |
| 3 | Dashboard | Popup shows plain-language capability rows (captions, sign→text, sign→speech, my gestures, learn, languages, settings) with no technical jargon | | [ ] |
| 4 | Enable/disable | Main toggle switches between "Enable SignSync" and "SignSync is ON"; toggling visibly changes state everywhere (badge in header, overlay appears/disappears on a page) | | [ ] |
| 5 | Camera permission | First enabling Gesture Recognition opens `permission.html` if not previously granted; granting it returns control to the extension without a page reload | | [ ] |
| 5b | Language switching | Change the interface language in the popup between English/Hindi/Telugu; confirm Dashboard, Settings, Record, Validate, and Tutorials text all switch immediately (no leftover English or raw i18n keys like `dashboard.title`) | | [ ] |
| 5c | Overlay appearance/position | With SignSync enabled on any page, confirm the floating overlay appears, can be dragged to a new position, and that position is remembered after reloading the page | | [ ] |
| 6 | Live captions — English | With Captions on and English selected, speaking produces live, then final, transcript text in the overlay | | [ ] |
| 7 | Live captions — Hindi | Switch language to Hindi while captions are on; verify captions restart and attempt Hindi recognition (exact browser support varies — if unsupported, the friendly "aren't available for this language" message should appear, never a raw error) | | [ ] |
| 8 | Live captions — Telugu | Same as #7 for Telugu | | [ ] |
| 9 | Built-in gesture → text | Perform a built-in supported gesture (e.g. open palm) in front of the camera; the overlay shows recognized text | | [ ] |
| 10 | Built-in gesture → speech | With Speech Output on, the same gesture is spoken aloud | | [ ] |
| 11 | Record a personalized gesture | Open "My Gestures" → "+"; complete all 4 steps (name/meaning → camera → capture 5+ examples → review) and Save. Confirm the camera screen shows a dashed guide box over the video and short friendly tips ("keep your hand visible," "enough light," "inside the guide box") | | [ ] |
| 12 | Add a Hindi meaning | During Step 1, fill in the Hindi translation field; confirm it's listed in the Step 4 summary before saving | | [ ] |
| 13 | Add a Telugu meaning | Same as #12 for Telugu | | [ ] |
| 14 | Validate the gesture | Open "My Gestures" → "✓"; the new gesture appears with a strength bar, example count, and a "Translations: Hindi, Telugu" line | | [ ] |
| 15 | Personalized gesture → English text | With interface language set to English, perform the personalized gesture; overlay shows the English meaning | | [ ] |
| 16 | Personalized gesture → Hindi text | Switch interface language to Hindi; perform the same gesture again; overlay should show the HINDI meaning, not English | | [ ] |
| 17 | Personalized gesture → Telugu text | Same as #16 for Telugu | | [ ] |
| 18 | Personalized gesture → speech | With Speech Output on, confirm the gesture is spoken in the currently-resolved language (Hindi/Telugu voice if the browser has one, otherwise the browser's default TTS behavior for that language) | | [ ] |
| 19 | Conversation history | Perform a few gestures and speak a few final captions; confirm the overlay's Conversation panel lists all of them, newest first, each with the correct gesture/speech icon and a timestamp | | [ ] |
| 20 | Clear history | Click the clear button; confirm the panel empties immediately, and that current gesture/caption display (separate from history) is unaffected | | [ ] |
| 21 | Tutorials | Open the Learn Sign Language hub; confirm ISL is shown first, categories render with an honest "coming soon" empty state (no fabricated signs), and the "Learn verified signs" explanation is visible | | [ ] |
| 22 | Settings | Open Settings from the popup; confirm every toggle reflects and correctly updates the real state (round-trip: toggle off, reopen popup, confirm it stayed off) | | [ ] |
| 23 | Accessibility — enable all three | Turn on High Contrast, Larger Text, and Reduced Motion in Settings | | [ ] |
| 24 | High contrast — cross-page | With High Contrast on, open Record, Validate, and Tutorials in turn; confirm the contrast change is visible on all three, not just the popup | | [ ] |
| 25 | Large text — cross-page | Same check as #24 for Larger Text | | [ ] |
| 26 | Reduced motion — cross-page | Same check as #24 for Reduced Motion (no distracting transitions) | | [ ] |
| 27 | Error states | Deny camera permission once (via chrome://settings/content/camera), then try enabling Gesture Recognition; confirm a plain-language message appears (never "NotAllowedError" or a raw DOMException) | | [ ] |
| 28 | Disable/re-enable | Disable SignSync entirely, then re-enable; confirm the overlay, gesture display, and conversation history all start fresh (no stale data from before disabling) | | [ ] |
| 29 | Chrome reload | Fully close and reopen Chrome with the extension still enabled; confirm state (enabled/disabled, settings, saved personalized gestures) survives the restart | | [ ] |
| 30 | Final regression | Repeat test #9 (built-in gesture) and test #15 (personalized gesture) one more time after all other tests above — confirms nothing earlier broke basic recognition | | [ ] |

## Notes for the tester

- Tests 16–18 are the most important regression check for the personalized-gesture multilingual pipeline. If a personalized gesture still shows English text/speech after switching to Hindi/Telugu, that is the single highest-priority bug to report back.
- Tests 6–8's exact pass/fail depends on what languages your specific Chrome build's SpeechRecognition actually supports — a graceful "unavailable" message is a PASS for that language, not a failure, as long as it's the friendly message and not a raw error or a silently-stuck "Waiting for speech..." state.
- This plan exists because none of these behaviors can be verified without a real browser, camera, and microphone — see `docs/testing.md`.
