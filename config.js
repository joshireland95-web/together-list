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
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0enR0dnpmd3dtZWxpdXJteXZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzMjI1NzUsImV4cCI6MjExMDg5ODU3NX0.JDUSOYqiT4nOFHCElkNMnpymZ7dhQ17kNSERqwx0lLM",

  // Turn on after you've deployed the calendar-feed function (README step 6)
  CALENDAR_FEED: false,

  TIMEZONE: "Pacific/Auckland",
  CURRENCY: "NZD",
  LOCALE: "en-NZ",
};
