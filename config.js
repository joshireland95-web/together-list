// =====================================================================
// The Together List — settings. This is the only file you need to edit.
// Find both Supabase values in: Supabase dashboard → Project Settings → API
// (the "anon"/"publishable" key is safe to put on a public website: the
// database security rules stop anyone who isn't on your list.)
// =====================================================================
window.APP_CONFIG = {
  APP_NAME: "The Together List",
  TAGLINE: "Things we want to do together",

  SUPABASE_URL: "https://etzttvzfwwmeliurmyvn.supabase.co",
  SUPABASE_KEY: "sb_publishable_Kxjb6UstCLW1qk2TgGJ10g_yoJ5pphB",

  // Turn on after you've deployed the calendar-feed function (README step 6)
  CALENDAR_FEED: false,

  TIMEZONE: "Pacific/Auckland",
  CURRENCY: "NZD",
  LOCALE: "en-NZ",
};
