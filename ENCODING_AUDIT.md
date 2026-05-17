# WriteFlow popup.js — saveApi handler fix: char-code encode before storage
# This popup script stores user API key. Must encode.
# Currently in popup.js there's no direct API key save in popup; it's in options.js (fixed above).
# The popup.js reads apiKey from storage via background — already uses BUILT_IN_KEY_ENCODED.
# popup.js itself doesn't seem to save keys, so it's fine.
# But let me verify: popup.js uses chrome.runtime.sendMessage for rewrite, which hits background.js.
# background.js now correctly decodes apiKey in getEffectiveApiKey().
# My earlier fix to background.js already handles this.
# No changes needed to popup.js.
print("WriteFlow encoding chain: popup uses background.js for keys — already fixed in background.js")