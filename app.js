// The Together List — shared bucket list for a small group of friends.
// Plain JavaScript, no build step. Data lives in Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const C = window.APP_CONFIG;
const TZ = C.TIMEZONE || "Pacific/Auckland";
const LOCALE = C.LOCALE || "en-NZ";
const APP_URL = location.origin + location.pathname;

// ---------------------------------------------------------------------
// Data layer (Supabase). A test harness can swap in window.__TEST_API__.
// ---------------------------------------------------------------------
const PROFILE_COLS = "id, display_name, email, colour, email_reminders, created_at";

function makeSupabaseApi() {
  const sb = createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async getSession() { return ok(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session)); },
    async sendCode(email) {
      ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: APP_URL, shouldCreateUser: true } }));
    },
    async verifyCode(email, token) { return ok(await sb.auth.verifyOtp({ email, token, type: "email" })); },
    async signOut() { await sb.auth.signOut(); },
    async isMember() { return ok(await sb.rpc("is_member")); },
    async loadAll() {
      const [profiles, items, polls, votes, people, payments] = await Promise.all([
        sb.from("profiles").select(PROFILE_COLS).order("created_at"),
        sb.from("items").select("*"),
        sb.from("polls").select("*").order("created_at", { ascending: false }),
        sb.from("poll_votes").select("*"),
        sb.from("item_people").select("*"),
        sb.from("payments").select("*").order("paid_on"),
      ]).then((rs) => rs.map(ok));
      return { profiles, items, polls, votes, people, payments };
    },
    async saveProfile(p) { return ok(await sb.from("profiles").upsert(p).select(PROFILE_COLS).single()); },
    async saveItem(item) {
      if (item.id) {
        const { id, ...rest } = item;
        return ok(await sb.from("items").update(rest).eq("id", id).select().single());
      }
      return ok(await sb.from("items").insert(item).select().single());
    },
    async deleteItem(id) { ok(await sb.from("items").delete().eq("id", id)); },
    async setIn(itemId, userId, isIn) {
      if (isIn) ok(await sb.from("item_people").upsert({ item_id: itemId, user_id: userId }));
      else ok(await sb.from("item_people").delete().match({ item_id: itemId, user_id: userId }));
    },
    async setPeople(itemId, userIds) {
      ok(await sb.from("item_people").delete().eq("item_id", itemId));
      if (userIds.length) ok(await sb.from("item_people").insert(userIds.map((u) => ({ item_id: itemId, user_id: u }))));
    },
    async addPayment(p) { ok(await sb.from("payments").insert(p)); },
    async deletePayment(id) { ok(await sb.from("payments").delete().eq("id", id)); },
    async savePoll(poll) {
      if (poll.id) {
        const { id, ...rest } = poll;
        return ok(await sb.from("polls").update(rest).eq("id", id).select().single());
      }
      return ok(await sb.from("polls").insert(poll).select().single());
    },
    async deletePoll(id) { ok(await sb.from("polls").delete().eq("id", id)); },
    async vote(pollId, userId, vote) {
      if (vote === null) ok(await sb.from("poll_votes").delete().match({ poll_id: pollId, user_id: userId }));
      else ok(await sb.from("poll_votes").upsert({ poll_id: pollId, user_id: userId, vote, updated_at: new Date().toISOString() }));
    },
    async calendarToken() { return ok(await sb.rpc("my_calendar_token")); },
    async resetCalendarToken() { return ok(await sb.rpc("reset_calendar_token")); },
    subscribe(cb) {
      const ch = sb.channel("everything");
      for (const table of ["items", "polls", "poll_votes", "item_people", "payments"]) {
        ch.on("postgres_changes", { event: "*", schema: "public", table }, cb);
      }
      ch.subscribe();
    },
  };
}

const api = window.__TEST_API__ || makeSupabaseApi();

// ---------------------------------------------------------------------
// State + small helpers
// ---------------------------------------------------------------------
const S = {
  session: null, me: null, member: null, loaded: false,
  profiles: [], items: [], polls: [], votes: [], people: [], payments: [],
  filter: "upcoming", calMonth: null, calDay: null, loginEmail: "", codeSent: false,
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysUntil = (s) => Math.round((parseD(s) - parseD(todayStr())) / 86400000);
const money = (n) => new Intl.NumberFormat(LOCALE, { style: "currency", currency: C.CURRENCY || "NZD" }).format(Number(n) || 0);

function fmtDate(s, { long = false } = {}) {
  if (!s) return "";
  const d = parseD(s);
  const sameYear = d.getFullYear() === parseD(todayStr()).getFullYear();
  return d.toLocaleDateString(LOCALE, {
    weekday: "short", day: "numeric", month: long ? "long" : "short", ...(sameYear ? {} : { year: "numeric" }),
  });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
}
function whenText(item) {
  if (!item.start_date) return "";
  let s = fmtDate(item.start_date);
  if (item.start_time) s += `, ${fmtTime(item.start_time)}`;
  if (item.end_date && item.end_date !== item.start_date) s += ` – ${fmtDate(item.end_date)}`;
  return s;
}
function relDays(s) {
  const n = daysUntil(s);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

const profile = (id) => S.profiles.find((p) => p.id === id);
const nameOf = (id) => (id === S.me?.id ? "You" : profile(id)?.display_name || "Someone");
function avatar(id, { size = "", dim = false } = {}) {
  const p = profile(id);
  const n = p?.display_name || "?";
  return `<span class="av ${size} ${dim ? "dim" : ""}" style="--c:${esc(p?.colour || "#888")}" title="${esc(n)}">${esc(n[0].toUpperCase())}</span>`;
}
const peopleIn = (itemId) => S.people.filter((x) => x.item_id === itemId).map((x) => x.user_id);
const paymentsFor = (itemId) => S.payments.filter((x) => x.item_id === itemId);
const votesFor = (pollId) => S.votes.filter((v) => v.poll_id === pollId);

const STATUSES = [
  ["idea", "Idea"], ["planning", "Planning"], ["booked", "Booked"], ["done", "Done"],
];
const statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || [s, s])[1];
const CATEGORIES = ["Outdoors", "Food & drink", "Day trip", "Weekend away", "Creative", "Wellness", "Event", "At home"];
const COLOURS = ["#3d9a6a", "#f2775a", "#f0b43c", "#5b93dd", "#a98be0", "#ee6b8f", "#2fb3a8", "#8c7b6b"];

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    console.error(e);
    toast(e?.message || "Something went wrong", 4000);
  }
}

// ---------------------------------------------------------------------
// Loading + live sync
// ---------------------------------------------------------------------
async function reload() {
  const data = await api.loadAll();
  Object.assign(S, data, { loaded: true });
  S.me = S.profiles.find((p) => p.id === S.session?.user?.id) || null;
  safeRender();
}
let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reload().catch(console.error), 250);
}
let pendingRender = false;
function safeRender() {
  const a = document.activeElement;
  if (a && $("#app").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { pendingRender = true; return; }
  render();
}
document.addEventListener("focusout", () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.member) scheduleReload(); });

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, id] = h.split("/");
  return { view: view || "list", id };
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function render() {
  const app = $("#app");
  document.title = C.APP_NAME;
  if (!S.session) { app.innerHTML = loginView(); $("#nav").hidden = true; return; }
  if (S.member === null || (S.member && !S.loaded)) { app.innerHTML = `<div class="center muted">Loading…</div>`; return; }
  if (!S.member) { app.innerHTML = notMemberView(); $("#nav").hidden = true; return; }
  if (!S.me) { app.innerHTML = setupView(); $("#nav").hidden = true; return; }

  const r = route();
  $("#nav").hidden = false;
  let html;
  if (r.view === "item") html = itemView(r.id);
  else if (r.view === "polls") html = pollsView();
  else if (r.view === "calendar") html = calendarView();
  else if (r.view === "me") html = meView();
  else html = listView();
  app.innerHTML = html;
  renderNav(r.view);
  if (r.view === "me") loadCalendarLink();
}

function renderNav(view) {
  const unvoted = S.polls.filter((p) => p.status === "open" && !S.votes.some((v) => v.poll_id === p.id && v.user_id === S.me.id)).length;
  const tab = (key, label, icon, badge = 0) => `
    <a href="#/${key === "list" ? "" : key}" class="${view === key || (key === "list" && view === "item") ? "on" : ""}">
      <span class="ico">${icon}</span><span>${label}</span>${badge ? `<b class="badge">${badge}</b>` : ""}
    </a>`;
  $("#nav").innerHTML =
    tab("list", "Our list", ICONS.list) + tab("polls", "Polls", ICONS.poll, unvoted) +
    tab("calendar", "Calendar", ICONS.cal) + tab("me", "Me", ICONS.me);
}

const ICONS = {
  list: `<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
  poll: `<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  cal: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  me: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`,
};

// ----- Auth screens --------------------------------------------------
function loginView() {
  return `
  <div class="login">
    <div class="blanket"></div>
    <h1>${esc(C.APP_NAME)}</h1>
    <p class="muted">${esc(C.TAGLINE || "")}</p>
    ${S.codeSent ? `
      <form data-form="code" class="stack">
        <p>We've emailed a code to <b>${esc(S.loginEmail)}</b>. Type it here, or just tap the link in the email.</p>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" required pattern="[0-9]{6,10}" />
        <button class="btn primary">Sign in</button>
        <button type="button" class="btn link" data-action="change-email">Use a different email</button>
      </form>` : `
      <form data-form="email" class="stack">
        <input name="email" type="email" autocomplete="email" placeholder="Your email" required value="${esc(S.loginEmail)}" />
        <button class="btn primary">Send me a sign-in code</button>
      </form>`}
  </div>`;
}
const notMemberView = () => `
  <div class="login"><h1>Not on the list (yet)</h1>
  <p>${esc(S.session.user.email)} isn't one of the invited emails. Ask whoever set this up to add you.</p>
  <button class="btn" data-action="sign-out">Sign out</button></div>`;
const setupView = () => `
  <div class="login">
    <h1>Kia ora!</h1>
    <form data-form="setup" class="stack">
      <label>What should everyone call you?<input name="display_name" required maxlength="40" /></label>
      <div class="swatches">${COLOURS.map((c, i) => `<label><input type="radio" name="colour" value="${c}" ${i === 0 ? "checked" : ""}><span style="--c:${c}"></span></label>`).join("")}</div>
      <button class="btn primary">Let's go</button>
    </form>
  </div>`;

// ----- List ----------------------------------------------------------
function sortItems(list) {
  return [...list].sort((a, b) => {
    if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date) || (a.start_time || "").localeCompare(b.start_time || "");
    if (a.start_date) return -1;
    if (b.start_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}
function listView() {
  const today = todayStr();
  const filters = [
    ["upcoming", "Upcoming", (i) => i.status !== "done"],
    ["idea", "Ideas", (i) => i.status === "idea"],
    ["planned", "Planned", (i) => i.status === "planning" || i.status === "booked"],
    ["done", "Done", (i) => i.status === "done"],
  ];
  const f = filters.find((x) => x[0] === S.filter) || filters[0];
  let items = sortItems(S.items.filter(f[2]));
  if (S.filter === "done") items = items.reverse();
  const doneCount = S.items.filter((i) => i.status === "done").length;

  const needsAttention = S.items.filter((i) =>
    i.status !== "done" && (
      (i.booking_needed && i.status !== "booked" && i.book_by && i.book_by >= today && daysUntil(i.book_by) <= 7) ||
      (i.payment_due && i.payment_due >= today && daysUntil(i.payment_due) <= 7)));

  return `
  <header class="top"><div class="blanket"></div>
    <h1>${esc(C.APP_NAME)}</h1>
    <p class="muted">${S.items.length} things · ${doneCount} done together</p>
  </header>
  ${needsAttention.length ? `<div class="notice">⏰ ${needsAttention.map((i) => `<a href="#/item/${i.id}">${esc(i.title)}</a>`).join(", ")} — booking or payment due soon</div>` : ""}
  <div class="chips">${filters.map(([k, l]) => `<button class="chip ${S.filter === k ? "on" : ""}" data-action="filter" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="cards">${items.length ? items.map(itemCard).join("") : `<p class="empty">Nothing here yet. Tap + to add the first thing.</p>`}</div>
  <button class="fab" data-action="new-item" aria-label="Add item">${ICONS.plus}</button>`;
}
function itemCard(i) {
  const ins = peopleIn(i.id);
  const flags = [];
  if (i.booking_needed && i.status !== "booked" && i.status !== "done") flags.push(i.book_by ? `Book by ${fmtDate(i.book_by)}` : "Needs booking");
  return `
  <a class="card s-${i.status}" href="#/item/${i.id}">
    <div class="row between"><span class="pill s-${i.status}">${statusLabel(i.status)}</span>
      ${i.start_date ? `<span class="when">${esc(whenText(i))}</span>` : ""}</div>
    <h3>${esc(i.title)}</h3>
    <div class="meta">${[i.category, i.location, i.est_cost ? money(i.est_cost) + (i.cost_basis === "person" ? " pp" : "") : ""].filter(Boolean).map(esc).join(" · ")}</div>
    ${flags.length ? `<div class="flag">${flags.map(esc).join(" · ")}</div>` : ""}
    <div class="row between foot">
      <span class="muted small">Added by ${esc(nameOf(i.created_by))}</span>
      <span class="avs">${ins.map((u) => avatar(u, { size: "sm" })).join("")}</span>
    </div>
  </a>`;
}

// ----- Item detail ---------------------------------------------------
function itemView(id) {
  const i = S.items.find((x) => x.id === id);
  if (!i) return `<div class="center"><p>That item's gone — maybe someone deleted it.</p><a class="btn" href="#/">Back to the list</a></div>`;
  const ins = peopleIn(i.id);
  const pays = paymentsFor(i.id);
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const heads = ins.length || S.profiles.length;
  const estTotal = i.est_cost ? (i.cost_basis === "person" ? i.est_cost * heads : Number(i.est_cost)) : null;
  const poll = i.poll_id && S.polls.find((p) => p.id === i.poll_id);

  return `
  <div class="detail">
    <div class="row between"><a class="iconbtn" href="#/">${ICONS.back}</a>
      <div class="row gap"><button class="btn sm" data-action="edit-item" data-id="${i.id}">Edit</button></div></div>
    <h1>${esc(i.title)}</h1>
    <div class="seg">${STATUSES.map(([k, l]) => `<button class="${i.status === k ? "on s-" + k : ""}" data-action="set-status" data-id="${i.id}" data-v="${k}">${l}</button>`).join("")}</div>
    ${i.description ? `<p class="desc">${esc(i.description).replace(/\n/g, "<br>")}</p>` : ""}

    <dl class="facts">
      ${i.start_date ? `<dt>When</dt><dd>${esc(whenText(i))} <span class="muted">(${relDays(i.start_date)})</span></dd>` : `<dt>When</dt><dd class="muted">Not set yet</dd>`}
      ${i.location ? `<dt>Where</dt><dd>${esc(i.location)}</dd>` : ""}
      ${i.category ? `<dt>Type</dt><dd>${esc(i.category)}</dd>` : ""}
      ${i.link ? `<dt>Link</dt><dd><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.link.replace(/^https?:\/\//, "").slice(0, 40))}</a></dd>` : ""}
      <dt>Added</dt><dd>${esc(nameOf(i.created_by))}${poll ? ` · <a href="#/polls">from a poll</a>` : ""}</dd>
    </dl>

    <section><h2>Who's in</h2>
      <div class="people">${S.profiles.map((p) => {
        const on = ins.includes(p.id);
        return `<button class="person ${on ? "on" : ""}" data-action="toggle-in" data-id="${i.id}" data-u="${p.id}">${avatar(p.id, { dim: !on })}<span>${esc(p.id === S.me.id ? "Me" : p.display_name)}</span></button>`;
      }).join("")}</div>
    </section>

    ${(i.booking_needed || i.book_by || i.booking_ref || i.booking_url || i.payment_due) ? `
    <section><h2>Booking</h2>
      <dl class="facts">
        <dt>Status</dt><dd>${i.status === "booked" || i.status === "done" ? "✅ Booked" : i.booking_needed ? "Not booked yet" : "No booking needed"}</dd>
        ${i.book_by ? `<dt>Book by</dt><dd>${fmtDate(i.book_by)} <span class="muted">(${relDays(i.book_by)})</span></dd>` : ""}
        ${i.booking_ref ? `<dt>Reference</dt><dd><code>${esc(i.booking_ref)}</code></dd>` : ""}
        ${i.booking_url ? `<dt>Booking</dt><dd><a href="${esc(i.booking_url)}" target="_blank" rel="noopener">Open booking</a></dd>` : ""}
        ${i.payment_due ? `<dt>Payment due</dt><dd>${fmtDate(i.payment_due)} <span class="muted">(${relDays(i.payment_due)})</span></dd>` : ""}
      </dl>
    </section>` : ""}

    <section><h2>Money</h2>
      ${estTotal != null ? `<p>Estimated ${money(estTotal)}${heads ? ` · about ${money(estTotal / heads)} each for ${heads}` : ""}</p>` : `<p class="muted">No cost estimate.</p>`}
      ${pays.length ? `
        <ul class="pays">${pays.map((p) => `
          <li>${avatar(p.paid_by, { size: "sm" })}<div><b>${esc(nameOf(p.paid_by))}</b> paid ${money(p.amount)}${p.note ? ` <span class="muted">· ${esc(p.note)}</span>` : ""}<div class="muted small">${fmtDate(p.paid_on)}</div></div>
          <button class="x" data-action="del-payment" data-id="${p.id}" aria-label="Remove payment">×</button></li>`).join("")}
        </ul>
        <p class="small">Paid so far: <b>${money(paid)}</b></p>
        ${settleUp(pays, ins.length ? ins : S.profiles.map((p) => p.id))}` : ""}
      <button class="btn sm" data-action="add-payment" data-id="${i.id}">+ Record a payment</button>
    </section>

    <section><h2>Share &amp; remember</h2>
      <div class="row wrap gap">
        ${i.start_date ? `<button class="btn sm" data-action="ics" data-id="${i.id}">📅 Add to phone calendar</button>
        <a class="btn sm" href="${googleCalUrl(i)}" target="_blank" rel="noopener">Google Calendar</a>` : ""}
        <button class="btn sm" data-action="share" data-id="${i.id}">Share…</button>
        ${isMobile() ? `<a class="btn sm messenger" href="fb-messenger://share/?link=${encodeURIComponent(itemUrl(i.id))}">Messenger</a>` : ""}
      </div>
      ${i.start_date ? `<p class="muted small">The calendar event comes with reminders a week before and the day before.</p>` : ""}
    </section>

    <button class="btn danger link" data-action="del-item" data-id="${i.id}">Delete this item</button>
  </div>`;
}

// Who owes whom, splitting what's been paid evenly between the people who are in
function settleUp(pays, participants) {
  if (!participants.length) return "";
  const total = pays.reduce((s, p) => s + Number(p.amount), 0);
  const share = total / participants.length;
  const bal = {};
  participants.forEach((u) => (bal[u] = -share));
  pays.forEach((p) => (bal[p.paid_by] = (bal[p.paid_by] ?? 0) + Number(p.amount)));
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.005).map(([u, v]) => [u, -v]).sort((a, b) => b[1] - a[1]);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  const lines = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amt = Math.min(debtors[di][1], creditors[ci][1]);
    lines.push(`${esc(nameOf(debtors[di][0]))} → ${esc(nameOf(creditors[ci][0]))}: <b>${money(amt)}</b>`);
    debtors[di][1] -= amt; creditors[ci][1] -= amt;
    if (debtors[di][1] < 0.005) di++;
    if (creditors[ci][1] < 0.005) ci++;
  }
  return `<div class="settle"><div class="small muted">Split evenly between ${participants.length} (${money(share)} each). To square up:</div>
    ${lines.length ? lines.map((l) => `<div>${l}</div>`).join("") : `<div>All square 🎉</div>`}</div>`;
}

// ----- Polls ---------------------------------------------------------
function pollsView() {
  const open = S.polls.filter((p) => p.status === "open");
  const past = S.polls.filter((p) => p.status !== "open");
  return `
  <header class="top slim"><h1>Polls</h1><p class="muted">Suggest something and see who's keen.</p></header>
  <div class="cards">${open.length ? open.map(pollCard).join("") : `<p class="empty">No open polls. Tap + to ask the group.</p>`}</div>
  ${past.length ? `<details class="past"><summary>Closed polls (${past.length})</summary><div class="cards">${past.map(pollCard).join("")}</div></details>` : ""}
  <button class="fab" data-action="new-poll" aria-label="New poll">${ICONS.plus}</button>`;
}
function pollCard(p) {
  const vs = votesFor(p.id);
  const yes = vs.filter((v) => v.vote).map((v) => v.user_id);
  const no = vs.filter((v) => !v.vote).map((v) => v.user_id);
  const waiting = S.profiles.filter((m) => !vs.some((v) => v.user_id === m.id)).map((m) => m.id);
  const mine = vs.find((v) => v.user_id === S.me.id);
  const isOpen = p.status === "open";
  return `
  <div class="card poll ${isOpen ? "" : "closed"}">
    <div class="row between"><span class="muted small">${esc(nameOf(p.created_by))} asks…</span>
      ${p.closes_on && isOpen ? `<span class="small muted">Closes ${fmtDate(p.closes_on)}</span>` : ""}
      ${p.status === "converted" ? `<span class="pill s-planning">On the list</span>` : p.status === "closed" ? `<span class="pill">Closed</span>` : ""}</div>
    <h3>${esc(p.title)}</h3>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
    <div class="meta">${[p.proposed_date ? fmtDate(p.proposed_date) : "", p.est_cost ? "~" + money(p.est_cost) : ""].filter(Boolean).join(" · ")}</div>
    ${isOpen ? `<div class="vote">
      <button class="yes ${mine?.vote === true ? "on" : ""}" data-action="vote" data-id="${p.id}" data-v="yes">👍 I'm keen</button>
      <button class="no ${mine?.vote === false ? "on" : ""}" data-action="vote" data-id="${p.id}" data-v="no">Not for me</button>
    </div>` : ""}
    <div class="tally">
      <div><b>${yes.length}</b> keen ${yes.map((u) => avatar(u, { size: "sm" })).join("")}</div>
      <div><b>${no.length}</b> not ${no.map((u) => avatar(u, { size: "sm" })).join("")}</div>
      ${isOpen && waiting.length ? `<div class="muted small">Waiting on ${waiting.map((u) => esc(nameOf(u))).join(", ")}</div>` : ""}
    </div>
    <div class="row wrap gap actions">
      ${p.status === "converted" && p.item_id ? `<a class="btn sm" href="#/item/${p.item_id}">See item →</a>` : ""}
      ${p.status !== "converted" ? `<button class="btn sm primary" data-action="convert-poll" data-id="${p.id}">Make it an item</button>` : ""}
      ${isOpen ? `<button class="btn sm" data-action="share-poll" data-id="${p.id}">Share</button>` : ""}
      ${p.status === "open" ? `<button class="btn sm link" data-action="close-poll" data-id="${p.id}">Close</button>` : ""}
      ${p.status === "closed" ? `<button class="btn sm link" data-action="reopen-poll" data-id="${p.id}">Reopen</button>` : ""}
      <button class="btn sm link danger" data-action="del-poll" data-id="${p.id}">Delete</button>
    </div>
  </div>`;
}

// ----- Calendar ------------------------------------------------------
function calendarView() {
  const today = todayStr();
  if (!S.calMonth) S.calMonth = today.slice(0, 7);
  if (!S.calDay) S.calDay = today;
  const [y, m] = S.calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m, 0).getDate();
  const dated = S.items.filter((i) => i.start_date);
  const on = (day) => dated.filter((i) => day >= i.start_date && day <= (i.end_date || i.start_date));
  const deadlines = (day) => S.items.filter((i) => i.status !== "done" &&
    ((i.book_by === day && i.booking_needed && i.status !== "booked") || i.payment_due === day));

  let cells = "";
  for (let k = 0; k < offset; k++) cells += `<div class="cell pad"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${S.calMonth}-${String(d).padStart(2, "0")}`;
    const evs = on(day);
    const dl = deadlines(day).length;
    cells += `<button class="cell ${day === today ? "today" : ""} ${day === S.calDay ? "sel" : ""}" data-action="cal-day" data-v="${day}">
      <span class="n">${d}</span>
      <span class="evs">${evs.slice(0, 2).map((i) => `<span class="ev s-${i.status}">${esc(i.title)}</span>`).join("")}${evs.length > 2 ? `<span class="more">+${evs.length - 2}</span>` : ""}</span>
      <span class="dots">${evs.map((i) => `<i class="s-${i.status}"></i>`).join("")}${dl ? `<i class="dl"></i>` : ""}</span>
    </button>`;
  }
  const dayItems = on(S.calDay);
  const dayDeadlines = deadlines(S.calDay);
  const upcoming = sortItems(dated.filter((i) => (i.end_date || i.start_date) >= today && i.status !== "done")).slice(0, 5);
  const unscheduled = S.items.filter((i) => !i.start_date && i.status !== "done").length;

  return `
  <header class="top slim"><h1>Calendar</h1></header>
  <div class="cal">
    <div class="row between calhead">
      <button class="iconbtn" data-action="cal-prev" aria-label="Previous month">‹</button>
      <h2>${first.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}</h2>
      <button class="iconbtn" data-action="cal-next" aria-label="Next month">›</button>
    </div>
    <div class="grid dow">${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div>${d}</div>`).join("")}</div>
    <div class="grid">${cells}</div>
  </div>
  <section class="dayview">
    <h2>${fmtDate(S.calDay, { long: true })}</h2>
    ${dayItems.length ? `<div class="cards">${dayItems.map(itemCard).join("")}</div>` : `<p class="muted">Nothing planned. <button class="btn link" data-action="new-item" data-date="${S.calDay}">Plan something for this day</button></p>`}
    ${dayDeadlines.map((i) => `<div class="notice small">⏰ ${i.payment_due === S.calDay ? "Payment due" : "Book by today"}: <a href="#/item/${i.id}">${esc(i.title)}</a></div>`).join("")}
  </section>
  <section><h2>Coming up</h2>
    ${upcoming.length ? upcoming.map((i) => `<a class="line" href="#/item/${i.id}"><span>${esc(i.title)}</span><span class="muted">${esc(whenText(i))}</span></a>`).join("") : `<p class="muted">Nothing dated yet.</p>`}
    ${unscheduled ? `<p class="muted small">${unscheduled} more on the list without a date.</p>` : ""}
  </section>
  <button class="fab" data-action="new-item" data-date="${S.calDay}" aria-label="Add item">${ICONS.plus}</button>`;
}

// ----- Me ------------------------------------------------------------
function meView() {
  const me = S.me;
  return `
  <header class="top slim"><h1>Me</h1></header>
  <section>
    <form data-form="profile" class="stack">
      <label>Name<input name="display_name" value="${esc(me.display_name)}" required maxlength="40" /></label>
      <div class="swatches">${COLOURS.map((c) => `<label><input type="radio" name="colour" value="${c}" ${me.colour === c ? "checked" : ""}><span style="--c:${c}"></span></label>`).join("")}</div>
      <label class="check"><input type="checkbox" name="email_reminders" ${me.email_reminders ? "checked" : ""}/> Email me reminders a week and a day before things I'm in</label>
      <button class="btn primary">Save</button>
    </form>
  </section>
  ${C.CALENDAR_FEED ? `
  <section><h2>Sync with your phone calendar</h2>
    <p class="small">Subscribe once and everything with a date shows up in your calendar, updating as plans change. This link is private to you.</p>
    <div id="calfeed" class="stack"><span class="muted small">Loading your link…</span></div>
  </section>` : ""}
  <section><h2>Put it on your home screen</h2>
    <p class="small"><b>iPhone:</b> open this page in Safari → Share → <i>Add to Home Screen</i>.<br>
    <b>Android:</b> Chrome menu ⋮ → <i>Add to Home screen</i>.</p>
  </section>
  <section><h2>The crew</h2>
    <div class="people">${S.profiles.map((p) => `<span class="person on">${avatar(p.id)}<span>${esc(p.display_name)}</span></span>`).join("")}</div>
  </section>
  <p class="muted small">Signed in as ${esc(S.session.user.email)}</p>
  <button class="btn" data-action="sign-out">Sign out</button>`;
}
async function loadCalendarLink() {
  const box = $("#calfeed");
  if (!box) return;
  try {
    const token = await api.calendarToken();
    const https = `${C.SUPABASE_URL}/functions/v1/calendar-feed?token=${token}`;
    const webcal = https.replace(/^https:/, "webcal:");
    box.innerHTML = `
      <a class="btn primary" href="${esc(webcal)}">Subscribe (iPhone / Mac)</a>
      <button class="btn" data-action="copy" data-v="${esc(https)}">Copy link (for Google Calendar)</button>
      <p class="muted small">Google: on a computer, open calendar.google.com → Other calendars → + → <i>From URL</i> → paste. Google can take up to a day to pick up changes.</p>
      <button class="btn link small" data-action="reset-cal">Link leaked? Make a new one</button>`;
  } catch (e) {
    box.innerHTML = `<span class="muted small">Couldn't load the calendar link (${esc(e.message)}).</span>`;
  }
}

// ---------------------------------------------------------------------
// Modals (forms)
// ---------------------------------------------------------------------
function openModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.classList.add("noscroll");
  setTimeout(() => m.querySelector("input:not([type=hidden]),textarea")?.focus(), 50);
}
function closeModal() {
  const m = $("#modal");
  m.hidden = true;
  m.innerHTML = "";
  document.body.classList.remove("noscroll");
}

function itemForm(i = {}, extra = {}) {
  const v = (k) => esc(i[k] ?? "");
  openModal(`
  <form data-form="item" class="stack">
    <div class="row between"><h2>${i.id ? "Edit" : "Add to the list"}</h2><button type="button" class="iconbtn" data-action="close">×</button></div>
    <input type="hidden" name="id" value="${v("id")}" />
    <input type="hidden" name="poll_id" value="${esc(extra.poll_id || i.poll_id || "")}" />
    <label>What's the plan?<input name="title" required maxlength="140" value="${v("title")}" placeholder="Proper picnic with woolen blankets" /></label>
    <label>Details<textarea name="description" rows="3" placeholder="Ideas, what to bring, anything useful">${v("description")}</textarea></label>
    <div class="two">
      <label>Type<input name="category" list="cats" value="${v("category")}" /></label>
      <label>Status<select name="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${(i.status || "idea") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <datalist id="cats">${CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <label>Where<input name="location" value="${v("location")}" /></label>
    <fieldset><legend>When</legend>
      <div class="two">
        <label>Date<input type="date" name="start_date" value="${v("start_date")}" /></label>
        <label>Time<input type="time" name="start_time" value="${esc((i.start_time || "").slice(0, 5))}" /></label>
      </div>
      <label>Ends (if it's more than one day)<input type="date" name="end_date" value="${v("end_date")}" /></label>
    </fieldset>
    <fieldset><legend>Cost</legend>
      <div class="two">
        <label>Estimate (${esc(C.CURRENCY)})<input type="number" name="est_cost" min="0" step="0.01" inputmode="decimal" value="${v("est_cost")}" /></label>
        <label>That's<select name="cost_basis"><option value="total">in total</option><option value="person" ${i.cost_basis === "person" ? "selected" : ""}>per person</option></select></label>
      </div>
    </fieldset>
    <fieldset><legend>Booking &amp; payment</legend>
      <label class="check"><input type="checkbox" name="booking_needed" ${i.booking_needed ? "checked" : ""}/> Needs booking</label>
      <div class="two">
        <label>Book by<input type="date" name="book_by" value="${v("book_by")}" /></label>
        <label>Payment due<input type="date" name="payment_due" value="${v("payment_due")}" /></label>
      </div>
      <label>Booking reference<input name="booking_ref" value="${v("booking_ref")}" /></label>
      <label>Booking link<input type="url" name="booking_url" value="${v("booking_url")}" placeholder="https://" /></label>
    </fieldset>
    <label>Website / inspiration link<input type="url" name="link" value="${v("link")}" placeholder="https://" /></label>
    <button class="btn primary">${i.id ? "Save changes" : "Add it"}</button>
  </form>`);
}

function paymentForm(itemId) {
  openModal(`
  <form data-form="payment" class="stack">
    <div class="row between"><h2>Record a payment</h2><button type="button" class="iconbtn" data-action="close">×</button></div>
    <input type="hidden" name="item_id" value="${esc(itemId)}" />
    <label>Who paid?<select name="paid_by">${S.profiles.map((p) => `<option value="${p.id}" ${p.id === S.me.id ? "selected" : ""}>${esc(p.display_name)}</option>`).join("")}</select></label>
    <div class="two">
      <label>Amount<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required /></label>
      <label>Date<input type="date" name="paid_on" value="${todayStr()}" /></label>
    </div>
    <label>What for?<input name="note" placeholder="Deposit, petrol, snacks…" /></label>
    <button class="btn primary">Save payment</button>
  </form>`);
}

function pollForm() {
  openModal(`
  <form data-form="poll" class="stack">
    <div class="row between"><h2>Ask the group</h2><button type="button" class="iconbtn" data-action="close">×</button></div>
    <label>Who's keen to…<input name="title" required maxlength="140" placeholder="Go to the lavender farm" /></label>
    <label>More detail<textarea name="description" rows="3"></textarea></label>
    <div class="two">
      <label>Possible date<input type="date" name="proposed_date" /></label>
      <label>Rough cost<input type="number" name="est_cost" min="0" step="0.01" inputmode="decimal" /></label>
    </div>
    <label>Voting closes<input type="date" name="closes_on" /></label>
    <button class="btn primary">Post poll</button>
  </form>`);
}

function confirmModal(text, action, id) {
  openModal(`<div class="stack"><p>${esc(text)}</p>
    <div class="row gap"><button class="btn danger" data-action="${action}" data-id="${esc(id)}">Yes, delete</button>
    <button class="btn" data-action="close">Cancel</button></div></div>`);
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());
const nullIfEmpty = (o) => { for (const k in o) if (o[k] === "") o[k] = null; return o; };

// ---------------------------------------------------------------------
// Calendar files, Google links and sharing
// ---------------------------------------------------------------------
const itemUrl = (id) => `${APP_URL}#/item/${id}`;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (s) => s.replace(/[-:]/g, "");

function eventTimes(i) {
  if (i.start_time) {
    const start = `${compact(i.start_date)}T${compact(i.start_time.slice(0, 5))}00`;
    let end;
    if (i.end_date && i.end_date !== i.start_date) end = `${compact(i.end_date)}T${compact(i.start_time.slice(0, 5))}00`;
    else {
      const [h, m] = i.start_time.split(":").map(Number);
      const d = new Date(2000, 0, 1, h + 2, m);
      end = d.getDate() === 1
        ? `${compact(i.start_date)}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`
        : `${compact(i.start_date)}T235900`;
    }
    return { allDay: false, start, end };
  }
  return { allDay: true, start: compact(i.start_date), end: compact(addDays(i.end_date || i.start_date, 1)) };
}
function icsFor(i) {
  const t = eventTimes(i);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const desc = [i.description, i.booking_ref ? `Booking ref: ${i.booking_ref}` : "", itemUrl(i.id)].filter(Boolean).join("\n\n");
  // For all-day events, alarms count back from midnight, so -PT15H = 9am the day before.
  const alarms = t.allDay ? ["-P6DT15H", "-PT15H"] : ["-P7D", "-P1D"];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Together List//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${i.id}@together-list`, `DTSTAMP:${stamp}`,
    t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART;TZID=${TZ}:${t.start}`,
    t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND;TZID=${TZ}:${t.end}`,
    `SUMMARY:${icsEsc(i.title)}`, `DESCRIPTION:${icsEsc(desc)}`,
    i.location ? `LOCATION:${icsEsc(i.location)}` : "",
    `URL:${itemUrl(i.id)}`,
    ...alarms.flatMap((a) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(i.title)}`, `TRIGGER:${a}`, "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}
function downloadIcs(i) {
  const blob = new Blob([icsFor(i)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${i.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function googleCalUrl(i) {
  const t = eventTimes(i);
  const p = new URLSearchParams({
    action: "TEMPLATE", text: i.title, dates: `${t.start}/${t.end}`, ctz: TZ,
    details: [i.description, itemUrl(i.id)].filter(Boolean).join("\n\n"), location: i.location || "",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  await copyText(`${text}\n${url}`);
  toast("Link copied — paste it into Messenger");
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = s; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
}

// ---------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) {
    if (e.target.id === "modal") closeModal();
    return;
  }
  const { action, id, v } = el.dataset;
  const item = id && S.items.find((x) => x.id === id);
  const poll = id && S.polls.find((x) => x.id === id);

  switch (action) {
    case "close": closeModal(); break;
    case "filter": S.filter = v; render(); break;
    case "new-item": itemForm(el.dataset.date ? { start_date: el.dataset.date } : {}); break;
    case "edit-item": itemForm(item); break;
    case "set-status": run(async () => {
      await api.saveItem({ id, status: v, completed_at: v === "done" ? new Date().toISOString() : null });
      await reload();
    }, v === "done" ? "Done! 🎉" : null); break;
    case "toggle-in": run(async () => {
      await api.setIn(id, el.dataset.u, !peopleIn(id).includes(el.dataset.u));
      await reload();
    }); break;
    case "add-payment": paymentForm(id); break;
    case "del-payment": run(async () => { await api.deletePayment(id); await reload(); }, "Payment removed"); break;
    case "del-item": confirmModal(`Delete "${item.title}"? This can't be undone.`, "del-item-yes", id); break;
    case "del-item-yes": run(async () => { closeModal(); await api.deleteItem(id); location.hash = "#/"; await reload(); }, "Deleted"); break;
    case "ics": downloadIcs(item); break;
    case "share": shareLink({
      title: item.title,
      text: `${item.title}${item.start_date ? ` — ${whenText(item)}` : ""}`,
      url: itemUrl(item.id),
    }); break;
    case "share-poll": shareLink({ title: poll.title, text: `Who's keen? ${poll.title}`, url: `${APP_URL}#/polls` }); break;
    case "new-poll": pollForm(); break;
    case "vote": run(async () => {
      const want = v === "yes";
      const mine = S.votes.find((x) => x.poll_id === id && x.user_id === S.me.id);
      await api.vote(id, S.me.id, mine && mine.vote === want ? null : want);
      await reload();
    }); break;
    case "convert-poll": itemForm({
      title: poll.title, description: poll.description, start_date: poll.proposed_date,
      est_cost: poll.est_cost, status: "planning",
    }, { poll_id: poll.id }); break;
    case "close-poll": run(async () => { await api.savePoll({ id, status: "closed" }); await reload(); }); break;
    case "reopen-poll": run(async () => { await api.savePoll({ id, status: "open" }); await reload(); }); break;
    case "del-poll": confirmModal(`Delete the poll "${poll.title}"?`, "del-poll-yes", id); break;
    case "del-poll-yes": run(async () => { closeModal(); await api.deletePoll(id); await reload(); }, "Poll deleted"); break;
    case "cal-prev": case "cal-next": {
      const [y, m] = S.calMonth.split("-").map(Number);
      const d = new Date(y, m - 1 + (action === "cal-next" ? 1 : -1), 1);
      S.calMonth = ymd(d).slice(0, 7);
      render(); break;
    }
    case "cal-day": S.calDay = v; render(); break;
    case "copy": copyText(v).then(() => toast("Copied")); break;
    case "reset-cal": run(async () => { await api.resetCalendarToken(); await loadCalendarLink(); }, "New link made — re-subscribe with it"); break;
    case "change-email": S.codeSent = false; render(); break;
    case "sign-out": run(async () => { await api.signOut(); }); break;
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector("button:not([type=button])");
  if (btn) btn.disabled = true;
  const done = () => { if (btn) btn.disabled = false; };
  const d = formData(form);

  switch (form.dataset.form) {
    case "email": run(async () => {
      S.loginEmail = d.email.trim().toLowerCase();
      await api.sendCode(S.loginEmail);
      S.codeSent = true; render();
    }).finally(done); break;
    case "code": run(async () => { await api.verifyCode(S.loginEmail, d.code.trim()); }).finally(done); break;
    case "setup": case "profile": run(async () => {
      S.me = await api.saveProfile({
        id: S.session.user.id, email: S.session.user.email,
        display_name: d.display_name.trim(), colour: d.colour || COLOURS[0],
        ...(form.dataset.form === "profile" ? { email_reminders: !!d.email_reminders } : {}),
      });
      await reload();
    }, form.dataset.form === "profile" ? "Saved" : null).finally(done); break;
    case "item": run(async () => {
      const pollId = d.poll_id || null;
      const row = nullIfEmpty({ ...d });
      row.booking_needed = !!d.booking_needed;
      if (row.end_date && row.start_date && row.end_date < row.start_date) row.end_date = null;
      if (!row.id) delete row.id;
      if (row.status === "done" && !row.completed_at) row.completed_at = new Date().toISOString();
      const saved = await api.saveItem(row);
      if (pollId && !d.id) {
        // Converted from a poll: everyone who voted yes is "in"
        const yes = votesFor(pollId).filter((x) => x.vote).map((x) => x.user_id);
        await api.setPeople(saved.id, yes);
        await api.savePoll({ id: pollId, status: "converted", item_id: saved.id });
      } else if (!d.id) {
        await api.setIn(saved.id, S.me.id, true);
      }
      closeModal();
      await reload();
      if (!d.id) location.hash = `#/item/${saved.id}`;
    }, d.id ? "Saved" : "Added to the list").finally(done); break;
    case "payment": run(async () => {
      await api.addPayment({ item_id: d.item_id, paid_by: d.paid_by, amount: Number(d.amount), note: d.note || null, paid_on: d.paid_on || todayStr() });
      closeModal(); await reload();
    }, "Payment recorded").finally(done); break;
    case "poll": run(async () => {
      const p = await api.savePoll(nullIfEmpty({ ...d }));
      await api.vote(p.id, S.me.id, true); // you're presumably keen on your own idea
      closeModal(); await reload();
    }, "Poll posted").finally(done); break;
  }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

// ---------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------
async function onSession(session) {
  const changed = session?.user?.id !== S.session?.user?.id;
  S.session = session;
  if (!session) {
    Object.assign(S, { member: null, me: null, loaded: false, codeSent: false });
    render(); return;
  }
  if (!changed && (S.member !== null || checking)) return;
  checking = true;
  S.member = null; render();
  try {
    S.member = await api.isMember();
    if (S.member) {
      await reload();
      if (!subscribed) { api.subscribe(scheduleReload); subscribed = true; }
    } else render();
  } catch (e) {
    console.error(e);
    toast(e.message || "Couldn't connect", 5000);
  } finally {
    checking = false;
  }
}
let subscribed = false;
let checking = false;

(async function start() {
  if (C.SUPABASE_URL.includes("YOUR-PROJECT") && !window.__TEST_API__) {
    $("#app").innerHTML = `<div class="login"><h1>Almost there</h1><p>Open <code>config.js</code> and paste in your Supabase URL and key (see README step 4).</p></div>`;
    return;
  }
  api.onAuth((s) => onSession(s));
  await onSession(await api.getSession());
})();
