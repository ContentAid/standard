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
function blank(){ return {v:4, days:{}, food:{}, water:{}, bw:[], lifts:[], custom:[], set:{p:150, k:2200, w:8}}; }
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
  if (d.v < 4 && d.set.k === 2700) d.set.k = 2200; // v4: bulk -> cut
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
function save(){ try { localStorage.setItem(LS, JSON.stringify(DB)); saveOk = true; } catch(e){ saveOk = false; } }
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
  const last = lastPerf(e[0], rec);
  let sets = e[1], w = null, r = lo, why = `New exercise: pick a weight you can lift ${lo}–${hi} times with 1–2 reps to spare.`, up = false;
  if (last) {
    const top = Math.max(...last.sets.map((x) => num(x.w)));
    const work = last.sets.filter((x) => num(x.w) === top);
    if (last.deload) { w = round25(top/.9); r = lo; why = "Back from deload: your last heavy weight."; }
    else if (top && last.sets.length >= e[1] && work.every((x) => num(x.r) >= hi)) { w = top+inc; r = lo; up = true; why = `Last time every set hit ${hi} reps, so add ${inc} kg.`; }
    else if (top) { w = top; r = Math.min(hi, Math.max(...work.map((x) => num(x.r))) + 1); why = `Same weight as last time. Get ${hi} reps on every set to earn +${inc} kg.`; }
    else { r = Math.min(hi, Math.max(...last.sets.map((x) => num(x.r))) + 1); why = `Bodyweight: aim for ${r} reps.`; }
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
  const done = doneCount(k), st = streak(), gap = proteinPace() - t.p, wtr = DB.water[k] || 0;
  const todayBw = DB.bw.find((b) => b.date === k), prevBw = DB.bw.filter((b) => b.date < k).pop();
  const [bw, setBw] = useState(todayBw || !prevBw ? "" : String(prevBw.kg)); // yesterday's weight prefilled: one tap if unchanged
  const toggle = (h) => { const dd = editDay(k); if (dd.h[h.id]) delete dd.h[h.id]; else dd.h[h.id] = 1; buzz(10); commit(); };
  const trainDue = !ls.rest && ls.done < ls.tot;
  // Every meal not logged yet, in day order, each one tap. Shake only once training has started.
  const open = MEALS.filter(([id, , optional]) => !optional && !eaten(k, id) && (id !== "shake" || ls.done > 0 || ls.rest));
  return html`
    <${Title} title="Today" sub=${parseKey(k).toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})}
      right=${html`<div class="row">${st > 0 && html`<span class="streak" aria-label=${`${st} day streak`}><${Icon} n="flame" s=${16}/>${st}</span>`}
        <button class="iconbtn" onClick=${() => nav.open({kind:"settings"})} aria-label="Settings"><${Icon} n="gear" s=${21}/></button></div>`}/>

    <section class="card summary">
      <a class="sumrow" href="#habits"><span class="sl">Habits</span><span class="sv num"><b>${done}</b> / ${HABITS.length}</span><${Bar} v=${done} of=${HABITS.length} cls=${done >= MET ? "good" : ""}/></a>
      <button class="sumrow" onClick=${() => nav.go("food")}><span class="sl">Protein</span><span class="sv num"><b>${Math.round(t.p)}</b> / ${DB.set.p} g</span><${Bar} v=${t.p} of=${DB.set.p} cls=${t.p >= DB.set.p ? "good" : ""}/></button>
      <button class="sumrow" onClick=${() => { DB.water[k] = wtr + 1; buzz(10); commit(); }} aria-label="Add a glass of water"><span class="sl">Water</span><span class="sv num"><b>${wtr}</b> / ${DB.set.w} · tap +1</span><${Bar} v=${wtr} of=${DB.set.w} cls=${wtr >= DB.set.w ? "good" : ""}/></button>
      <button class="sumrow" onClick=${() => nav.go("train")}><span class="sl">Workout</span><span class="sv num">${ls.rest ? "Rest day" : html`<b>${ls.done}</b> / ${ls.tot} sets`}</span><${Bar} v=${ls.rest ? 1 : ls.done} of=${ls.rest ? 1 : ls.tot} cls=${ls.rest || ls.done >= ls.tot ? "good" : ""}/></button>
    </section>

    <h2 class="sh">Up next</h2>
    <section class="card list">
      ${trainDue && html`<div class="cell">
        <div class="grow"><b>${PROGRAM[ls.day].title}</b><span>${ls.done ? `${ls.done} of ${ls.tot} sets done` : `${PROGRAM[ls.day].ex.length} exercises · about ${minutes(ls.day)} min`}</span></div>
        <button class="btn primary" onClick=${() => nav.openGym()}>${ls.done ? "Resume" : "Start"}</button></div>`}
      ${open.map(([id, label, , opts]) => html`<div class="cell col">
        <div><b>${label}</b><span>Tap what you ate</span></div>
        <div class="chips">${slotOpts(id, opts).slice(0, 4).map((o) => html`<button class="chip" onClick=${() => { pickMeal(id, o); buzz(10); toast(`${label} logged · ${o[1]} g protein`); }}>${o[0]}<em>${o[1]} g</em></button>`)}
          <button class="chip" onClick=${() => nav.go("food")}>Other…</button></div></div>`)}
      ${gap > 20 && html`<div class="cell">
        <div class="grow"><b>${Math.round(gap)} g protein behind schedule</b><span>${TOPUPS[1].n}, ${TOPUPS[1].u}: +${TOPUPS[1].p} g</span></div>
        <button class="btn" onClick=${() => { addExtra(TOPUPS[1]); toast(`+${TOPUPS[1].p} g protein`); }}>Add</button></div>`}
      ${!trainDue && !open.length && gap <= 20 && html`<div class="cell"><div class="grow"><b>Nothing due</b><span>${ls.rest ? "Rest day" : "Workout done"} and meals logged.</span></div></div>`}
    </section>

    <div class="shrow" id="habits"><h2 class="sh">Habits</h2>
      <div class="seg" role="group" aria-label="Standard for today">${["full","bare"].map((m) => html`<button class=${d.m === m ? "on" : ""} aria-pressed=${d.m === m} onClick=${() => { editDay(k).m = m; commit(); }}>${m === "full" ? "Full" : "Bare minimum"}</button>`)}</div></div>
    <section class="card list">
      ${HABITS.map((h) => { const s = habitDone(k, h); return html`<button class=${"cell habit" + (s ? " on" : "")} onClick=${() => toggle(h)} aria-pressed=${!!s}>
        <span class="tick">${s && html`<${Icon} n="check" s=${16}/>`}</span>
        <span class="grow"><b>${h.name}</b><span>${h[d.m]}${h.auto === "protein" ? ` (${Math.round(DB.set.p * (d.m === "bare" ? .8 : 1))} g)` : ""}</span></span>
        ${s === "auto" && html`<span class="tag">From log</span>`}</button>`; })}
    </section>
    <p class="foot">${done >= MET ? "Today counts toward your streak." : `${MET - done} more to keep the streak. A day counts at 4 of 6.`}</p>

    ${(DB.lifts.length || Object.keys(DB.days).length) && (!DB.lastExport || Date.now() - DB.lastExport > 7*864e5) && html`<section class="card list backup"><div class="cell">
      <div class="grow"><b>Back up your data</b><span>${DB.lastExport ? `Last backup ${short(key(new Date(DB.lastExport)))}` : "No backup yet"}. Your logs live only on this phone.</span></div>
      <button class="btn" onClick=${exportData}>Back up</button></div></section>`}

    <h2 class="sh">Bodyweight</h2>
    <form class="card list" onSubmit=${(e) => { e.preventDefault(); if (!num(bw)) return toast("Enter your weight in kg"); addBw(DB, k, bw); toast(`Saved ${num(bw)} kg`); commit(); }}>
      <div class="cell">
        <div class="grow"><b>${todayBw ? `${todayBw.kg} kg today` : "Not logged today"}</b><span>${prevBw ? `Before: ${prevBw.kg} kg on ${short(prevBw.date)}` : "Weigh in after waking up"}</span></div>
        <input class="inp num" type="number" inputmode="decimal" step="0.1" placeholder="kg" value=${bw} onInput=${(e) => setBw(e.target.value)} aria-label="Bodyweight in kg"/>
        <button class="btn">Save</button></div>
    </form>`;
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
      <h2 class="sh">Today's targets</h2>
      <section class="card list">${p.ex.map((e) => { const pr = prescribe(e, preview); return html`
        <button class="cell" onClick=${() => nav.open({kind:"ex", name:e[0]})}>
          <div class="grow"><b>${e[0]}</b><span>${pr.sets} sets × ${e[2]} reps · ${e[6]}</span></div>
          <span class=${"val num" + (pr.up ? " pos" : "")}>${pr.w ? `${fmt(pr.w)} kg` : "New"}${pr.up ? html`<${Icon} n="up" s=${14}/>` : ""}</span><${Icon} n="chev" s=${16}/></button>`; })}</section>
      <p class="foot">Targets come from your last session. Tap an exercise for its history and form cue.</p>`}`;
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
    const shake = MEALS.find((m) => m[0] === "shake");
    return html`<div class="gym"><div class="gbody">
      <h1 class="gh">Workout saved</h1><p class="muted">${p.title} · ${longDate(rec.date)}</p>
      <section class="card stats3"><div><b class="num">${sets}</b><span>sets</span></div><div><b class="num">${Math.round(vol).toLocaleString()}</b><span>kg lifted</span></div><div><b class="num">${prs.length}</b><span>new bests</span></div></section>
      ${prs.length > 0 && html`<section class="card list">${prs.map((x) => html`<div class="cell"><span class="tag gold">PR</span><div class="grow"><b>${x}</b></div></div>`)}</section>`}
      ${shake && !eaten(today(), "shake") && html`<section class="card list"><div class="cell"><div class="grow"><b>Post-workout shake</b><span>${shake[3][0][0]} · ${shake[3][0][1]} g protein</span></div>
        <button class="btn" onClick=${() => { pickMeal("shake", shake[3][0]); toast("Shake logged"); force(); }}>Log</button></div></section>`}
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
function BarChart({data, target, unit, label}){
  const [sel, setSel] = useState(null);
  const W = 340, H = 150, P = {l:30, r:6, t:10, b:22};
  const max = Math.max(target || 0, ...data.map((d) => d.v)) * 1.1 || 1;
  const bw = (W - P.l - P.r) / data.length;
  const Y = (v) => H - P.b - (H - P.t - P.b) * v / max;
  const ticks = [0, Math.round(max/2/10)*10];
  const s = sel != null ? data[sel] : null;
  return html`<div class="chart">
    <p class="readout num" aria-live="polite">${s ? html`<b>${Math.round(s.v)} ${unit}</b> · ${s.label}` : html`<span class="muted">Tap a bar for the day's total</span>`}</p>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${label}>
      ${ticks.map((t) => html`<g><line x1=${P.l} x2=${W-P.r} y1=${Y(t)} y2=${Y(t)} class="grid"/><text x=${P.l-6} y=${Y(t)+3.5} text-anchor="end" class="ax">${t}</text></g>`)}
      ${data.map((d, j) => { const h = Math.max(d.v ? 3 : 0, (H - P.t - P.b) * d.v / max); return html`<g onClick=${() => setSel(sel === j ? null : j)} class="hit">
        <rect x=${P.l + j*bw} y=${P.t} width=${bw} height=${H-P.t-P.b} fill="transparent"/>
        <path class=${"bm" + (target && d.v >= target ? " met" : "") + (sel === j ? " sel" : "")} d=${barPath(P.l + j*bw + 2, Y(0), bw - 4, h)}/></g>`; })}
      ${target && html`<line x1=${P.l} x2=${W-P.r} y1=${Y(target)} y2=${Y(target)} class="target"/><text x=${P.l-6} y=${Y(target)+3.5} text-anchor="end" class="ax strong">${target}</text>`}
      ${data.map((d, j) => j % 2 ? null : html`<text x=${P.l + j*bw + bw/2} y=${H-6} text-anchor="middle" class="ax">${d.tick}</text>`)}
    </svg>
    ${target && html`<p class="legend"><i class="sw met"></i>Target hit <i class="sw"></i>Under target <i class="dash"></i>${target} ${unit} target</p>`}</div>`;
}

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

/* ================= Progress ================= */
function Progress({nav}){
  const [view, setView] = useState("overview");
  return html`<${Title} title="Progress"/>
    <div class="seg wide" role="tablist">${[["overview","Overview"],["strength","Strength"],["body","Body"]].map(([v,l]) => html`<button role="tab" aria-selected=${view === v} class=${view === v ? "on" : ""} onClick=${() => setView(v)}>${l}</button>`)}</div>
    ${view === "overview" && html`<${Overview}/>`}${view === "strength" && html`<${Strength} nav=${nav}/>`}${view === "body" && html`<${Body}/>`}`;
}
function Overview(){
  const now = new Date(), tk = today(), mon = mondayOf(now);
  const days7 = Array.from({length:7}, (_, j) => key(addDays(mon, j))).filter((k) => k <= tk);
  const wd = Object.keys(weekDone()).length;
  const avgP = days7.reduce((a,k) => a + totals(k).p, 0) / (days7.length || 1);
  const met = days7.filter(dayMet).length;
  const start = addDays(mon, -17*7);
  const cells = Array.from({length:18*7}, (_, j) => { const k = key(addDays(start, j)); if (k > tk) return {k, lv:"f"}; const d = dayRec(k); const c = legacy(d) ? Math.round(d.old*1.5) : doneCount(k); return {k, c, lv: c >= 6 ? 4 : c >= MET ? 3 : c >= 2 ? 2 : c >= 1 ? 1 : 0}; });
  const [cell, setCell] = useState(null);
  const pd = Array.from({length:14}, (_, j) => { const k = key(addDays(now, j-13)); return {v: totals(k).p, label: longDate(k), tick: parseKey(k).getDate()}; });
  return html`
    <h2 class="sh">This week</h2>
    <section class="card stats3">
      <div><b class="num">${wd}<small>/6</small></b><span>workouts</span></div>
      <div><b class="num">${Math.round(avgP)}<small> g</small></b><span>avg protein</span></div>
      <div><b class="num">${met}<small>/${days7.length}</small></b><span>habit days met</span></div>
    </section>
    <h2 class="sh">Habits, last 18 weeks</h2>
    <section class="card pad">
      <p class="readout num" aria-live="polite">${cell ? html`<b>${cell.lv === "f" ? "Upcoming" : `${cell.c} of 6 habits`}</b> · ${longDate(cell.k)}` : html`<span class="muted">Tap a day · streak ${streak()} days</span>`}</p>
      <div class="heat" role="img" aria-label="Habit calendar">${cells.map((c) => html`<button class=${"l"+c.lv + (c.k === tk ? " td" : "")} onClick=${() => setCell(c)} aria-label=${c.k}></button>`)}</div>
      <p class="legend">0 <span class="hl l0"></span><span class="hl l1"></span><span class="hl l2"></span><span class="hl l3"></span><span class="hl l4"></span> 6 habits</p><p class="hint">Each column is a week, Monday on top.</p>
    </section>
    <h2 class="sh">Protein, last 14 days</h2>
    <section class="card pad"><${BarChart} data=${pd} target=${DB.set.p} unit="g" label="Protein per day for the last 14 days"/></section>`;
}
function Strength({nav}){
  const ms = muscleSets();
  const names = [...new Set(DB.lifts.flatMap((s) => s.exercises.filter((e) => e.sets.some((x) => isDone(x) && num(x.w))).map((e) => e.name)))];
  const ago = key(addDays(new Date(), -28));
  const rows = names.map((n) => { const h = e1History(n), best = Math.max(...h.map((p) => p.y)); const before = h.filter((p) => p.x <= ago).map((p) => p.y); const was = before.length ? Math.max(...before) : null; return {n, best, d: was != null ? best - was : null, last: h[h.length-1].x}; }).sort((a,b) => a.last < b.last ? 1 : -1);
  const maxSets = Math.max(20, ...Object.values(ms), ...Object.values(PLANNED));
  return html`
    <h2 class="sh">Sets per muscle this week</h2>
    <section class="card pad">
      ${Object.keys(PLANNED).map((m) => html`<div class="mbar"><span class="mname">${m}</span>
        <div class="mtrack"><i style=${`width:${100*ms[m]/maxSets}%`}></i><em style=${`left:${100*PLANNED[m]/maxSets}%`}></em></div>
        <span class="num mval">${ms[m]}<small>/${PLANNED[m]}</small></span></div>`)}
      <p class="legend"><i class="sw met"></i>Done <i class="tickm"></i>Planned</p>
    </section>
    <h2 class="sh">Lifts</h2>
    <section class="card list">${rows.length ? rows.map((r) => html`<button class="cell" onClick=${() => nav.open({kind:"ex", name:r.n})}>
      <div class="grow"><b>${r.n}</b><span>Last done ${short(r.last)}</span></div>
      <span class="val num">${fmt(r.best)} kg<small class=${r.d > 0 ? "pos" : ""}>${r.d == null ? "est. 1RM" : `${r.d >= 0 ? "+" : ""}${fmt(r.d)} kg in 4 wk`}</small></span><${Icon} n="chev" s=${16}/></button>`)
      : html`<div class="cell"><div class="grow"><span>Log a workout to see your lifts here.</span></div></div>`}</section>`;
}
function Body(){
  const [bw, setBw] = useState("");
  const pts = DB.bw.slice(-90).map((b) => ({x:b.date, y:b.kg}));
  // Trailing 7-day average smooths out day-to-day water weight.
  const avg = pts.map((p) => { const t = parseKey(p.x).getTime(); const w = pts.filter((q) => { const d = (t - parseKey(q.x).getTime())/864e5; return d >= 0 && d < 7; }); return {x:p.x, y:w.reduce((a,q) => a+q.y, 0)/w.length}; });
  const last = pts[pts.length-1], ago = pts.filter((p) => p.x <= key(addDays(new Date(), -28))).pop();
  return html`
    <h2 class="sh">Bodyweight</h2>
    <form class="card list" onSubmit=${(e) => { e.preventDefault(); if (!num(bw)) return toast("Enter your weight in kg"); addBw(DB, today(), bw); setBw(""); toast("Saved"); commit(); }}>
      <div class="cell"><div class="grow"><b>Log today</b><span>Weigh in at the same time each morning.</span></div>
        <input class="inp num" type="number" inputmode="decimal" step="0.1" placeholder="kg" value=${bw} onInput=${(e) => setBw(e.target.value)} aria-label="Bodyweight in kg"/><button class="btn">Save</button></div></form>
    ${last && html`<section class="card stats3">
      <div><b class="num">${fmt(last.y)}<small> kg</small></b><span>latest</span></div>
      <div><b class="num">${ago ? `${last.y - ago.y >= 0 ? "+" : ""}${fmt(last.y - ago.y)}` : "–"}<small> kg</small></b><span>vs 4 weeks ago</span></div>
      <div><b class="num">${fmt(avg[avg.length-1].y)}<small> kg</small></b><span>7-day average</span></div></section>`}
    <section class="card pad"><${LineChart} pts=${pts} avg=${avg} unit="kg" label="Bodyweight, last 90 entries"/></section>`;
}

/* ================= Settings ================= */
function Settings({nav}){
  const S = DB.set, fileRef = useRef(), [armed, setArmed] = useState(false), [armed2, setArmed2] = useState(false);
  const setT = (f, v) => { if (num(v) > 0) { S[f] = num(v); save(); toast("Saved"); rerender(); } };
  return html`
    <button class="backbtn" onClick=${nav.back}><${Icon} n="back" s=${20}/>Back</button>
    <${Title} title="Settings"/>
    <h2 class="sh">Daily targets</h2>
    <section class="card list">
      ${[["p","Protein","g"],["k","Calories","kcal"],["w","Water","glasses"]].map(([f,l,u]) => html`<label class="cell"><div class="grow"><b>${l}</b></div>
        <input class="inp num" type="number" inputmode="numeric" value=${S[f]} onChange=${(e) => setT(f, e.target.value)}/><span class="unit">${u}</span></label>`)}
    </section>
    <h2 class="sh">Training</h2>
    <section class="card list"><label class="cell"><div class="grow"><b>Deload every 5th week</b><span>Half the sets at 90% weight</span></div>
      <input type="checkbox" class="switch" checked=${!S.deloadOff} onChange=${(e) => { S.deloadOff = !e.target.checked; commit(); }}/></label></section>
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
