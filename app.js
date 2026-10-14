"use strict";
const { html, render, useState, useEffect, useReducer, useRef } = htmPreact;
const { PROGRAM, MEALS, TOPUPS, FOODS, HABITS, ALIAS } = window.DATA;

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEK = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const BIG_JUMP = /squat|deadlift|leg press|romanian/i;
// Name -> program row, so any logged exercise can find its rep range, rest and muscle.
const EX = {}; Object.values(PROGRAM).forEach((d) => d.ex.forEach((e) => { EX[e[0]] = e; }));
Object.values(PROGRAM).forEach((d) => d.ex.forEach((e) => { if (e[7] && !EX[e[7]]) EX[e[7]] = [e[7], ...e.slice(1,7), e[0]]; }));

/* ================= helpers ================= */
const pad = (n) => String(n).padStart(2,"0");
const key = (d) => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); // local date, never UTC
const parseKey = (k) => { const [y,m,d] = k.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const c = new Date(d); c.setDate(c.getDate()+n); return c; };
const today = () => key(new Date());
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r1 = (n) => Math.round(n*10)/10;
const fmt = (n) => String(r1(n));
const round25 = (n) => Math.round(n/2.5)*2.5;
const epley = (w,r) => w*(1+r/30);
const short = (k) => parseKey(k).toLocaleDateString(undefined,{day:"numeric",month:"short"});
const longDate = (k) => parseKey(k).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };
const dayName = (k) => DAYS[parseKey(k).getDay()];
const repRange = (s) => { const m = String(s).match(/(\d+)(?:-(\d+))?/); return m ? [+m[1], +(m[2]||m[1])] : [8,12]; };
const restSec = (s) => { const m = String(s).match(/(\d+)(?:-(\d+))?\s*(min|sec)/); if (!m) return 90; const v = m[2] ? +m[2] : +m[1]; return m[3] === "min" ? v*60 : v; };
const mondayOf = (d) => addDays(d, d.getDay() === 0 ? -6 : 1-d.getDay());

/* ================= storage ================= */
const LS = "standard-v1";
function blank(){ return {v:4, days:{}, food:{}, water:{}, bw:[], lifts:[], custom:[], set:{p:100, k:2000, w:8}}; }
// v1/v2 kept habits as d:[4 flags]; v3 keys them by habit id. The old score is kept so past streaks still count.
const OLD_ORDER = ["deep","workout","read","steps"];
function migrateDay(d){
  if (!d || d.h) return d;
  const h = {}; (d.d || []).forEach((v,i) => { if (v && OLD_ORDER[i]) h[OLD_ORDER[i]] = 1; });
  const old = (d.d || []).reduce((s,v) => s + (v ? (d.m === "bare" ? .5 : 1) : 0), 0);
  return {m: d.m === "bare" ? "bare" : "full", h, old};
}
function renameOld(D){ D.lifts.forEach((s) => s.exercises.forEach((e) => { if (ALIAS[e.name]) e.name = ALIAS[e.name]; })); }
function norm(d){
  const b = blank();
  if (!d || typeof d !== "object") return b;
  for (const k in b) if (d[k] == null || typeof d[k] !== typeof b[k] || Array.isArray(d[k]) !== Array.isArray(b[k])) d[k] = b[k];
  d.set = Object.assign(b.set, d.set);
  for (const k in d.days) d.days[k] = migrateDay(d.days[k]);
  // v2 menu entries had slots from a generated menu; keep them as plain extras.
  const slots = new Set(MEALS.map((m) => m[0]));
  for (const k in d.food) d.food[k].forEach((f) => { if (f.slot && !slots.has(f.slot)) delete f.slot; });
  renameOld(d);
  if (d.v < 4) { if (d.set.k === 2700) d.set.k = 2000; if (d.set.p === 150) d.set.p = 100; } // v4: bulk -> cut
  d.v = 4;
  return d;
}
function addBw(D, date, kg, keep){
  kg = num(kg); if (!date || !kg) return;
  const e = D.bw.find((x) => x.date === date);
  if (e) { if (!keep) e.kg = kg; } else D.bw.push({date, kg});
  D.bw.sort((a,b) => a.date < b.date ? -1 : 1);
}
// Folds an export from WrkTrack, Fitness Tracker or Daily Standard into D.
function absorb(D, o){
  if (!o || typeof o !== "object") return "";
  const got = [];
  if (Array.isArray(o.history)) {
    o.history.forEach((s) => { if (s && Array.isArray(s.exercises) && !D.lifts.some((x) => x.date === s.date && x.day === s.day)) D.lifts.push(s); });
    (o.bodyweight || []).forEach((b) => addBw(D, b.date, b.kg, true));
    got.push(o.history.length+" workouts");
  }
  if (o.meals && typeof o.meals === "object") {
    (o.weights || []).forEach((w) => addBw(D, w.date, w.weight, true));
    let n = 0;
    for (const dk in o.meals) {
      if (D.food[dk] && D.food[dk].length) continue;
      const items = [];
      MEALS.forEach(([id, , , opts]) => { const s = o.meals[dk][id]; if (s && s.checked) { const v = opts[s.variantIdx||0] || opts[0]; items.push({n:v[0], p:v[1], k:v[2], q:1, slot:id}); } });
      if (items.length) { D.food[dk] = items; n++; }
    }
    for (const dk in (o.water || {})) if (D.water[dk] == null) D.water[dk] = o.water[dk];
    got.push(n+" food days");
  }
  if (o.days && typeof o.days === "object" && !o.lifts) {
    let n = 0;
    for (const dk in o.days) if (!D.days[dk] && o.days[dk] && Array.isArray(o.days[dk].d)) { D.days[dk] = migrateDay(o.days[dk]); n++; }
    got.push(n+" habit days");
  }
  renameOld(D);
  D.lifts.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts||0)-(b.ts||0));
  return got.join(", ");
}
function load(){
  let raw = null;
  try { raw = localStorage.getItem(LS); } catch(e){}
  if (raw) {
    // Once a day keep yesterday's copy, so a bad update can be rolled back from Settings.
    try { const day = today(); if (localStorage.getItem(LS+"-snapdate") !== day) { localStorage.setItem(LS+"-snap", raw); localStorage.setItem(LS+"-snapdate", day); } } catch(e){}
    try { return norm(JSON.parse(raw)); }
    catch(e){ try { localStorage.setItem(LS+"-broken-"+Date.now(), raw); } catch(_){} } // never overwrite data we could not read
  }
  const D = blank();
  ["daily-standard-v1","wtrack_v1","ft-v2"].forEach((k) => { try { absorb(D, JSON.parse(localStorage.getItem(k))); } catch(e){} });
  return D;
}
let DB = load();
let saveOk = true;
function save(){ try { localStorage.setItem(LS, JSON.stringify(DB)); saveOk = true; } catch(e){ saveOk = false; } syncSoon(); }

/* ================= sync ================= */
// Offline first: every save also goes to data.json in a private GitHub repo once online.
// The token lives in its own key, never inside DB, so exports never carry it.
// ponytail: last write wins, fine for one phone; merge if a second device ever logs too.
// ponytail: the contents API returns inline content up to 1 MB (about a year of logs); switch pullSync to the raw media type past that.
const SYNC_REPO = "ContentAid/standard-data", SK = "standard-sync";
let sync = {}; try { sync = JSON.parse(localStorage.getItem(SK)) || {}; } catch(e){}
const saveSync = () => { try { localStorage.setItem(SK, JSON.stringify(sync)); } catch(e){} };
let syncT = 0, syncing = false;
function syncSoon(){ if (!sync.token) return; clearTimeout(syncT); syncT = setTimeout(pushSync, 4000); }
const gh = (method, body) => fetch(`https://api.github.com/repos/${SYNC_REPO}/contents/data.json`, {method, cache:"no-store",
  headers:{Authorization:"Bearer "+sync.token, Accept:"application/vnd.github+json"}, body: body && JSON.stringify(body)});
const b64 = (str) => { const b = new TextEncoder().encode(str); let o = ""; for (let i = 0; i < b.length; i += 8192) o += String.fromCharCode(...b.subarray(i, i+8192)); return btoa(o); };
const unb64 = (x) => new TextDecoder().decode(Uint8Array.from(atob(x.replace(/\n/g,"")), (c) => c.charCodeAt(0)));
async function pushSync(retry){
  if (!sync.token || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    if (!sync.sha) { const r = await gh("GET"); if (r.ok) sync.sha = (await r.json()).sha; else if (r.status !== 404) throw r.status; }
    const r = await gh("PUT", {message:"sync "+new Date().toISOString(), content:b64(JSON.stringify(DB, null, 1)), sha:sync.sha});
    if ((r.status === 409 || r.status === 422) && !retry) { sync.sha = null; syncing = false; return pushSync(true); }
    if (!r.ok) throw r.status;
    sync.sha = (await r.json()).content.sha; sync.at = Date.now(); sync.err = "";
  } catch(e){ sync.err = e === 401 ? "Token rejected" : "Not synced yet (" + (typeof e === "number" ? e : "offline") + ")"; }
  syncing = false; saveSync(); rerender();
}
async function pullSync(){
  const r = await gh("GET"); if (!r.ok) throw r.status;
  const j = await r.json(); sync.sha = j.sha; saveSync();
  return JSON.parse(unb64(j.content));
}
addEventListener("online", () => syncSoon());
save();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}

/* ================= food ================= */
const foodList = (k) => DB.food[k] || [];
const totals = (k) => foodList(k).reduce((t,f) => (t.k += f.k*f.q, t.p += f.p*f.q, t), {k:0, p:0});
const eaten = (k, slot) => foodList(k).find((f) => f.slot === slot);
// Tapping the dish already logged for a slot removes it; tapping another one replaces it.
function pickMeal(slot, opt){
  const k = today(), list = DB.food[k] || (DB.food[k] = []), cur = eaten(k, slot);
  if (cur) list.splice(list.indexOf(cur), 1);
  if (!cur || cur.n !== opt[0]) list.push({n:opt[0], p:opt[1], k:opt[2], q:1, slot});
  save();
}
function addExtra(f){
  const k = today(), list = DB.food[k] || (DB.food[k] = []);
  const e = list.find((x) => x.n === f.n && !x.slot);
  if (e) e.q += 1; else list.push({n:f.n, u:f.u||"", p:f.p, k:f.k, q:1});
  save();
}
function recentExtras(){
  const c = {}, last = {};
  for (let i = 0; i < 21; i++) foodList(key(addDays(new Date(),-i))).forEach((f) => { if (f.slot) return; c[f.n] = (c[f.n]||0)+1; last[f.n] = last[f.n] || f; });
  return Object.keys(c).sort((a,b) => c[b]-c[a]).slice(0,6).map((n) => last[n]);
}
function slotOpts(slot, opts){
  for (let i = 1; i < 21; i++) { const f = eaten(key(addDays(new Date(),-i)), slot); if (f) { const o = opts.find((x) => x[0] === f.n); if (o) return [o, ...opts.filter((x) => x !== o)]; } }
  return opts;
}
// Expected protein by now: linear from 07:00 to 22:00.
function proteinPace(){ const n = new Date(), h = n.getHours() + n.getMinutes()/60; return DB.set.p * Math.max(0, Math.min(1, (h-7)/15)); }

/* ================= training ================= */
const isDone = (x) => x.done && (num(x.w) > 0 || num(x.r) > 0);
const setTxt = (x) => num(x.w) ? `${fmt(num(x.w))} × ${num(x.r)}` : `${num(x.r)} reps`; // bodyweight sets have no weight
function lastPerf(name, exclude){
  for (let i = DB.lifts.length-1; i >= 0; i--) {
    const s = DB.lifts[i]; if (s === exclude) continue;
    const ex = s.exercises.find((e) => e.name === name);
    if (ex) { const sets = ex.sets.filter(isDone); if (sets.length) return {date:s.date, sets, deload:s.deload}; }
  }
  return null;
}
const sessionBest = (e) => e.sets.reduce((b,x) => isDone(x) && num(x.w) ? Math.max(b, epley(num(x.w), num(x.r))) : b, 0);
function bestE1(name){ let b = 0; DB.lifts.forEach((s) => s.exercises.forEach((e) => { if (e.name === name) b = Math.max(b, sessionBest(e)); })); return b; }
function e1History(name){
  return DB.lifts.map((s) => { const e = s.exercises.find((x) => x.name === name); const b = e ? sessionBest(e) : 0; return b ? {x:s.date, y:r1(b)} : null; }).filter(Boolean);
}
function trainingWeek(){
  const first = DB.lifts.find((s) => s.exercises.some((e) => e.sets.some(isDone)));
  return first ? Math.floor((parseKey(today()) - mondayOf(parseKey(first.date))) / (7*864e5)) + 1 : 1;
}
// Every 5th training week is a deload: half the sets at 90%.
const isDeloadWeek = () => !DB.set.deloadOff && trainingWeek() % 5 === 0;
function stalled(name){ const h = e1History(name); if (h.length < 4) return false; return Math.max(...h.slice(-3).map((p) => p.y)) <= h[h.length-4].y; }

// Today's target for one exercise: weight, reps, sets, and the reason in one line.
function prescribe(e, rec){
  const [lo, hi] = repRange(e[2]), inc = BIG_JUMP.test(e[0]) ? 5 : 2.5;
  let last = lastPerf(e[0], rec), from = null;
  if (!last && e[7] && (last = lastPerf(e[7], rec))) from = e[7];
  let sets = e[1], w = null, r = lo, why = `New exercise: pick a weight you can lift ${lo}–${hi} times with 1–2 reps to spare.`, up = false;
  if (last) {
    const top = Math.max(...last.sets.map((x) => num(x.w)));
    const work = last.sets.filter((x) => num(x.w) === top);
    if (last.deload) { w = round25(top/.9); r = lo; why = "Back from deload: your last heavy weight."; }
    else if (top && last.sets.length >= e[1] && work.every((x) => num(x.r) >= hi)) { w = top+inc; r = lo; up = true; why = `Last time every set hit ${hi} reps, so add ${inc} kg.`; }
    else if (top) { w = top; r = Math.min(hi, Math.max(...work.map((x) => num(x.r))) + 1); why = `Same weight as last time. Get ${hi} reps on every set to earn +${inc} kg.`; }
    else { r = Math.min(hi, Math.max(...last.sets.map((x) => num(x.r))) + 1); why = `Bodyweight: aim for ${r} reps.`; }
    if (from) { up = false; why = `First time: started from your ${from} numbers. Adjust after set 1.`; }
    if (stalled(e[0])) why += " No progress in 3 sessions: slow the lowering to 3 seconds.";
  }
  if (rec && rec.deload) { sets = Math.max(1, Math.ceil(sets/2)); if (w) w = round25(w*.9); why = "Deload week: half the sets at 90% weight, stop 3 reps short."; up = false; }
  else if (rec && rec.ready === "rough") { sets = Math.max(1, sets-1); if (w) w = round25(w*.95); why = "Low-energy day: one set fewer, 5% lighter."; up = false; }
  return {w, r, lo, hi, sets, why, up, last};
}
function liftStatus(k = today()){
  const day = dayName(k);
  if (!PROGRAM[day]) return {day, rest:true, tot:0, done:0};
  const rec = DB.lifts.find((s) => s.date === k && s.day === day);
  const tot = rec ? rec.exercises.reduce((a,e) => a + e.sets.length, 0) : PROGRAM[day].ex.reduce((a,e) => a + e[1], 0);
  const done = rec ? rec.exercises.reduce((a,e) => a + e.sets.filter(isDone).length, 0) : 0;
  return {day, rec, tot, done};
}
function newSession(day, ready){
  const rec = {date:today(), day, ts:Date.now(), ready, deload:isDeloadWeek(), exercises:[]};
  rec.exercises = PROGRAM[day].ex.map((e) => ({name:e[0], sets:Array.from({length:prescribe(e, rec).sets}, () => ({w:"", r:"", done:false}))}));
  DB.lifts.push(rec); save();
  return rec;
}
// Rough session length: sets x (40 s work + rest).
const minutes = (day) => Math.round(PROGRAM[day].ex.reduce((a,e) => a + e[1]*(40 + restSec(e[3])), 0) / 60 / 5) * 5;
function weekDone(){
  const mk = key(mondayOf(new Date())), out = {};
  DB.lifts.forEach((s) => { if (s.date >= mk && s.exercises.some((e) => e.sets.some(isDone))) out[s.day] = 1; });
  return out;
}
// Planned weekly sets per muscle, from the program.
const PLANNED = {}; Object.values(PROGRAM).forEach((d) => d.ex.forEach((e) => { PLANNED[e[6]] = (PLANNED[e[6]]||0) + e[1]; }));
function muscleSets(){
  const mk = key(mondayOf(new Date())), out = {};
  Object.keys(PLANNED).forEach((m) => { out[m] = 0; });
  DB.lifts.forEach((s) => { if (s.date >= mk) s.exercises.forEach((e) => { const m = EX[e.name] && EX[e.name][6]; if (m) out[m] += e.sets.filter(isDone).length; }); });
  return out;
}

/* ================= habits ================= */
const dayRec = (k) => DB.days[k] || null;
const editDay = (k) => DB.days[k] || (DB.days[k] = {m:"full", h:{}});
// "manual" when ticked by hand, "auto" when the logs prove it, false otherwise.
function habitDone(k, h){
  const d = dayRec(k) || {m:"full", h:{}};
  if (d.h && d.h[h.id]) return "manual";
  if (h.auto === "protein" && totals(k).p >= DB.set.p * (d.m === "bare" ? .8 : 1)) return "auto";
  if (h.auto === "workout") { const ls = liftStatus(k); if (!ls.rest && ls.done >= ls.tot*.75) return "auto"; }
  return false;
}
const doneCount = (k) => HABITS.filter((h) => habitDone(k, h)).length;
const MET = 4; // a day counts toward the streak at 4 of 6
// Days from before v3 have only the old 4-item score.
const legacy = (d) => d && d.old != null && !Object.keys(d.h).length;
function dayMet(k){ const d = dayRec(k); return legacy(d) ? d.old >= 2 : doneCount(k) >= MET; }
function streak(){
  let n = 0, d = new Date();
  if (!dayMet(key(d))) d = addDays(d,-1);
  while (dayMet(key(d))) { n++; d = addDays(d,-1); }
  return n;
}

/* ================= shell ================= */
let rerender = () => {};
const commit = () => { save(); rerender(); };
let toastMsg = "", toastT = 0;
function toast(m){ toastMsg = m; toastT = Date.now(); rerender(); setTimeout(() => { if (Date.now() - toastT >= 2100) { toastMsg = ""; rerender(); } }, 2200); }
function beep(){ try { const a = new (window.AudioContext||window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .1; o.start(); setTimeout(() => { o.stop(); a.close(); }, 250); } catch(e){} }

const I = {
  today:"M4 11.5 12 4l8 7.5M6 10v10h12V10",
  train:"M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.8 12h10.4",
  food:"M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-2.5 5-2.5 8h3V21",
  progress:"M4 20V10M10 20V4M16 20v-7M22 20H2",
  check:"M5 12.5l4.5 4.5L19 7.5",
  plus:"M12 5v14M5 12h14", minus:"M5 12h14",
  close:"M6 6l12 12M18 6 6 18",
  back:"M15 5l-7 7 7 7", chev:"M9 5l7 7-7 7",
  flame:"M12 2.5c2.6 3 4.4 5.3 4.4 8.6a4.4 4.4 0 0 1-8.8 0c0-1.3.4-2.3 1.1-3.2.3 1.3 1.1 2.1 2.1 2.2-.7-2.8.7-5.2 1.2-7.6Z",
  gear:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.9 1.1L14.9 21h-3.8l-.3-2.5a7 7 0 0 1-1.9-1.1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 1.9-1.1L11.1 3h3.8l.3 2.5a7 7 0 0 1 1.9 1.1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3Z",
  up:"M7 17 17 7M9 7h8v8",
  drop:"M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11Z"
};
const Icon = ({n, s=22}) => html`<svg class="i" viewBox="0 0 24 24" width=${s} height=${s} aria-hidden="true"><path d=${I[n]}/></svg>`;

function App(){
  const [, force] = useReducer((x) => x+1, 0);
  rerender = force;
  const [tab, setTab] = useState("today");
  const [page, setPage] = useState(null); // {kind:"ex", name} | {kind:"settings"}
  const [gym, setGym] = useState(null);   // {day, start}
  useEffect(() => {
    const vis = () => { if (!document.hidden) force(); };
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(force, 60000);
    return () => { document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, []);
  const go = (t) => { setTab(t); setPage(null); scrollTo(0,0); };
  const nav = {go,
    open: (p) => { setPage(p); scrollTo(0,0); },
    openGym: (day, start) => setGym({day: day || dayName(today()), start}),
    back: () => { setPage(null); scrollTo(0,0); }};
  let body;
  if (page && page.kind === "ex") body = html`<${ExerciseDetail} name=${page.name} nav=${nav}/>`;
  else if (page && page.kind === "settings") body = html`<${Settings} nav=${nav}/>`;
  else body = {today:html`<${Today} nav=${nav}/>`, train:html`<${Train} nav=${nav}/>`, food:html`<${Food}/>`, progress:html`<${Progress} nav=${nav}/>`}[tab];
  return html`
    ${gym ? html`<${Gym} day=${gym.day} start=${gym.start} close=${() => { setGym(null); force(); }}/>` : html`
      <main class="wrap">${body}</main>
      <nav class="tabbar" aria-label="Sections"><div class="in">
        ${[["today","Today"],["train","Train"],["food","Food"],["progress","Progress"]].map(([t,l]) => html`
          <button class=${tab === t ? "on" : ""} onClick=${() => go(t)} aria-current=${tab === t ? "page" : null}><${Icon} n=${t} s=${24}/><span>${l}</span></button>`)}
      </div></nav>`}
    <div class=${"toast" + (toastMsg ? " show" : "")} role="status" aria-live="polite">${toastMsg}</div>
    ${!saveOk && html`<div class="savewarn">This browser is blocking storage. Export your data from Settings.</div>`}`;
}

const Title = ({title, sub, right}) => html`<header class="title"><div class="grow"><h1>${title}</h1>${sub && html`<p>${sub}</p>`}</div>${right}</header>`;
const Bar = ({v, of, cls=""}) => html`<div class=${"bar " + cls} role="progressbar" aria-valuenow=${Math.round(v)} aria-valuemax=${of}><i style=${`width:${Math.min(100, of ? 100*v/of : 0)}%`}></i></div>`;

/* ================= Today ================= */
function Today({nav}){
  const k = today(), d = dayRec(k) || {m:"full", h:{}}, t = totals(k), ls = liftStatus(k);
  const st = streak(), gap = proteinPace() - t.p, wtr = DB.water[k] || 0, S = DB.set;
  const todayBw = DB.bw.find((b) => b.date === k), prevBw = DB.bw.filter((b) => b.date < k).pop();
  const [bw, setBw] = useState(null), [open, setOpen] = useState({});
  const fold = (g) => setOpen({...open, [g]: !open[g]});
  const toggle = (h) => { const dd = editDay(k); if (dd.h[h.id]) delete dd.h[h.id]; else dd.h[h.id] = 1; buzz(10); commit(); };
  const saveBw = (kg) => { if (!num(kg)) return toast("Enter your weight in kg"); addBw(DB, k, kg); setBw(null); buzz(10); toast(`Saved ${num(kg)} kg`); commit(); };
  // Food: every meal not logged yet, its usual dish one tap away.
  const meals = MEALS.filter(([id, , optional]) => !optional && !eaten(k, id));
  const logged = foodList(k);
  const trained = ls.rest || ls.done >= ls.tot*.75;
  const habits = HABITS.filter((h) => !h.auto), hDone = habits.filter((h) => habitDone(k, h));
  const bodyDone = [trained && "workout", todayBw && "weight", wtr >= S.w && "water"].filter(Boolean);
  const Fold = ({g, n, children}) => n > 0 && html`<button class="fold" onClick=${() => fold(g)}><${Icon} n="check" s=${16}/>${n} done${open[g] ? "" : " · show"}</button>${open[g] && html`<div class="dl">${children}</div>`}`;
  const nagBackup = !sync.token && (DB.lifts.length || Object.keys(DB.days).length) && (!DB.lastExport || Date.now() - DB.lastExport > 7*864e5);
  return html`
    <header class="title"><h1 class="grow dateh">${parseKey(k).toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})}</h1>
      <div class="row">${st > 0 && html`<span class="streak" aria-label=${`${st} day streak`}><${Icon} n="flame" s=${16}/>${st}</span>`}
        <button class="iconbtn" onClick=${() => nav.open({kind:"settings"})} aria-label="Settings"><${Icon} n="gear" s=${21}/></button></div></header>

    <div class="stat2">
      <button class="statc" onClick=${() => nav.go("food")}><span class="l">Protein</span><b>${Math.round(t.p)}</b><span class="of">of ${S.p} g</span><div class="trk"><i style=${`width:${Math.min(100, 100*t.p/S.p)}%`}></i></div></button>
      <button class=${"statc k" + (t.k > S.k ? " over" : "")} onClick=${() => nav.go("food")}><span class="l">Calories</span><b>${Math.round(t.k)}</b><span class="of">${t.k > S.k ? `${Math.round(t.k - S.k)} over ${S.k}` : `of ${S.k} kcal`}</span><div class="trk"><i style=${`width:${Math.min(100, 100*t.k/S.k)}%`}></i></div></button>
    </div>

    <${Coach}/>
    <div class="grp"><h2 class="gh2">Food<small>${logged.length} logged</small></h2><section class="card">
      ${meals.map(([id, label, , opts]) => { const o = slotOpts(id, opts)[0]; return html`<div class="do">
        <button class="t" onClick=${() => { pickMeal(id, o); buzz(10); toast(`${label} logged · ${o[1]} g protein`); }}><b>${label}</b><span>${o[0]}</span></button>
        <span class="v">${o[1]} g</span><button class="chg" onClick=${() => nav.go("food")}>change</button>
        <button class="plus" onClick=${() => { pickMeal(id, o); buzz(10); toast(`${label} logged · ${o[1]} g protein`); }} aria-label=${`Log ${label}: ${o[0]}`}><${Icon} n="check" s=${20}/></button></div>`; })}
      ${gap > 20 && html`<div class="do"><div class="t"><b>${Math.round(gap)} g protein behind</b><span>${TOPUPS[1].n}, ${TOPUPS[1].u}</span></div><span class="v">+${TOPUPS[1].p} g</span>
        <button class="plus" onClick=${() => { addExtra(TOPUPS[1]); toast(`+${TOPUPS[1].p} g protein`); }} aria-label="Add whey"><${Icon} n="plus" s=${20}/></button></div>`}
      <button class="do" onClick=${() => nav.go("food")}><span class="t"><b>Something else</b><span>Search ${FOODS.length} foods or type anything</span></span><span class="plus"><${Icon} n="plus" s=${20}/></span></button>
      <${Fold} g="food" n=${logged.length}>${logged.map((f) => html`<button onClick=${() => { logged.splice(logged.indexOf(f), 1); toast(`Removed ${f.n}`); commit(); }}><span>${f.q !== 1 ? `${f.q} × ` : ""}${f.n} · ${r1(f.p*f.q)} g</span><em>undo</em></button>`)}<//>
    </section></div>

    <div class="grp"><h2 class="gh2">Body<small>${bodyDone.length} of 3</small></h2><section class="card">
      ${!trained && html`<div class="do"><div class="t"><b>${PROGRAM[ls.day].title}</b><span>${ls.done ? `${ls.done} of ${ls.tot} sets done` : `${PROGRAM[ls.day].ex.length} exercises · about ${minutes(ls.day)} min`}</span></div>
        <button class="go" onClick=${() => nav.openGym()}>${ls.done ? "Resume" : "Start"}</button></div>`}
      ${!todayBw && (bw == null && prevBw ? html`<div class="do">
          <button class="t" onClick=${() => saveBw(prevBw.kg)}><b>Weight</b><span>${prevBw.kg} kg, same as yesterday</span></button>
          <button class="chg" onClick=${() => setBw(String(prevBw.kg))}>change</button>
          <button class="plus" onClick=${() => saveBw(prevBw.kg)} aria-label=${`Log ${prevBw.kg} kg`}><${Icon} n="check" s=${20}/></button></div>`
        : html`<form class="do" onSubmit=${(e) => { e.preventDefault(); saveBw(bw); }}><div class="t"><b>Weight</b><span>After waking up</span></div>
          <input class="inp num" type="number" inputmode="decimal" step="0.1" placeholder="kg" value=${bw || ""} onInput=${(e) => setBw(e.target.value)} aria-label="Bodyweight in kg"/>
          <button class="plus" aria-label="Save weight"><${Icon} n="check" s=${20}/></button></form>`)}
      ${wtr < S.w && html`<button class="do" onClick=${() => { DB.water[k] = wtr + 1; buzz(10); commit(); }} aria-label="Add a glass of water">
        <span class="t"><b>Water</b><span class="wpills">${Array.from({length:S.w}, (_, j) => html`<i class=${j < wtr ? "on" : ""}></i>`)}</span></span><span class="plus">${wtr}</span></button>`}
      ${bodyDone.length === 3 && html`<div class="alldone">All done</div>`}
      <${Fold} g="body" n=${bodyDone.length}>
        ${trained && html`<button onClick=${() => ls.rest ? null : nav.go("train")}><span>${ls.rest ? "Rest day" : `${PROGRAM[ls.day].title} · ${ls.done} sets`}</span><em>${ls.rest ? "" : "view"}</em></button>`}
        ${todayBw && html`<button onClick=${() => { DB.bw.splice(DB.bw.indexOf(todayBw), 1); commit(); }}><span>Weight · ${todayBw.kg} kg</span><em>undo</em></button>`}
        ${wtr >= S.w && html`<button onClick=${() => { DB.water[k] = wtr - 1; commit(); }}><span>Water · ${wtr} glasses</span><em>−1</em></button>`}<//>
    </section></div>

    <div class="grp"><h2 class="gh2">Habits<button onClick=${() => { editDay(k).m = d.m === "full" ? "bare" : "full"; commit(); }} aria-label="Switch standard">${hDone.length} of ${habits.length} · ${d.m === "full" ? "Full" : "Bare minimum"} ⇄</button></h2><section class="card">
      ${habits.filter((h) => !habitDone(k, h)).map((h) => html`<button class="do" onClick=${() => toggle(h)}>
        <span class="t"><b>${h.name}</b><span>${h[d.m]}</span></span><span class="plus"><${Icon} n="check" s=${20}/></span></button>`)}
      ${hDone.length === habits.length && html`<div class="alldone">All done</div>`}
      <${Fold} g="habits" n=${hDone.length}>${hDone.map((h) => html`<button onClick=${() => toggle(h)}><span>${h.name}</span><em>undo</em></button>`)}<//>
    </section>
    <p class="foot">${dayMet(k) ? "Today counts toward your streak." : `${MET - doneCount(k)} more to keep the streak (workout and protein count too).`}</p></div>

    ${nagBackup && html`<section class="card list backup"><div class="cell">
      <div class="grow"><b>Back up your data</b><span>Turn on sync in Settings, or export a file.</span></div>
      <button class="btn" onClick=${() => nav.open({kind:"settings"})}>Set up</button></div></section>`}`;
}

/* ================= Train ================= */
function Train({nav}){
  const td = dayName(today()), [sel, setSel] = useState(PROGRAM[td] ? td : "Mon");
  const wd = weekDone(), p = PROGRAM[sel], deload = isDeloadWeek(), ls = liftStatus();
  const preview = (sel === td && ls.rec) || {ready:"normal", deload};
  return html`
    <${Title} title="Train" sub=${`Week ${trainingWeek()}${deload ? " · deload week" : ""}`}/>
    <div class="week" role="tablist">${WEEK.map((dn) => html`<button role="tab" aria-selected=${dn === sel} class=${(dn === sel ? "sel " : "") + (wd[dn] ? "done " : "") + (dn === td ? "td" : "")} onClick=${() => setSel(dn)}>
      <span>${dn}</span><i></i></button>`)}</div>
    ${deload && html`<p class="note">Deload week: half the sets at 90% weight. Every 5th week, so 4 weeks of hard work can recover.</p>`}
    ${!p ? html`<section class="card empty"><b>Rest day</b><span>Walk, stretch, hit your protein.</span></section>` : html`
      <section class="card workout">
        <div class="wtop"><div class="grow"><h2>${p.title}</h2><p>${p.sub}</p></div><span class="meta num">${p.ex.length} exercises<br/>about ${minutes(sel)} min</span></div>
        <button class="btn primary wide" onClick=${() => nav.openGym(sel)}>${sel === td && ls.done ? `Resume · ${ls.done} of ${ls.tot} sets` : sel === td ? "Start workout" : `Do ${p.title} today`}</button>
      </section>
      <h2 class="sh">${sel === td ? "Today's targets" : `${sel} targets`}</h2>
      <section class="card list">${p.ex.map((e) => { const pr = prescribe(e, preview); return html`
        <button class="cell" onClick=${() => nav.open({kind:"ex", name:e[0]})}>
          <div class="grow"><b>${e[0]}</b><span>${pr.sets} sets × ${e[2]} reps · ${e[6]}</span></div>
          <span class=${"val num" + (pr.up ? " pos" : "")}>${pr.w ? `${fmt(pr.w)} kg × ${pr.r}` : pr.last ? `${pr.r} reps` : "New"}${pr.up ? html`<${Icon} n="up" s=${14}/>` : ""}</span><${Icon} n="chev" s=${16}/></button>`; })}</section>
      <p class="foot">Predicted from your last session: hit the top of the range on every set and the weight goes up. Tap an exercise for its history and form cue.</p>`}`;
}

function ExerciseDetail({name, nav}){
  const e = EX[name] || [name, 3, "8-12", "90 sec", "8", "", ""];
  const day = Object.keys(PROGRAM).find((dn) => PROGRAM[dn].ex.some((x) => x[0] === name));
  const ls = liftStatus(), pr = prescribe(e, (day === ls.day && ls.rec) || {ready:"normal", deload:isDeloadWeek()});
  const hist = DB.lifts.map((s) => ({s, ex:s.exercises.find((x) => x.name === name)})).filter(({ex}) => ex && ex.sets.some(isDone)).reverse();
  const best = bestE1(name);
  return html`
    <button class="backbtn" onClick=${nav.back}><${Icon} n="back" s=${20}/>Back</button>
    <${Title} title=${name} sub=${[e[6], day && `${PROGRAM[day].title}, ${day}`].filter(Boolean).join(" · ")}/>
    <section class="card tcard">
      <div class="trow"><div><span class="sl">Today</span><b class="big num">${pr.w ? `${fmt(pr.w)} kg` : "Pick a weight"}</b><span class="num">${pr.sets} sets × ${pr.r}${pr.hi > pr.r ? `–${pr.hi}` : ""} reps · rest ${e[3]}</span></div>
        <div><span class="sl">Best (est. 1RM)</span><b class="big num">${best ? `${fmt(best)} kg` : "–"}</b></div></div>
      <p class="why">${pr.why}</p>
      ${e[5] && html`<p class="cue"><b>Form:</b> ${e[5]}</p>`}
      ${day === ls.day && html`<button class="btn primary wide" onClick=${() => nav.openGym(day, name)}>Log this exercise</button>`}
    </section>
    <h2 class="sh">Estimated 1RM over time</h2>
    <section class="card pad"><${LineChart} pts=${e1History(name)} unit="kg" label="Estimated one-rep max"/></section>
    <h2 class="sh">History</h2>
    <section class="card list">${hist.length ? hist.slice(0, 12).map(({s, ex}) => html`<div class="cell">
      <div class="grow"><b>${longDate(s.date)}</b><span class="num">${ex.sets.filter(isDone).map(setTxt).join(", ")}</span></div>
      ${ex.sets.some((x) => x.pr) && html`<span class="tag gold">PR</span>`}</div>`) : html`<div class="cell"><div class="grow"><span>No sets logged yet.</span></div></div>`}</section>`;
}

/* ================= Gym (full-screen session) ================= */
function Gym({day, start, close}){
  const p = PROGRAM[day];
  const existing = DB.lifts.find((s) => s.date === today() && s.day === day);
  const firstOpen = (r) => { if (start) { const n = r.exercises.findIndex((e) => e.name === start); if (n >= 0) return n; } const n = r.exercises.findIndex((e) => e.sets.some((x) => !x.done)); return n < 0 ? 0 : n; };
  const [rec] = useState(() => existing || newSession(day, "normal"));
  const [i, setI] = useState(() => firstOpen(rec));
  const [edit, setEdit] = useState(null);
  const [rest, setRest] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState(false);
  const [val, setValRaw] = useState({k:"", w:"", r:""});
  const [, force] = useReducer((x) => x+1, 0);
  useEffect(() => { if (!rest) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [rest]);
  useEffect(() => { document.body.classList.add("lock"); return () => document.body.classList.remove("lock"); }, []);

  if (summary) {
    let sets = 0, vol = 0; const prs = [];
    rec.exercises.forEach((x) => x.sets.forEach((s) => { if (isDone(s)) { sets++; vol += num(s.w)*num(s.r); if (s.pr) prs.push(`${x.name}: ${fmt(num(s.w))} kg × ${num(s.r)}`); } }));
    return html`<div class="gym"><div class="gbody">
      <h1 class="gh">Workout saved</h1><p class="muted">${p.title} · ${longDate(rec.date)}</p>
      <section class="card stats3"><div><b class="num">${sets}</b><span>sets</span></div><div><b class="num">${Math.round(vol).toLocaleString()}</b><span>kg lifted</span></div><div><b class="num">${prs.length}</b><span>new bests</span></div></section>
      ${prs.length > 0 && html`<section class="card list">${prs.map((x) => html`<div class="cell"><span class="tag gold">PR</span><div class="grow"><b>${x}</b></div></div>`)}</section>`}
      <button class="btn primary wide" onClick=${close}>Done</button></div></div>`;
  }

  const ex = rec.exercises[i], e = EX[ex.name] || [ex.name, ex.sets.length, "8-12", "90 sec", "8", "", ""];
  const pr = prescribe(e, rec);
  const cur = edit != null ? edit : ex.sets.findIndex((x) => !x.done);
  const allDone = cur < 0, setObj = allDone ? null : ex.sets[cur];
  const lastSet = [...ex.sets].reverse().find((x) => x.done);
  // The inputs belong to one exercise+set; moving to another set reloads them from that set, the previous set, or the target.
  const vk = i+":"+cur;
  const v = val.k === vk ? val : {k:vk,
    w: setObj && setObj.w !== "" ? setObj.w : lastSet ? lastSet.w : pr.w != null ? fmt(pr.w) : "",
    r: setObj && setObj.r !== "" ? setObj.r : lastSet ? lastSet.r : String(pr.r)};
  const setVal = (f, x) => setValRaw({...v, [f]: x});
  const step = (f, d) => setVal(f, String(Math.max(0, r1(num(v[f]) + d))));
  const finish = () => { rec.finished = true; if (rec.date === today() && rec.exercises.some((x) => x.sets.some(isDone))) editDay(rec.date).h.workout = 1; save(); setRest(null); setSummary(true); };
  // Low energy: one set fewer on every exercise still open, 5% lighter (prescribe reads rec.ready).
  const lighter = () => { rec.ready = "rough"; rec.exercises.forEach((x) => { if (x.sets.length > 1 && !x.sets[x.sets.length-1].done) x.sets.pop(); }); save(); toast("Lighter plan: one set fewer, 5% less weight"); force(); };
  // Station taken: swap to the alternative and back, only before any set of it is logged.
  const swap = () => { ex.name = e[7]; save(); setValRaw({k:"", w:"", r:""}); force(); };
  const goEx = (j) => { setI(j); setEdit(null); };
  const logSet = () => {
    if (!num(v.r)) return toast("Enter reps first");
    const s = ex.sets[cur]; s.done = false;
    const best = bestE1(ex.name); // all-time, including earlier sets today
    s.w = v.w; s.r = v.r; s.done = true;
    s.pr = best > 0 && num(s.w) > 0 && epley(num(s.w), num(s.r)) > best + .01;
    save(); buzz(s.pr ? [60,40,60,40,140] : 20);
    if (s.pr) toast(`PR · est. 1RM ${fmt(epley(num(s.w), num(s.r)))} kg`);
    if (edit != null) { setEdit(null); return; }
    const more = ex.sets.some((x) => !x.done), last = i === rec.exercises.length-1;
    if (!more && last) return finish();
    const sec = restSec(e[3]);
    setRest({end:Date.now()+sec*1000, total:sec, next: more ? `set ${cur+2} of ${ex.sets.length}` : rec.exercises[i+1].name}); setNow(Date.now());
    if (!more) setI(i+1); else force();
  };
  const left = rest ? Math.max(0, Math.ceil((rest.end - now)/1000)) : 0;
  if (rest && left === 0 && !rest.rang) { rest.rang = true; buzz([200,80,200]); beep(); }

  return html`<div class="gym">
    <div class="gbar">
      <button class="iconbtn" onClick=${close} aria-label="Close workout (progress is saved)"><${Icon} n="close"/></button>
      <div class="grow center"><b>${p.title}</b><span class="num">Exercise ${i+1} of ${rec.exercises.length}</span></div>
      <button class="link" onClick=${finish}>Finish</button>
    </div>
    <div class="exstrip">${rec.exercises.map((x, j) => html`<button class=${(j === i ? "on " : "") + (x.sets.every((s) => s.done) ? "done" : "")} onClick=${() => goEx(j)} aria-label=${x.name}><i></i></button>`)}</div>
    <div class="gbody">
      <h1 class="gh">${ex.name}</h1>
      <p class="muted">${pr.sets} sets × ${e[2]} reps · rest ${e[3]}</p>
      <div class="row">${e[7] && !ex.sets.some((x) => x.done) && html`<button class="link" onClick=${swap}>Station taken? Do ${e[7]}</button>`}
        ${rec.ready !== "rough" && !rec.deload && html`<button class="link" onClick=${lighter}>Low energy? Go lighter</button>`}</div>
      ${e[5] && html`<p class="cue">${e[5]}</p>`}
      <p class=${"why" + (pr.up ? " up" : "")}>${pr.why}</p>

      <div class="sets card">
        <div class="shead"><span>Set</span><span>Last time</span><span>Today</span><span></span></div>
        ${ex.sets.map((s, j) => { const prev = pr.last && pr.last.sets[j]; return html`
          <button class=${"srow" + (j === cur ? " cur" : "") + (s.done ? " done" : "") + (s.pr ? " pr" : "")} onClick=${() => s.done && setEdit(edit === j ? null : j)} disabled=${!s.done && j !== cur}>
            <span class="num">${j+1}</span><span class="num muted">${prev ? setTxt(prev) : "–"}</span>
            <span class="num">${s.done ? setTxt(s) : j === cur ? "Now" : ""}</span>
            <span class="st">${s.pr ? "PR" : s.done ? html`<${Icon} n="check" s=${16}/>` : ""}</span></button>`; })}
        <div class="srowbtns"><button class="link" onClick=${() => { ex.sets.push({w:"", r:"", done:false}); save(); force(); }}>Add a set</button>
          ${ex.sets.length > 1 && !ex.sets[ex.sets.length-1].done && html`<button class="link" onClick=${() => { ex.sets.pop(); save(); force(); }}>Remove a set</button>`}</div>
      </div>

      ${allDone ? html`<div class="exdone">${i < rec.exercises.length-1 ? html`<button class="btn primary wide big" onClick=${() => goEx(i+1)}>Next: ${rec.exercises[i+1].name}</button>` : html`<button class="btn primary wide big" onClick=${finish}>Finish workout</button>`}</div>` : html`
      <div class="steppers">
        <div class="stepper"><span class="sl">Weight, kg</span><div class="sctl">
          <button onClick=${() => step("w", -2.5)} aria-label="2.5 kg less"><${Icon} n="minus" s=${22}/></button>
          <input class="num" type="number" inputmode="decimal" step="0.5" value=${v.w} placeholder="0" onInput=${(ev) => setVal("w", ev.target.value)} aria-label="Weight in kg"/>
          <button onClick=${() => step("w", 2.5)} aria-label="2.5 kg more"><${Icon} n="plus" s=${22}/></button></div></div>
        <div class="stepper"><span class="sl">Reps, target ${pr.r}${pr.hi > pr.r ? `–${pr.hi}` : ""}</span><div class="sctl">
          <button onClick=${() => step("r", -1)} aria-label="One rep fewer"><${Icon} n="minus" s=${22}/></button>
          <input class="num" type="number" inputmode="numeric" value=${v.r} placeholder="0" onInput=${(ev) => setVal("r", ev.target.value)} aria-label="Reps"/>
          <button onClick=${() => step("r", 1)} aria-label="One rep more"><${Icon} n="plus" s=${22}/></button></div></div>
      </div>
      ${cur === ex.sets.length-1 && edit == null && pr.lo >= 10 && html`<p class="why up">Last set: go to failure.</p>`}
      <button class="btn primary wide big" onClick=${logSet}>${edit != null ? `Save set ${cur+1}` : `Log ${num(v.w) ? `${v.w} kg × ` : ""}${v.r || 0} reps`}</button>
      ${edit != null && html`<button class="link center" onClick=${() => { Object.assign(ex.sets[edit], {done:false, pr:false}); setEdit(null); save(); }}>Clear set ${edit+1}</button>`}`}
    </div>
    ${rest && html`<div class=${"restbar" + (left === 0 ? " go" : "")} role="timer">
      <div class="rfill" style=${`width:${rest.total ? 100*(1-left/rest.total) : 100}%`}></div>
      <div class="grow"><b class="num">${left ? `${Math.floor(left/60)}:${pad(left%60)}` : "Go"}</b><span>${left ? "Rest" : "Rest over"}, next: ${rest.next}</span></div>
      <button class="btn" onClick=${() => setRest({...rest, end:rest.end+15000, total:rest.total+15, rang:false})}>+15 s</button>
      <button class="btn" onClick=${() => setRest(null)}>${left ? "Skip" : "Close"}</button></div>`}
  </div>`;
}

/* ================= Food ================= */
function Food(){
  const k = today(), t = totals(k), S = DB.set, wtr = DB.water[k] || 0;
  const [q, setQ] = useState(""), [custom, setCustom] = useState(null), [more, setMore] = useState({});
  const list = foodList(k), extras = list.filter((f) => !f.slot);
  const ql = q.trim().toLowerCase();
  const dishes = MEALS.flatMap((m) => m[3].map((o) => ({n:o[0], u:"", p:o[1], k:o[2]})));
  const pool = [...DB.custom, ...TOPUPS, ...FOODS, ...dishes].filter((f, j, a) => a.findIndex((x) => x.n === f.n) === j);
  const recent = recentExtras();
  const res = ql ? pool.filter((f) => f.n.toLowerCase().includes(ql)).slice(0, 12) : recent.length ? recent : TOPUPS.slice(0, 4);
  const yest = foodList(key(addDays(new Date(), -1)));
  const add = (f) => { addExtra(f); buzz(8); toast(`Added ${f.n}`); };
  const left = Math.max(0, S.p - t.p), kLeft = Math.round(S.k - t.k);
  // No match: the add form opens with the search text as the name.
  const form = custom || (ql && !res.length ? {n:q.trim(), k:"", p:""} : null);
  return html`
    <${Title} title="Food" sub=${`${left ? `${Math.round(left)} g protein to go` : "Protein target hit"} · ${kLeft >= 0 ? `${kLeft} kcal left` : `${-kLeft} kcal over`}`}/>
    <section class="card pad macros">
      <div class="mrow"><span class="sl">Protein</span><span class="num"><b>${Math.round(t.p)}</b> / ${S.p} g</span></div>
      <div class=${"bar tall" + (t.p >= S.p ? " good" : "")}><i style=${`width:${Math.min(100, 100*t.p/S.p)}%`}></i><em style=${`left:${Math.min(100, 100*proteinPace()/S.p)}%`}></em></div>
      <p class="hint">The line marks where you should be by now.</p>
      <div class="mrow"><span class="sl">Calories</span><span class="num"><b>${Math.round(t.k)}</b> / ${S.k} kcal</span></div>
      <${Bar} v=${t.k} of=${S.k} cls="cal"/>
      <div class="mrow"><span class="sl">Water</span><span class="num"><b>${wtr}</b> / ${S.w} glasses</span></div>
      <div class="glasses">${Array.from({length:S.w}, (_, j) => html`<button class=${j < wtr ? "on" : ""} aria-label=${`${j+1} glasses`} onClick=${() => { DB.water[k] = wtr === j+1 ? j : j+1; commit(); }}><${Icon} n="drop" s=${18}/></button>`)}</div>
    </section>
    ${!list.length && yest.length > 0 && html`<button class="btn wide" onClick=${() => { DB.food[k] = yest.map((f) => ({...f})); toast("Copied yesterday's meals"); commit(); }}>Same as yesterday (${yest.length} ${yest.length > 1 ? "items" : "item"})</button>`}

    ${MEALS.map(([id, label, optional, opts]) => { const got = eaten(k, id); let ord = slotOpts(id, opts); if (got) ord = [...ord.filter((o) => o[0] === got.n), ...ord.filter((o) => o[0] !== got.n)]; return html`
      <div class="shrow"><h2 class="sh">${label}${optional ? html` <small>optional</small>` : ""}</h2>${got && html`<span class="tag good">${got.p} g logged</span>`}</div>
      <section class="card list">${(more[id] ? ord : ord.slice(0, 4)).map((o) => { const on = got && got.n === o[0]; return html`
        <button class=${"cell pick" + (on ? " on" : "")} onClick=${() => { pickMeal(id, o); buzz(10); rerender(); }} aria-pressed=${!!on}>
          <span class="radio">${on && html`<${Icon} n="check" s=${14}/>`}</span>
          <span class="grow"><b>${o[0]}</b></span><span class="val num">${o[1]} g<small>${o[2]} kcal</small></span></button>`; })}
        ${!more[id] && ord.length > 4 && html`<button class="cell" onClick=${() => setMore({...more, [id]:1})}><span class="grow"><span>All ${ord.length} dishes</span></span><${Icon} n="chev" s=${16}/></button>`}</section>`; })}

    <h2 class="sh">Anything else</h2>
    <section class="card pad">
      <input class="search" type="search" placeholder="Search: egg, paneer, roti, whey" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Search foods"/>
      ${!ql && html`<p class="hint">${recent.length ? "Recent" : "Quick protein"}</p>`}
      <div class="chips">${res.map((f) => html`<button class="chip" onClick=${() => add(f)}>${f.n}<em>${r1(f.p)} g</em></button>`)}</div>
      ${ql && !res.length && html`<p class="hint">No match. Add it: protein is enough, calories if you know them.</p>`}
      ${form ? html`<form class="custom" onSubmit=${(e) => { e.preventDefault(); if (!form.n.trim()) return toast("Name it first"); const f = {n:form.n.trim(), u:"", k:num(form.k), p:num(form.p)}; DB.custom = [f, ...DB.custom.filter((x) => x.n !== f.n)]; setCustom(null); setQ(""); add(f); }}>
          <input placeholder="Food name" value=${form.n} onInput=${(e) => setCustom({...form, n:e.target.value})} aria-label="Food name"/>
          <input class="num" type="number" inputmode="decimal" placeholder="Protein g" value=${form.p} onInput=${(e) => setCustom({...form, p:e.target.value})} aria-label="Protein in grams"/>
          <input class="num" type="number" inputmode="numeric" placeholder="kcal (optional)" value=${form.k} onInput=${(e) => setCustom({...form, k:e.target.value})} aria-label="Calories, optional"/>
          <button class="btn primary">Add</button></form>`
        : html`<button class="link" onClick=${() => setCustom({n:q, k:"", p:""})}>Add your own food</button>`}
    </section>
    ${extras.length > 0 && html`<section class="card list">${extras.map((f) => html`<div class="cell">
      <div class="grow"><b>${f.n}</b><span class="num">${r1(f.p*f.q)} g protein · ${Math.round(f.k*f.q)} kcal</span></div>
      <div class="qty"><button aria-label=${`Less ${f.n}`} onClick=${() => { f.q = r1(f.q - .5); if (f.q <= 0) list.splice(list.indexOf(f), 1); commit(); }}><${Icon} n="minus" s=${16}/></button>
        <b class="num">${f.q}</b><button aria-label=${`More ${f.n}`} onClick=${() => { f.q = r1(f.q + .5); commit(); }}><${Icon} n="plus" s=${16}/></button></div></div>`)}</section>`}`;
}

/* ================= charts ================= */
// Single-series charts: one hue, recessive axes, tap a mark to read its value.
// Bar with a 4px rounded top, square on the baseline.
function barPath(x, base, w, h){ if (h <= 0) return ""; const r = Math.min(4, w/2, h); return `M${x},${base}V${base-h+r}Q${x},${base-h} ${x+r},${base-h}H${x+w-r}Q${x+w},${base-h} ${x+w},${base-h+r}V${base}Z`; }
function LineChart({pts, unit, label, avg}){
  const [sel, setSel] = useState(null);
  if (pts.length < 2) return html`<p class="muted small">${pts.length ? "One entry so far. The line appears after two." : "No data yet."}</p>`;
  const W = 340, H = 160, P = {l:36, r:10, t:12, b:22};
  const ys = pts.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad2 = (hi - lo) * .15 || 1;
  const mn = lo - pad2, mx = hi + pad2;
  const t0 = parseKey(pts[0].x).getTime(), span = parseKey(pts[pts.length-1].x).getTime() - t0 || 1;
  const X = (p) => P.l + (W - P.l - P.r) * (parseKey(p.x).getTime() - t0) / span;
  const Y = (v) => H - P.b - (H - P.t - P.b) * (v - mn) / (mx - mn);
  const line = (a) => a.map((p) => `${X(p).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const s = sel != null ? pts[sel] : pts[pts.length-1];
  return html`<div class="chart">
    <p class="readout num" aria-live="polite"><b>${fmt(s.y)} ${unit}</b> · ${longDate(s.x)}${sel == null ? html` <span class="muted">latest</span>` : ""}</p>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${label}>
      ${[lo, hi].map((t) => html`<g><line x1=${P.l} x2=${W-P.r} y1=${Y(t)} y2=${Y(t)} class="grid"/><text x=${P.l-6} y=${Y(t)+3.5} text-anchor="end" class="ax">${fmt(t)}</text></g>`)}
      ${avg && avg.length > 1 && html`<polyline points=${line(avg)} class="ln"/>`}
      <polyline points=${line(pts)} class=${avg ? "ln faint" : "ln"}/>
      ${sel != null && html`<line x1=${X(s)} x2=${X(s)} y1=${P.t} y2=${H-P.b} class="cross"/>`}
      ${pts.map((p, j) => html`<g class="hit" onClick=${() => setSel(sel === j ? null : j)}><circle cx=${X(p)} cy=${Y(p.y)} r="14" fill="transparent"/>
        ${(j === pts.length-1 || j === sel || (!avg && pts.length <= 12)) && html`<circle cx=${X(p)} cy=${Y(p.y)} r=${j === sel ? 5.5 : 4} class="dot"/>`}</g>`)}
      <text x=${P.l} y=${H-6} class="ax">${short(pts[0].x)}</text><text x=${W-P.r} y=${H-6} text-anchor="end" class="ax">${short(pts[pts.length-1].x)}</text>
    </svg>
    ${avg && html`<p class="legend"><i class="ln2"></i>7-day average <i class="ln2 faint"></i>Daily weigh-ins</p>`}</div>`;
}

/* ================= Progress (mockup rated 8+) ================= */
// Trailing 7-day average of weigh-ins: smooths out day-to-day water weight.
function bwAvg(){
  const pts = DB.bw.slice(-120).map((b) => ({x:b.date, y:b.kg}));
  return pts.map((p) => { const t = parseKey(p.x).getTime(); const w = pts.filter((q) => { const d = (t - parseKey(q.x).getTime())/864e5; return d >= 0 && d < 7; }); return {x:p.x, y:w.reduce((a,q) => a+q.y, 0)/w.length}; });
}
// kg per week from a least-squares line through the last 21 days of averages; null until a week of data.
function pace(avg){
  const cut = key(addDays(new Date(), -21)), a = avg.filter((p) => p.x >= cut);
  if (a.length < 3 || (parseKey(a[a.length-1].x) - parseKey(a[0].x)) / 864e5 < 7) return null;
  const xs = a.map((p) => parseKey(p.x) / 864e5), mx = xs.reduce((s,x) => s+x, 0)/xs.length, my = a.reduce((s,p) => s+p.y, 0)/a.length;
  const sl = xs.reduce((s,x,i) => s + (x-mx)*(a[i].y-my), 0) / xs.reduce((s,x) => s + (x-mx)**2, 0);
  return sl * 7;
}
const round50 = (n) => Math.round(n/50)*50;
// 1 kg of fat is about 7700 kcal, so 1 kg/week is 1100 kcal/day.
// ponytail: fixed 7700 kcal/kg and +-300 kcal steps; fit intake against the trend once food logs are complete.
function coach(avg){
  const S = DB.set, now = avg[avg.length-1], goal = S.goalKg || (S.lean ? S.lean / .85 : null);
  if (!now || !goal || !S.goalDate) return null;
  const weeks = (parseKey(S.goalDate) - parseKey(today())) / (7*864e5), togo = now.y - goal;
  if (togo <= 0) return {tone:"good", msg:`Goal reached: ${fmt(now.y)} kg. Set the next goal in Settings.`};
  if (weeks <= 0) return {tone:"warn", msg:`Goal date passed with ${fmt(togo)} kg to go. Set a new date in Settings.`};
  const need = togo / weeks, cap = now.y * .01, wk = pace(avg); // kg/week; 1% of bodyweight a week is the muscle-safe ceiling
  const by = parseKey(S.goalDate).toLocaleDateString(undefined,{day:"numeric", month:"short"});
  const fast = need > cap ? ` That's faster than the safe ${fmt(cap)} kg/week, so expect to land a bit after ${by}.` : "";
  if (wk == null) {
    const tdee = S.lean ? (370 + 21.6*S.lean) * 1.6 : null; // Katch-McArdle x 1.6 for daily training: a first guess the trend corrects
    const kcal = tdee ? Math.max(1500, round50(tdee - Math.min(need, cap)*1100)) : null;
    return {tone:"info", kcal, msg:`${fmt(goal)} kg by ${by} needs ${fmt(need)} kg/week.${kcal ? ` Start at about ${kcal} kcal.` : ""}${fast} Verdict after a week of daily weigh-ins.`};
  }
  const lost = -wk;
  if (lost > cap*1.1) { const kcal = S.k + round50(Math.min(300, (lost - cap)*1100)); return {tone:"warn", kcal, msg:`Losing ${fmt(lost)} kg/week: too fast, you risk losing muscle. Eat ${kcal} kcal (+${kcal - S.k}).`}; }
  if (lost >= need*.9) return {tone:"good", msg:`On track: losing ${fmt(lost)} kg/week, ${by} needs ${fmt(need)}. Keep ${S.k} kcal.${fast}`};
  const kcal = Math.max(1500, S.k - round50(Math.min(300, Math.max(50, (need - lost)*1100))));
  return {tone:"bad", kcal, msg:`Behind: ${lost > 0 ? `losing ${fmt(lost)} kg/week` : "not losing yet"}, ${by} needs ${fmt(need)}. Eat ${kcal} kcal (${kcal - S.k}).${fast}`};
}
function Coach(){
  const c = coach(bwAvg());
  if (!c) return null;
  return html`<section class=${"coach " + c.tone}><p>${c.msg}</p>
    ${c.kcal && c.kcal !== DB.set.k && html`<button class="btn" onClick=${() => { DB.set.k = c.kcal; toast(`Target ${c.kcal} kcal`); commit(); }}>Set ${c.kcal} kcal</button>`}</section>`;
}
function CutHero({avg}){
  const S = DB.set, now = avg[avg.length-1], wk = pace(avg);
  if (!now) return html`<section class="hero"><span class="l">Cut</span><b>– kg</b><span class="s">Log your weight on Today to start the trend.</span></section>`;
  // Goal weight from Settings; without one, 15% body fat at today's lean mass.
  const goal = S.goalKg || (S.lean ? S.lean / .85 : null);
  const togo = goal ? now.y - goal : null;
  const weeks = togo > 0 && wk < 0 ? Math.min(104, togo / -wk) : null;
  const eta = weeks != null ? addDays(parseKey(now.x), Math.round(weeks*7)) : null;
  // Chart: averages so far, dashed line to the goal at the current pace.
  const W = 320, H = 120, end = eta || addDays(parseKey(now.x), 28);
  const t0 = parseKey(avg[0].x).getTime(), span = (end.getTime() - t0) || 1;
  const lo = Math.min(goal || Infinity, ...avg.map((p) => p.y)) - .5, hi = Math.max(...avg.map((p) => p.y)) + .5;
  const X = (t) => 4 + (W-8) * (t - t0) / span, Y = (v) => 8 + (H-24) * (hi - v) / (hi - lo);
  const line = avg.map((p) => `${X(parseKey(p.x).getTime()).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const nx = X(parseKey(now.x).getTime()), ny = Y(now.y);
  return html`<section class="hero">
    <span class="l">Cut · to ${goal ? `${fmt(goal)} kg` : "goal"}${goal && S.lean ? ` · about ${Math.round(100*(1 - S.lean/goal))}% body fat` : ""}</span>
    <b class="num">${fmt(now.y)} kg</b>
    <span class="s">${!goal ? "Enter your body fat % in Settings to see your goal weight." : togo <= 0 ? "Goal weight reached." :
      `Goal about ${fmt(goal)} kg · ${fmt(togo)} kg to go · ${eta ? `on pace for ${eta.toLocaleDateString(undefined,{day:"numeric", month:"short", year:"numeric"})}` : wk == null ? "pace shows after a week of weigh-ins" : "not losing yet"}`}</span>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Weight trend and projection to goal">
      ${goal && html`<line x1="0" x2=${W} y1=${Y(goal)} y2=${Y(goal)} class="goalln"/><text x=${W-2} y=${Y(goal)-5} text-anchor="end" class="goaltx">${fmt(goal)} goal</text>`}
      ${eta && html`<polyline points=${`${nx},${ny} ${X(end.getTime())},${Y(goal)}`} class="proj"/>`}
      <polyline points=${line} class="avgln"/>
      <circle cx=${nx} cy=${ny} r="5" class="nowdot"/>
    </svg>
    <p class="legend inv"><span><i class="sw acc"></i>7-day average</span>${eta && html`<span>- - projection at your real pace</span>`}</p>
  </section>
  <div class="tiles">
    <div class="tile"><b class="num">${S.lean ? `${Math.round(100*(1 - S.lean/now.y))}%` : "–"}</b><span>est. body fat</span></div>
    <div class="tile"><b class="num">${wk == null ? "–" : `${wk > 0 ? "+" : ""}${fmt(wk)}`}</b><span>kg / week</span></div>
    <div class="tile"><b class="num">${S.lean ? fmt(S.lean) : "–"}</b><span>kg lean mass</span></div>
  </div>`;
}
// One row per goal, one cell per day: green hit, pale close, empty missed or not yet.
function WeekGrid(){
  const mon = mondayOf(new Date()), tk = today(), S = DB.set;
  const days = Array.from({length:7}, (_, j) => key(addDays(mon, j)));
  const cardio = HABITS.find((h) => h.id === "steps");
  const rows = [
    ["Gym", (k) => DB.lifts.some((s) => s.date === k && s.exercises.some((e) => e.sets.some(isDone))) ? 2 : 0],
    ["Protein", (k) => { const p = totals(k).p; return p >= S.p ? 2 : p >= S.p*.8 ? 1 : 0; }],
    ["Calories", (k) => { const c = totals(k).k; return !c ? 0 : c <= S.k ? 2 : c <= S.k*1.1 ? 1 : 0; }],
    ["Cardio", (k) => cardio && habitDone(k, cardio) ? 2 : 0],
    ["Habits", (k) => { const n = doneCount(k); return n >= MET ? 2 : n >= 2 ? 1 : 0; }]];
  return html`<section class="card pad"><div class="wgrid">
    <span></span>${days.map((k) => html`<span class=${"h" + (k === tk ? " td" : "")}>${DAYS[parseKey(k).getDay()][0]}</span>`)}
    ${rows.map(([l, f]) => html`<span>${l}</span>${days.map((k) => { const v = k > tk ? 0 : f(k); return html`<i class=${v === 2 ? "ok" : v === 1 ? "part" : ""} title=${`${l} ${short(k)}`}></i>`; })}`)}
  </div><p class="legend"><span><i class="sw ok"></i>Hit</span><span><i class="sw part"></i>Close</span><span><i class="sw"></i>Missed or ahead</span></p></section>`;
}
function KcalChart(){
  const [sel, setSel] = useState(null), S = DB.set, now = new Date();
  const data = Array.from({length:14}, (_, j) => { const k = key(addDays(now, j-13)), t = totals(k); return {k, v:t.k, p:t.p}; });
  const W = 320, H = 130, max = Math.max(S.k*1.15, ...data.map((d) => d.v)), bw = W / 14;
  const Y = (v) => H - 4 - (H - 14) * v / max, s = sel != null ? data[sel] : null;
  return html`<div class="chart">
    <p class="readout num" aria-live="polite">${s ? html`<b>${Math.round(s.v)} kcal · ${Math.round(s.p)} g protein</b> · ${longDate(s.k)}` : html`<span class="muted">Tap a day for calories and protein</span>`}</p>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Calories per day, last 14 days">
      ${data.map((d, j) => { const h = d.v ? Math.max(3, Y(0) - Y(d.v)) : 0; return html`<g class="hit" onClick=${() => setSel(sel === j ? null : j)}>
        <rect x=${j*bw} y="0" width=${bw} height=${H} fill="transparent"/>
        <path class=${"kb" + (d.v > S.k ? " over" : "") + (sel === j ? " sel" : "")} d=${barPath(j*bw + 3, Y(0), bw - 6, h)}/></g>`; })}
      <line x1="0" x2=${W} y1=${Y(S.k)} y2=${Y(S.k)} class="target"/>
    </svg>
    <p class="legend"><span><i class="sw cal"></i>Under ${S.k} kcal</span><span><i class="sw acc"></i>Over</span></p></div>`;
}
const KEY_LIFTS = [["Conventional Deadlift","Deadlift","Tue"],["Weighted Pull-up (med-wide)","Weighted pull-up","Tue"],["Barbell Flat Bench Press","Bench press","Mon"],["Barbell Back Squat","Squat","Sat"]];
function Spark({pts}){
  if (pts.length < 2) return html`<svg viewBox="0 0 100 34"></svg>`;
  const lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y)) || 1;
  return html`<svg viewBox="0 0 100 34" aria-hidden="true"><polyline class="spark" points=${pts.map((p, j) => `${(100*j/(pts.length-1)).toFixed(1)},${(30 - 26*(p.y - lo)/((hi - lo) || 1)).toFixed(1)}`).join(" ")}/></svg>`;
}
function Progress({nav}){
  const avg = bwAvg(), tk = today(), mon = mondayOf(new Date());
  const ms = muscleSets(), ago = key(addDays(new Date(), -28));
  const lift = (n) => { const h = e1History(n); if (!h.length) return null; const best = Math.max(...h.map((p) => p.y)), before = h.filter((p) => p.x <= ago).map((p) => p.y); return {h, best, d: before.length ? best - Math.max(...before) : null, last: h[h.length-1].x}; };
  const names = [...new Set(DB.lifts.flatMap((s) => s.exercises.filter((e) => e.sets.some((x) => isDone(x) && num(x.w))).map((e) => e.name)))];
  const rows = names.map((n) => ({n, ...lift(n)})).sort((a,b) => a.last < b.last ? 1 : -1);
  const start = addDays(mon, -17*7);
  const cells = Array.from({length:18*7}, (_, j) => { const k = key(addDays(start, j)); if (k > tk) return {k, lv:"f"}; const d = dayRec(k); const c = legacy(d) ? Math.round(d.old*1.5) : doneCount(k); return {k, c, lv: c >= 6 ? 4 : c >= MET ? 3 : c >= 2 ? 2 : c >= 1 ? 1 : 0}; });
  const [cell, setCell] = useState(null), [all, setAll] = useState(false);
  const maxSets = Math.max(20, ...Object.values(ms), ...Object.values(PLANNED));
  return html`<${Title} title="Progress"/>
    <${CutHero} avg=${avg}/>
    <${Coach}/>
    <h2 class="gh2">This week<small>Mon–Sun</small></h2>
    <${WeekGrid}/>
    <h2 class="gh2">Eating<small>last 14 days</small></h2>
    <section class="card pad"><${KcalChart}/></section>
    <h2 class="gh2">Strength<small>est. 1-rep max</small></h2>
    <div class="lifts">${KEY_LIFTS.map(([n, label, day]) => { const r = lift(n); return html`<button class="liftc" onClick=${() => nav.open({kind:"ex", name:n})}>
      <span class="n">${label}</span><b class="num">${r ? `${fmt(r.best)} kg` : "–"}</b>
      <span class=${"d" + (r && r.d > 0 ? " pos" : "")}>${!r ? `log ${day}` : r.d == null ? `since ${short(r.h[0].x)}` : `${r.d >= 0 ? "+" : ""}${fmt(r.d)} in 4 wk`}</span>
      <${Spark} pts=${r ? r.h : []}/></button>`; })}</div>
    <p class="foot">Holding strength on a cut means you are keeping muscle.</p>
    <section class="card list">${(all ? rows : rows.slice(0, 5)).map((r) => html`<button class="cell" onClick=${() => nav.open({kind:"ex", name:r.n})}>
      <div class="grow"><b>${r.n}</b><span>Last done ${short(r.last)}</span></div>
      <span class="val num">${fmt(r.best)} kg<small class=${r.d > 0 ? "pos" : ""}>${r.d == null ? "est. 1RM" : `${r.d >= 0 ? "+" : ""}${fmt(r.d)} kg in 4 wk`}</small></span><${Icon} n="chev" s=${16}/></button>`)}
      ${!all && rows.length > 5 && html`<button class="cell" onClick=${() => setAll(true)}><span class="grow"><span>All ${rows.length} lifts</span></span><${Icon} n="chev" s=${16}/></button>`}
      ${!rows.length && html`<div class="cell"><div class="grow"><span>Log a workout to see your lifts here.</span></div></div>`}</section>
    <h2 class="gh2">Sets per muscle<small>this week</small></h2>
    <section class="card pad">
      ${Object.keys(PLANNED).map((m) => html`<div class="mbar"><span class="mname">${m}</span>
        <div class="mtrack"><i style=${`width:${100*ms[m]/maxSets}%`}></i><em style=${`left:${100*PLANNED[m]/maxSets}%`}></em></div>
        <span class="num mval">${ms[m]}<small>/${PLANNED[m]}</small></span></div>`)}
      <p class="legend"><i class="sw met"></i>Done <i class="tickm"></i>Planned</p>
    </section>
    <h2 class="gh2">Habits<small>18 weeks · streak ${streak()}</small></h2>
    <section class="card pad">
      <p class="readout num" aria-live="polite">${cell ? html`<b>${cell.lv === "f" ? "Upcoming" : `${cell.c} of ${HABITS.length} habits`}</b> · ${longDate(cell.k)}` : html`<span class="muted">Tap a day</span>`}</p>
      <div class="heat" role="img" aria-label="Habit calendar">${cells.map((c) => html`<button class=${"l"+c.lv + (c.k === tk ? " td" : "")} onClick=${() => setCell(c)} aria-label=${c.k}></button>`)}</div>
      <p class="legend">0 <span class="hl l0"></span><span class="hl l1"></span><span class="hl l2"></span><span class="hl l3"></span><span class="hl l4"></span> ${HABITS.length} habits</p><p class="hint">Each column is a week, Monday on top.</p>
    </section>`;
}

/* ================= Settings ================= */
function Settings({nav}){
  const S = DB.set, fileRef = useRef(), [armed, setArmed] = useState(false), [armed2, setArmed2] = useState(false);
  const [tok, setTok] = useState(""), [armed3, setArmed3] = useState(false);
  const connect = async () => {
    sync = {token: tok.trim()}; saveSync(); setTok("");
    try { const o = await pullSync(); const empty = !DB.lifts.length && !Object.keys(DB.food).length;
      if (empty) { DB = norm(o); save(); toast("Restored from sync"); } else { toast("Connected"); pushSync(); } }
    catch(e){ if (e === 404) { toast("Connected"); pushSync(); } else { sync = {}; saveSync(); toast(e === 401 ? "Token rejected" : "Couldn't reach GitHub"); } }
    rerender();
  };
  const setT = (f, v) => { if (num(v) > 0) { S[f] = num(v); save(); toast("Saved"); rerender(); } };
  return html`
    <button class="backbtn" onClick=${nav.back}><${Icon} n="back" s=${20}/>Back</button>
    <${Title} title="Settings"/>
    <h2 class="sh">Daily targets</h2>
    <section class="card list">
      ${[["p","Protein","g"],["k","Calories","kcal"],["w","Water","glasses"]].map(([f,l,u]) => html`<label class="cell"><div class="grow"><b>${l}</b></div>
        <input class="inp num" type="number" inputmode="numeric" value=${S[f]} onChange=${(e) => setT(f, e.target.value)}/><span class="unit">${u}</span></label>`)}
    </section>
    <h2 class="sh">Body</h2>
    <section class="card list">
      <label class="cell"><div class="grow"><b>Body fat now</b><span>${S.lean ? `Lean mass ${fmt(S.lean)} kg, from your 7-day average weight` : "Sets your lean mass for the goal weight"}</span></div>
        <input class="inp num" type="number" inputmode="decimal" placeholder="%" onChange=${(e) => { const bf = num(e.target.value), a = bwAvg().pop(); if (!a) return toast("Log your weight first"); if (bf > 3 && bf < 60) { S.lean = r1(a.y * (1 - bf/100)); save(); toast(`Lean mass ${fmt(S.lean)} kg`); rerender(); } }}/><span class="unit">%</span></label>
      <label class="cell"><div class="grow"><b>Goal date</b><span>The coach on Today checks your pace against it</span></div>
        <input class="inp date" type="date" value=${S.goalDate || ""} onChange=${(e) => { S.goalDate = e.target.value; save(); toast("Saved"); rerender(); }}/></label>
      <label class="cell"><div class="grow"><b>Goal weight</b><span>${S.goalKg && S.lean ? `About ${Math.round(100*(1 - S.lean/S.goalKg))}% body fat at that weight` : S.lean ? `Empty: ${fmt(S.lean/.85)} kg, which is 15% body fat` : "Set your body fat first"}</span></div>
        <input class="inp num" type="number" inputmode="decimal" step="0.5" placeholder="kg" value=${S.goalKg || ""} onChange=${(e) => setT("goalKg", e.target.value)}/><span class="unit">kg</span></label>
    </section>
    <h2 class="sh">Training</h2>
    <section class="card list"><label class="cell"><div class="grow"><b>Deload every 5th week</b><span>Half the sets at 90% weight</span></div>
      <input type="checkbox" class="switch" checked=${!S.deloadOff} onChange=${(e) => { S.deloadOff = !e.target.checked; commit(); }}/></label></section>
    <h2 class="sh">Sync</h2>
    ${sync.token ? html`<section class="card list">
      <div class="cell"><div class="grow"><b>${sync.err || (sync.at ? `Synced ${new Date(sync.at).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}` : "Connected, syncing…")}</b><span>Every change is saved to the private repo ${SYNC_REPO} when you're online.</span></div></div>
      <button class="cell" onClick=${() => pushSync()}><div class="grow"><b>Sync now</b></div><${Icon} n="chev" s=${16}/></button>
      <button class="cell" onClick=${async () => { if (!armed3) return setArmed3(true); try { DB = norm(await pullSync()); save(); toast("Restored from sync"); } catch(e){ toast("Couldn't restore"); } setArmed3(false); rerender(); }}><div class="grow"><b>${armed3 ? "Tap again: replace this phone's data with the synced copy" : "Restore from sync"}</b><span>For a new phone or after a reset</span></div></button>
      <button class="cell danger" onClick=${() => { sync = {}; saveSync(); rerender(); }}><div class="grow"><b>Disconnect</b></div></button></section>`
    : html`<form class="card list" onSubmit=${(e) => { e.preventDefault(); if (tok.trim()) connect(); }}>
      <div class="cell col"><div><b>Back up automatically</b><span>Make a fine-grained token at github.com/settings/personal-access-tokens/new: only ${SYNC_REPO}, Contents read and write. Paste it here once.</span></div>
        <div class="row"><input class="inp grow" type="password" autocomplete="off" placeholder="github_pat_…" value=${tok} onInput=${(e) => setTok(e.target.value)} aria-label="GitHub token"/><button class="btn primary">Connect</button></div></div></form>`}
    <h2 class="sh">Your data</h2>
    <section class="card list">
      <button class="cell" onClick=${exportData}><div class="grow"><b>Export backup</b><span>Saves a .json file to your phone</span></div><${Icon} n="chev" s=${16}/></button>
      <button class="cell" onClick=${() => fileRef.current.click()}><div class="grow"><b>Import</b><span>A backup from this app, WrkTrack, Fitness Tracker or Daily Standard</span></div><${Icon} n="chev" s=${16}/></button>
      ${hasSnap() && html`<button class="cell" onClick=${() => { if (!armed2) return setArmed2(true); DB = norm(JSON.parse(localStorage.getItem(LS+"-snap"))); save(); setArmed2(false); toast("Restored"); rerender(); }}><div class="grow"><b>${armed2 ? "Tap again to go back to this morning's copy" : "Undo today's changes"}</b><span>Restores the copy saved when you first opened the app today</span></div></button>`}
      <button class="cell danger" onClick=${() => { if (!armed) return setArmed(true); DB = blank(); save(); setArmed(false); toast("All data deleted"); rerender(); }}><div class="grow"><b>${armed ? "Tap again to delete everything (back up first)" : "Delete all data"}</b></div></button>
    </section>
    <p class="foot">Your data stays on this phone. Nothing is uploaded. ${DB.lastExport ? `Last backup ${short(key(new Date(DB.lastExport)))}.` : "No backup yet."}</p>
    <input type="file" accept="application/json,.json" hidden ref=${fileRef} onChange=${(e) => importData(e.target)}/>`;
}
function hasSnap(){ try { return !!localStorage.getItem(LS+"-snap"); } catch(e){ return false; } }
function exportData(){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], {type:"application/json"}));
  a.download = "standard-"+today()+".json"; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  DB.lastExport = Date.now(); save(); toast("Backup saved to Downloads");
}
function importData(input){
  const f = input.files[0]; if (!f) return;
  f.text().then((txt) => {
    const o = JSON.parse(txt);
    if (o && o.v >= 1 && Array.isArray(o.lifts)) { DB = norm(o); toast("Backup restored"); }
    else { const got = absorb(DB, o); if (!got) throw 0; toast("Imported " + got); }
    commit();
  }).catch(() => toast("This file isn't a backup the app can read")).finally(() => { input.value = ""; });
}

render(html`<${App}/>`, document.getElementById("root"));
if ("serviceWorker" in navigator && location.protocol !== "file:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
