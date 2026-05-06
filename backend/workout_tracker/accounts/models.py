# Auth piggybacks on django.contrib.auth.models.User; no extra models live
# here. UserSettings used to be persisted server-side but is now stored in
# the client's IndexedDB snapshot (frontend/lib/store/schema.ts). When cloud
# sync lands, settings will travel inside the snapshot blob, not as a
# separate row.
