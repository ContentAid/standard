"use strict";
const { html, render, useState, useEffect, useReducer, useRef } = htmPreact;
const { PROGRAM, MEALS, ALIAS } = window.DATA;

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const BIG_JUMP = /squat|deadlift|leg press|romanian/i;
// Name -> program row, so any logged exercise can find its rep range, rest and muscle.
const EX = {}; Object.values(PROGRAM).forEach((d) => d.ex.forEach((e) => { EX[e[0]] = e; }));
Object.values(PROGRAM).forEach((d) => d.ex.forEach((e) => { if (e[7] && !EX[e[7]]) EX[e[7]] = [e[7], ...e.slice(1,7), e[0]]; }));
delete PROGRAM.Sun; // six training days; old Sunday logs stay in the history

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
function save(){ try { localStorage.setItem(LS, JSON.stringify(DB)); saveOk = true; } catch(e){ saveOk = false; } }

/* ================= daily backup file ================= */
// No tokens anywhere: on the first tap of each day the app saves standard-DATE.json to Downloads, and Syncthing on the phone carries it to the laptop.
const BK = LS + "-backup";
function dailyBackup(){
  try {
    const day = today();
    if (localStorage.getItem(BK) === day || (!DB.lifts.length && !Object.keys(DB.food).length && !DB.bw.length)) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], {type:"application/json"}));
    a.download = "standard-"+day+".json"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    localStorage.setItem(BK, day); DB.lastExport = Date.now(); save();
  } catch(e){}
}
addEventListener("pointerdown", dailyBackup);
save();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}

/* ================= food: four meals, two sliders each ================= */
const foodList = (k) => DB.food[k] || [];
const totals = (k) => foodList(k).reduce((t,f) => (t.k += f.k*f.q, t.p += f.p*f.q, t), {k:0, p:0});
const MEAL = [["breakfast","Breakfast","sunrise"],["lunch","Lunch","sun"],["dinner","Dinner","moon"],["snack","Snack","apple"]];
const mealRec = (k, id) => foodList(k).find((f) => f.slot === id);
const mealVal = (id) => { const f = mealRec(today(), id); return f ? {p:f.p*f.q, k:f.k*f.q} : {p:0, k:0}; };
// One entry per meal per day; zero on both sliders removes it. Older days keep their dish-by-dish entries, which still count in totals().
function setMeal(id, p, kc, name){
  const k = today(), list = DB.food[k] || (DB.food[k] = []), f = mealRec(k, id);
  if (!p && !kc) { if (f) list.splice(list.indexOf(f), 1); }
  else if (f) { f.p = p; f.k = kc; f.q = 1; if (name) f.n = name; }
  else list.push({n:name || MEAL.find((m) => m[0] === id)[1], p, k:kc, q:1, slot:id});
  save();
}
const slotOpts = (slot, opts) => {
  for (let i = 1; i < 21; i++) { const f = mealRec(key(addDays(new Date(),-i)), slot); if (f) { const o = opts.find((x) => x[0] === f.n); if (o) return [o, ...opts.filter((x) => x !== o)]; } }
  return opts;
};
// Usual dishes: the plan's options, the one you ate last time first.
function usual(id){
  const opts = (i) => MEALS.find((m) => m[0] === i)[3];
  return (id === "snack" ? [...opts("cardio"), ...opts("bed")] : slotOpts(id, opts(id))).slice(0, 3);
}
// Today's calories: the target, less a third of what the last 3 logged days went over it. Never more than 300 less, never under 1500. Protein stays fixed.
function kcalTarget(){
  let over = 0;
  for (let i = 1; i <= 3; i++) { const t = totals(key(addDays(new Date(), -i))); if (t.k) over += t.k - DB.set.k; }
  const raw = Math.max(0, over/3), adj = Math.min(300, Math.round(raw/10)*10);
  return {t: Math.min(DB.set.k, Math.max(1500, DB.set.k - adj)), adj, over: Math.round(over), behind: raw > 300};
}

/* ================= training ================= */
const isDone = (x) => x.done && (num(x.w) > 0 || num(x.r) > 0);
function lastPerf(name, exclude){
  for (let i = DB.lifts.length-1; i >= 0; i--) {
    const s = DB.lifts[i]; if (s === exclude) continue;
    const ex = s.exercises.find((e) => e.name === name);
    if (ex) { const sets = ex.sets.filter(isDone); if (sets.length) return {date:s.date, sets, deload:s.deload}; }
  }
  return null;
}
const sessionBest = (e) => e.sets.reduce((b,x) => isDone(x) && num(x.w) ? Math.max(b, epley(num(x.w), num(x.r))) : b, 0);
function e1History(name){
  return DB.lifts.map((s) => { const e = s.exercises.find((x) => x.name === name); const b = e ? sessionBest(e) : 0; return b ? {x:s.date, y:r1(b)} : null; }).filter(Boolean);
}
function stalled(name){ const h = e1History(name); if (h.length < 4) return false; return Math.max(...h.slice(-3).map((p) => p.y)) <= h[h.length-4].y; }
// Heavy compounds start with the top set and step down; isolation and bodyweight stay flat.
const ISO = /curl|extension|pushdown|crunch|raise|fly|face pull|skull|knee raise/i;
const isHeavy = (e) => !ISO.test(e[0]) && repRange(e[2])[1] <= 10;
// Double progression off the top set: every top set at the top of the rep range, last time, adds weight.
function prescribe(e, rec){
  const [lo, hi] = repRange(e[2]), inc = BIG_JUMP.test(e[0]) ? 5 : 2.5;
  let last = lastPerf(e[0], rec), from = null;
  if (!last && e[7] && (last = lastPerf(e[7], rec))) from = e[7];
  let w = null, r = lo, why = `New exercise: pick a weight you can lift ${lo}–${hi} times with 1–2 reps to spare.`, up = false;
  if (last) {
    const top = Math.max(...last.sets.map((x) => num(x.w)));
    const work = last.sets.filter((x) => num(x.w) === top);
    if (last.deload) { w = round25(top/.9); r = lo; why = "Back from a deload: your last heavy weight."; }
    else if (top && last.sets.length >= e[1] && work.every((x) => num(x.r) >= hi)) { w = top+inc; r = lo; up = true; why = `Last time every top set hit ${hi} reps, so add ${inc} kg.`; }
    else if (top) { w = top; r = Math.min(hi, Math.max(...work.map((x) => num(x.r))) + 1); why = `Same weight as last time. Get ${hi} reps on the top set to earn +${inc} kg.`; }
    else { r = Math.min(hi, Math.max(...last.sets.map((x) => num(x.r))) + 1); why = `Bodyweight: aim for ${r} reps.`; }
    if (from) { up = false; why = `First time: started from your ${from} numbers. Adjust after set 1.`; }
    if (stalled(e[0])) why += " No progress in 3 sessions: slow the lowering to 3 seconds.";
  }
  return {w, r, lo, hi, sets:e[1], why, up};
}
function buildSession(day){
  const rec = {date:today(), day, ts:Date.now(), exercises:[]};
  rec.exercises = PROGRAM[day].ex.map((e) => { const p = prescribe(e, rec), heavy = isHeavy(e) && p.w;
    return {name:e[0], sets:Array.from({length:p.sets}, (_, k) => ({w: p.w ? (heavy ? round25(p.w*(1-.1*k)) : p.w) : 0, r: p.r + (heavy ? k : 0), done:false}))}; });
  return rec;
}
// Today's session lives only in memory until the first edit or tick, so opening the Gym tab never writes a workout.
let draft = null;
function session(day){
  const k = today(), r = DB.lifts.find((s) => s.date === k && s.day === day);
  if (r) return r;
  if (!draft || draft.date !== k || draft.day !== day) draft = buildSession(day);
  return draft;
}
const keep = (rec) => { if (!DB.lifts.includes(rec)) DB.lifts.push(rec); };
// Changing a set's weight moves the later sets you have not ticked by the same amount, so the step-down shape survives.
function bump(day, i, k, f, d){
  const rec = session(day), S = rec.exercises[i].sets; keep(rec);
  const cur = num(S[k][f]), v = Math.max(0, r1(cur + d)), step = v - cur; S[k][f] = v;
  if (f === "w") for (let m = k+1; m < S.length; m++) if (!S[m].done) S[m].w = Math.max(0, r1(num(S[m].w) + step));
  commit();
}
function tick(day, i, k){ const rec = session(day); keep(rec); const x = rec.exercises[i].sets[k]; x.done = !x.done; buzz(12); commit(); }
const setsDone = (rec) => rec.exercises.reduce((a,e) => a + e.sets.filter(isDone).length, 0);
const setsTotal = (rec) => rec.exercises.reduce((a,e) => a + e.sets.length, 0);
// Rough session length: sets x (40 s work + rest).
const minutes = (day) => Math.round(PROGRAM[day].ex.reduce((a,e) => a + e[1]*(40 + restSec(e[3])), 0) / 60 / 5) * 5;

/* ================= theme ================= */
// Dark by default. index.html applies the saved choice before first paint; "auto" follows the phone.
const theme = () => { try { return localStorage.getItem("standard-theme") || "dark"; } catch(e){ return "dark"; } };
function setTheme(t){
  try { localStorage.setItem("standard-theme", t); } catch(e){}
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
  // Auto puts back the two media-matched colors from index.html (light first, dark second).
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => {
    const s = t === "auto" ? ["light","dark"][i] : t;
    m.content = s === "dark" ? "#15130f" : "#f6f1e7";
    if (t === "auto") m.media = `(prefers-color-scheme: ${s})`; else m.removeAttribute("media");
  });
}

/* ================= shell ================= */
let rerender = () => {};
const commit = () => { save(); rerender(); };
let toastMsg = "", toastT = 0;
function toast(m){ toastMsg = m; toastT = Date.now(); rerender(); setTimeout(() => { if (Date.now() - toastT >= 2100) { toastMsg = ""; rerender(); } }, 2200); }
const Ic = ({n, c}) => html`<svg class=${"ic" + (c ? " " + c : "")} aria-hidden="true"><use href=${"#i-" + n}/></svg>`;
const hr = new Date().getHours();
let mealTab = hr < 11 ? 0 : hr < 16 ? 1 : hr < 21 ? 2 : 3; // the meal tab follows the clock

function App(){
  const [, force] = useReducer((x) => x+1, 0);
  rerender = force;
  const [tab, setTab] = useState("today");
  const [page, setPage] = useState(null);
  useEffect(() => {
    const vis = () => { if (!document.hidden) force(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  const go = (t) => { setTab(t); setPage(null); scrollTo(0,0); };
  const nav = {go, settings: () => { setPage("settings"); scrollTo(0,0); }, back: () => { setPage(null); scrollTo(0,0); }};
  const body = page === "settings" ? html`<${Settings} nav=${nav}/>` : {today:html`<${Today} nav=${nav}/>`, gym:html`<${Gym} nav=${nav}/>`, prog:html`<${Progress}/>`}[tab];
  return html`
    <main class="wrap">${body}</main>
    <nav aria-label="Sections"><div>
      ${[["today","Today","home"],["gym","Gym","gym"],["prog","Progress","chart"]].map(([t,l,i]) => html`
        <button class=${tab === t ? "on" : ""} onClick=${() => go(t)} aria-current=${tab === t ? "page" : null}><span class="pi"><${Ic} n=${i}/></span>${l}</button>`)}
    </div></nav>
    <div class=${"toast" + (toastMsg ? " show" : "")} role="status" aria-live="polite">${toastMsg}</div>
    ${!saveOk && html`<div class="savewarn">This browser is blocking storage. Export your data from Settings.</div>`}`;
}

/* ================= Today ================= */
const lastW = () => DB.bw.length ? DB.bw[DB.bw.length-1] : null;
function Today({nav}){
  const k = today(), t = totals(k), S = DB.set, kt = kcalTarget(), day = dayName(k), P = PROGRAM[day];
  const lw = lastW(), logged = lw && lw.date === k;
  const setW = (v) => { v = num(v); if (v > 20 && v < 300) { addBw(DB, k, r1(v)); commit(); } };
  const m = MEAL[mealTab], mv = mealVal(m[0]), pMax = Math.max(100, mv.p), kMax = Math.max(1200, mv.k);
  const other = t.k - MEAL.reduce((a, x) => a + mealVal(x[0]).k, 0), otherP = t.p - MEAL.reduce((a, x) => a + mealVal(x[0]).p, 0);
  const rec = P && DB.lifts.find((s) => s.date === k && s.day === day), n = rec ? setsDone(rec) : 0;
  const lp = S.p - t.p, lk = kt.t - t.k;
  return html`
    <div class="head"><div><div class="sub">${new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})}</div><h1>Today</h1></div>
      <button class="gear" onClick=${nav.settings} aria-label="Settings"><${Ic} n="gear"/></button></div>
    <div class="wt"><span class="sub"><${Ic} n="scale"/>Weight</span>
      <span class="wv"><button class="sb" aria-label="0.1 kg less" disabled=${!lw} onClick=${() => lw && setW(lw.kg - .1)}>−</button>
        <input type="number" inputmode="decimal" step="0.1" value=${lw ? lw.kg.toFixed(1) : ""} placeholder="0.0" onChange=${(e) => setW(e.target.value)} aria-label="Weight in kg"/><span class="u">kg</span>
        <button class="sb" aria-label="0.1 kg more" disabled=${!lw} onClick=${() => lw && setW(lw.kg + .1)}>+</button></span>
      ${logged ? html`<span class="okdot" aria-label="Logged today"><${Ic} n="check"/></span>` : html`<button class="chip ic-l" disabled=${!lw} onClick=${() => lw && setW(lw.kg)}><${Ic} n="plus"/>Log</button>`}</div>
    <div class="two">
      <div class=${"big" + (lp <= 0 ? " hit" : "")}><span class="l top"><${Ic} n="protein"/>Protein</span><b>${Math.round(t.p)}</b><span class="of">of ${S.p} g</span>
        <div class="meter"><i style=${`width:${Math.min(100, 100*t.p/S.p)}%`}></i></div><span class="left">${lp > 0 ? Math.round(lp) + " g left" : "Protein hit"}</span></div>
      <div class=${"big" + (lk < 0 ? " over" : "")}><span class="l top"><${Ic} n="flame"/>Calories</span><b>${Math.round(t.k).toLocaleString()}</b><span class="of">of ${kt.t.toLocaleString()} kcal</span>
        <div class="meter"><i style=${`width:${Math.min(100, 100*t.k/kt.t)}%`}></i></div><span class="left">${lk >= 0 ? Math.round(lk).toLocaleString() + " kcal left" : Math.round(-lk).toLocaleString() + " kcal over"}</span></div>
    </div>
    <p class="why2">${kt.adj ? html`<b>Target today: ${kt.t.toLocaleString()} kcal.</b> You were ${kt.over} over across the last 3 days, so it comes down ${kt.adj}${kt.behind ? ". That's the most it takes in one day: you're still a bit behind, so keep the next days tight" : " (never more than 300, never under 1,500)"}. Protein stays ${S.p} g.`
      : html`<b>Target today: ${kt.t.toLocaleString()} kcal.</b> You're on track, nothing to make up. Protein ${S.p} g.`}</p>
    <h2>What did you eat?<small>drag, or tap a usual</small></h2>
    <div class="card">
      <div class="seg" role="tablist">${MEAL.map((x, i) => { const v = mealVal(x[0]); return html`<button role="tab" aria-selected=${i === mealTab} class=${i === mealTab ? "on" : ""} onClick=${() => { mealTab = i; rerender(); }}><${Ic} n=${x[2]}/>${x[1]}<small>${v.k ? Math.round(v.k) + " kcal" : "—"}</small></button>`; })}</div>
      <div class="chips">${usual(m[0]).map((o) => html`<button class="chip dish" onClick=${() => { setMeal(m[0], o[1], o[2], o[0]); rerender(); }}><b>${o[0]}</b><small>${o[1]} g · ${o[2]} kcal</small></button>`)}</div>
      <div class="sl"><div class="r"><span>Protein</span><b>${Math.round(mv.p)}<em>g</em></b></div>
        <input type="range" min="0" max=${pMax} step="5" value=${mv.p} aria-label=${m[1] + " protein"} onInput=${(e) => { setMeal(m[0], +e.target.value, mv.k); rerender(); }}/></div>
      <div class="sl"><div class="r"><span>Calories</span><b>${Math.round(mv.k)}<em>kcal</em></b></div>
        <input type="range" min="0" max=${kMax} step="50" value=${mv.k} aria-label=${m[1] + " calories"} onInput=${(e) => { setMeal(m[0], mv.p, +e.target.value); rerender(); }}/></div>
    </div>
    <div class="card rows" style="margin-top:10px">
      ${MEAL.map((x) => { const v = mealVal(x[0]); return html`<div class="row"><span>${x[1]}</span><b>${v.p || v.k ? `${Math.round(v.p)} g · ${Math.round(v.k)} kcal` : "not logged"}</b></div>`; })}
      ${other > 1 && html`<div class="row"><span>Other</span><b>${Math.round(otherP)} g · ${Math.round(other)} kcal</b></div>`}
    </div>
    <h2>Gym<small>${P ? `${day} · ${P.title}` : "Rest day"}</small></h2>
    ${P ? html`<div class="start"><div><b>${P.title}</b><span class="sub">${n ? `${n} of ${setsTotal(rec)} sets done` : `${P.ex.length} exercises · about ${minutes(day)} min`}</span></div>
      <button class="btn ic-l" onClick=${() => nav.go("gym")}><${Ic} n="gym"/>${n ? "Continue" : "Start"}</button></div>`
      : html`<div class="start"><div><b>Rest day</b><span class="sub">Eat, sleep, back on Monday.</span></div></div>`}`;
}

/* ================= Gym ================= */
function Gym({nav}){
  const day = dayName(today()), P = PROGRAM[day];
  if (!P) return html`<h1>Rest day</h1><div class="card"><p>No session today. The next one is Monday.</p></div>`;
  const rec = session(day), n = setsDone(rec), tot = setsTotal(rec);
  return html`
    <div class="sub">${day} · ${P.title}</div><h1>Gym</h1>
    <p class="sub" style="margin:-6px 4px 8px">Every set is pre-filled. Tick each one. Change a weight and the sets after it follow.</p>
    <div class="prog"><div class="sub"><span>${n} of ${tot} sets</span><span>about ${minutes(day)} min</span></div><div class="bar"><i style=${`width:${100*n/tot}%`}></i></div></div>
    ${rec.exercises.map((x, i) => { const e = EX[x.name], heavy = e && isHeavy(e), why = e ? prescribe(e, rec).why : "";
      return html`<div class=${"ex" + (x.sets.every(isDone) ? " done" : "")}>
        <div class="n">${x.name}${heavy ? html`<span class="pill heavy"><${Ic} n="bolt"/>Heavy</span>` : html`<span class="pill"><${Ic} n="steady"/>Steady</span>`}</div>
        <div class="why">${heavy ? "Top set first, then lighter. " : "Same weight every set. "}${why}</div>
        ${x.sets.map((s, k) => html`<div class=${"set" + (s.done ? " sd" : "")}><span class="sn">${k+1}</span>
          <div class="step"><button aria-label="Less weight" onClick=${() => bump(day, i, k, "w", -2.5)}>−</button><div>${fmt(num(s.w))}<small>kg</small></div><button aria-label="More weight" onClick=${() => bump(day, i, k, "w", 2.5)}>+</button></div>
          <div class="step"><button aria-label="Fewer reps" onClick=${() => bump(day, i, k, "r", -1)}>−</button><div>${num(s.r)}<small>reps</small></div><button aria-label="More reps" onClick=${() => bump(day, i, k, "r", 1)}>+</button></div>
          <button class="tick" aria-label=${`Set ${k+1} done`} aria-pressed=${!!s.done} onClick=${() => tick(day, i, k)}><${Ic} n="check"/></button></div>`)}
      </div>`; })}
    <button class="btn ic-l" style="width:100%;margin-top:8px;padding:16px;display:flex" disabled=${!n} onClick=${() => { toast(`Saved ${n} sets. Next time the weights come up by themselves.`); nav.go("today"); }}><${Ic} n="check"/>${n === tot ? "Finish workout" : "Finish early"}</button>`;
}

/* ================= Progress ================= */
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
// The goal lives in Settings only (this repo is public): kg and date are 0 and "" until set.
const goalOf = () => ({kg: DB.set.goalKg || 0, date: DB.set.goalDate || ""});
const ink = (o) => `style="fill:#1d1a16;opacity:${o}"`;
function weightSvg(avg, goal, wk){
  const W = 340, H = 150, px = 34, pr = 8, pt = 10, pb = 22, now = avg[avg.length-1];
  const t0 = parseKey(avg[0].x).getTime(), tn = parseKey(now.x).getTime(), t1 = Math.max(parseKey(goal.date).getTime(), tn + 7*864e5);
  const projEnd = wk != null ? now.y + wk * (t1 - tn) / (7*864e5) : null;
  const lo = Math.floor(Math.min(goal.kg - 1.2, ...avg.map((p) => p.y), projEnd == null ? Infinity : projEnd)), hi = Math.ceil(Math.max(goal.kg + .3, ...avg.map((p) => p.y)) + .3);
  const X = (t) => px + (W-px-pr) * (t - t0) / (t1 - t0), Y = (v) => pt + (H-pt-pb) * (hi - v) / (hi - lo), sd = (k) => short(k);
  let s = "";
  for (let v = lo + (hi-lo > 6 ? 2 : 1); v < hi; v += hi-lo > 6 ? 2 : 1) s += `<line x1="${px}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#000" stroke-opacity=".12"/><text class="ax" x="${px-6}" y="${Y(v)+3}" text-anchor="end" ${ink(.55)}>${v}</text>`;
  s += `<line x1="${px}" x2="${W-pr}" y1="${Y(goal.kg)}" y2="${Y(goal.kg)}" stroke="#2f7d4f" stroke-width="1.5"/><text x="${px+4}" y="${Y(goal.kg)-5}" font-size="10" font-weight="700" fill="#2f7d4f">goal ${fmt(goal.kg)} · ${sd(goal.date)}</text>`;
  s += `<line x1="${px}" x2="${W-pr}" y1="${Y(goal.kg-1)}" y2="${Y(goal.kg-1)}" stroke="#2f7d4f" stroke-opacity=".45" stroke-dasharray="3 4"/><text x="${px+4}" y="${Y(goal.kg-1)+12}" font-size="10" fill="#2f7d4f" fill-opacity=".85">stretch ${fmt(goal.kg-1)}</text>`;
  const raw = DB.bw.slice(-120);
  s += `<polyline points="${raw.map((b) => X(parseKey(b.date).getTime()) + "," + Y(b.kg)).join(" ")}" fill="none" stroke="#1d1a16" stroke-opacity=".3" stroke-width="1.5"/>`;
  s += `<polyline points="${avg.map((p) => X(parseKey(p.x).getTime()) + "," + Y(p.y)).join(" ")}" fill="none" stroke="#e2531f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (projEnd != null) s += `<line x1="${X(tn)}" y1="${Y(now.y)}" x2="${X(t1)}" y2="${Y(projEnd)}" stroke="#e2531f" stroke-width="2" stroke-dasharray="5 6" stroke-opacity=".75"/>`;
  s += `<circle cx="${X(tn)}" cy="${Y(now.y)}" r="5" fill="#e2531f" stroke="#f5efe4" stroke-width="2"/>`;
  s += `<text class="ax" x="${px}" y="${H-6}" text-anchor="start" ${ink(.55)}>${sd(avg[0].x)}</text><text class="ax" x="${W-pr}" y="${H-6}" text-anchor="end" ${ink(.55)}>${sd(goal.date)}</text>`;
  return s;
}
const WEEKDAYS = ["M","T","W","T","F","S"];
function Progress(){
  const avg = bwAvg(), S = DB.set, goal = goalOf(), tk = today(), mon = mondayOf(new Date());
  const hasGoal = goal.kg && goal.date, now = avg[avg.length-1], wk = pace(avg), weekKeys = Array.from({length:6}, (_, j) => key(addDays(mon, j)));
  const gymDay = (k) => DB.lifts.some((s) => s.date === k && s.exercises.some((e) => e.sets.some(isDone)));
  const pLvl = (k) => { const p = totals(k).p; return p >= S.p ? 2 : p >= S.p*.8 ? 1 : 0; };
  const kLvl = (k) => { const c = totals(k).k; return !c ? 0 : c <= S.k ? 2 : c <= S.k*1.1 ? 1 : 0; };
  const past = weekKeys.filter((k) => k <= tk);
  const n = (f) => past.filter((k) => f(k) === 2 || f(k) === true).length;
  // A lift went up when this week's best estimated max beats everything before Monday.
  const mk = key(mon), trained = [...new Set(DB.lifts.filter((s) => s.date >= mk).flatMap((s) => s.exercises.filter((e) => e.sets.some(isDone) && sessionBest(e)).map((e) => e.name)))];
  const up = trained.filter((nm) => { const h = e1History(nm); const before = h.filter((p) => p.x < mk).map((p) => p.y), now = h.filter((p) => p.x >= mk).map((p) => p.y); return before.length && Math.max(...now) > Math.max(...before); }).length;
  const dots = (a, t) => html`<div class="dots">${Array.from({length:t}, (_, i) => html`<i class=${i < a ? "on" : ""}></i>`)}</div>`;
  const win = (ic, a, t, l) => html`<div class="win"><${Ic} n=${ic}/><b>${a}${t ? html`<em> / ${t}</em>` : ""}</b><span>${l}</span>${t ? dots(a, t) : dots(a, Math.max(trained.length, a, 1))}</div>`;
  const row = (l, f) => html`<span>${l}</span>${weekKeys.map((k) => { const v = k > tk ? 0 : f(k); return html`<i class=${v === 2 || v === true ? "ok" : v === 1 ? "part" : ""}></i>`; })}`;
  // protein bars, last 14 days
  const pv = Array.from({length:14}, (_, j) => { const k = key(addDays(new Date(), j-13)); return {k, v:Math.round(totals(k).p)}; });
  const pmax = Math.max(S.p*1.2, ...pv.map((d) => d.v)), psc = 90/pmax, base = 108, bw = 15, gap = 8.6;
  let p = `<line x1="0" x2="340" y1="${base-S.p*psc}" y2="${base-S.p*psc}" stroke="var(--mute)" stroke-opacity=".5" stroke-dasharray="4 4"/><text class="ax" x="338" y="${base-S.p*psc-4}" text-anchor="end">${S.p} g</text>`;
  pv.forEach((d, i) => { const h = d.v*psc, bx = 4+i*(bw+gap), hit = d.v >= S.p; if (h > 0) p += `<path d="M${bx},${base} v${-(Math.max(h,4)-4)} a4,4 0 0 1 4,-4 h${bw-8} a4,4 0 0 1 4,4 v${Math.max(h,4)-4} z" fill="${hit ? "var(--ok)" : "var(--bar)"}"><title>${d.v} g</title></path>`; if (i%3 === 0 || i === 13) p += `<text class="ax" x="${bx+bw/2}" y="${base+14}" text-anchor="middle">${parseKey(d.k).getDate()}</text>`; });
  // strength: estimated best single for the four key lifts
  const ago = key(addDays(new Date(), -28)), L = KEY_LIFTS.map(([nm, label]) => { const h = e1History(nm); if (!h.length) return null; const best = Math.max(...h.map((q) => q.y)), before = h.filter((q) => q.x <= ago).map((q) => q.y); return {label, best, d: before.length ? best - Math.max(...before) : null, pts:h.slice(-8)}; }).filter(Boolean);
  const spark = (pts) => { if (pts.length < 2) return ""; const mn = Math.min(...pts.map((q) => q.y)), mx = Math.max(...pts.map((q) => q.y)); return `<polyline points="${pts.map((q, i) => `${(i*100/(pts.length-1)).toFixed(1)},${(30 - 26*(q.y-mn)/((mx-mn)||1)).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`; };
  // weekly volume: kg lifted, thousands, last 6 weeks
  const vol = Array.from({length:6}, (_, i) => { const a = key(addDays(mon, (i-5)*7)), b = key(addDays(mon, (i-4)*7)); return r1(DB.lifts.filter((s) => s.date >= a && s.date < b).reduce((t, s) => t + s.exercises.reduce((u, e) => u + e.sets.filter(isDone).reduce((v, x) => v + num(x.w)*num(x.r), 0), 0), 0) / 1000); });
  const vmax = Math.max(...vol, 1); let v = "";
  vol.forEach((t, i) => { const h = Math.max(t/vmax*70, t ? 4 : 0), bx = 14+i*54, last = i === 5; if (h) v += `<path d="M${bx},90 v${-(h-4)} a4,4 0 0 1 4,-4 h32 a4,4 0 0 1 4,4 v${h-4} z" fill="${last ? "var(--acc)" : "var(--bar)"}"/><text class="ax" x="${bx+20}" y="${90-h-5}" text-anchor="middle" style="fill:var(--ink2);font-size:11px;font-weight:700">${t.toFixed(1)}</text>`; v += `<text class="ax" x="${bx+20}" y="104" text-anchor="middle">${last ? "this wk" : "wk " + (i+1)}</text>`; });
  const need = now && hasGoal ? (now.y - goal.kg) / Math.max(1/7, (parseKey(goal.date) - parseKey(tk)) / (7*864e5)) : null, togo = now && hasGoal ? now.y - goal.kg : null;
  return html`<h1>Progress</h1>
    <div class="hero">
      <span class="l">${hasGoal ? `Cut · goal ${fmt(goal.kg)} kg by ${short(goal.date)}` : "Cut · set a goal weight and date in Settings"}</span>
      ${now ? html`<b>${fmt(now.y)} kg</b>
        ${avg.length > 1 && html`<span class="tr"><${Ic} n=${now.y <= avg[0].y ? "down" : "trend"}/>${now.y <= avg[0].y ? "−" : "+"}${fmt(Math.abs(now.y - avg[0].y))} kg since ${short(avg[0].x)}</span>`}
        <span class="s">${!hasGoal ? "Your weight trend shows here. Add the goal to see the pace you need." : togo <= 0 ? "Goal weight reached." : `${fmt(togo)} kg to go · ${wk == null ? "pace shows after a week of weigh-ins" : `${wk > 0 ? "+" : "−"}${fmt(Math.abs(wk))} kg/week so far`}${need > 0 ? ` · needs −${fmt(need)} to hit the date` : ""}`}</span>
        ${avg.length > 1 && hasGoal ? html`<svg class="ch" viewBox="0 0 340 150" role="img" aria-label="Weight trend and projection to goal" dangerouslySetInnerHTML=${{__html: weightSvg(avg, goal, wk)}}></svg>
          <div class="legend" style="opacity:.75"><span><i class="sw" style="background:#e2531f"></i>7-day average</span>${wk != null && html`<span>- - projection at your pace</span>`}</div>` : ""}`
      : html`<b>– kg</b><span class="s">Log your weight on Today to start the trend.</span>`}
    </div>
    <h2>Wins this week<small>Mon–Sat</small></h2>
    <div class="wins">${win("gym", n(gymDay), 6, "Gym days")}${win("protein", n((k) => pLvl(k) === 2), 6, `Protein ${S.p} g hit`)}${win("flame", n((k) => kLvl(k) === 2), 6, `Under ${S.k} kcal`)}${win("trend", up, 0, "Lifts that went up")}</div>
    <div class="card" style="margin-top:10px"><div class="week"><span></span>${WEEKDAYS.map((d, i) => html`<span class=${"h" + (weekKeys[i] === tk ? " td" : "")}>${d}</span>`)}${row("Gym", (k) => gymDay(k) ? 2 : 0)}${row("Protein", pLvl)}${row("Calories", kLvl)}</div>
      <div class="legend"><span><i class="sw" style="background:var(--ok)"></i>Hit</span><span><i class="sw" style="background:color-mix(in srgb,var(--ok) 40%,var(--sunk))"></i>Close</span><span><i class="sw" style="background:var(--sunk)"></i>Missed or ahead</span></div></div>
    <h2>Protein<small>last 14 days</small></h2>
    <div class="card chartbox">${pv.some((d) => d.v) ? html`<svg viewBox="0 0 340 122" dangerouslySetInnerHTML=${{__html: p}}></svg>
      <div class="legend"><span><i class="sw" style="background:var(--ok)"></i>Hit ${S.p} g</span><span><i class="sw" style="background:var(--bar)"></i>Under</span></div>` : html`<p class="empty">Log a meal on Today and your protein days show here.</p>`}</div>
    <h2>Strength<small>est. best single, kg</small></h2>
    ${L.length ? html`<div class="lifts">${L.map((l) => html`<div class="lift"><div class="n">${l.label}</div><b>${fmt(l.best)} kg</b><div class="d">${l.d != null && l.d > 0 ? `+${fmt(l.d)} kg in 4 wk` : ""}</div><svg viewBox="0 0 100 34" preserveAspectRatio="none" dangerouslySetInnerHTML=${{__html: spark(l.pts)}}></svg></div>`)}</div>` : html`<div class="card"><p class="empty">Tick a few sets in the Gym and your lifts show here.</p></div>`}
    <h2>Weekly volume<small>kg lifted, thousands</small></h2>
    <div class="card chartbox">${vol.some((x) => x) ? html`<svg viewBox="0 0 340 112" dangerouslySetInnerHTML=${{__html: v}}></svg>` : html`<p class="empty">Shows after your first workout.</p>`}</div>`;
}
const KEY_LIFTS = [["Conventional Deadlift","Deadlift"],["Weighted Pull-up (med-wide)","Weighted pull-up"],["Barbell Flat Bench Press","Bench press"],["Barbell Back Squat","Squat"]];

/* ================= Settings ================= */
function Settings({nav}){
  const S = DB.set, fileRef = useRef(), [armed, setArmed] = useState(false), [armed2, setArmed2] = useState(false);
  const goal = goalOf();
  const setT = (f, v) => { if (num(v) > 0) { S[f] = num(v); save(); toast("Saved"); rerender(); } };
  return html`
    <button class="backbtn" onClick=${nav.back}><${Ic} n="back"/>Back</button>
    <h1>Settings</h1>
    <h2>Daily targets</h2>
    <section class="card list">
      ${[["p","Protein","g"],["k","Calories","kcal"]].map(([f,l,u]) => html`<label class="cell"><div class="grow"><b>${l}</b></div>
        <input class="inp" type="number" inputmode="numeric" value=${S[f]} onChange=${(e) => setT(f, e.target.value)}/><span class="unit">${u}</span></label>`)}
    </section>
    <h2>Goal</h2>
    <section class="card list">
      <label class="cell"><div class="grow"><b>Goal weight</b></div><input class="inp" type="number" inputmode="decimal" step="0.5" value=${goal.kg || ""} placeholder="kg" onChange=${(e) => setT("goalKg", e.target.value)}/><span class="unit">kg</span></label>
      <label class="cell"><div class="grow"><b>Goal date</b></div><input class="inp date" type="date" value=${goal.date} onChange=${(e) => { if (e.target.value) { S.goalDate = e.target.value; save(); toast("Saved"); rerender(); } }}/></label>
    </section>
    <h2>Look</h2>
    <section class="card list"><div class="cell"><div class="grow"><b>Theme</b></div>
      <div class="seg3">${[["dark","Dark"],["light","Light"],["auto","Auto"]].map(([v,l]) => html`<button class=${theme() === v ? "on" : ""} onClick=${() => { setTheme(v); rerender(); }}>${l}</button>`)}</div></div></section>
    <h2>Your data</h2>
    <section class="card list">
      <button class="cell" onClick=${exportData}><div class="grow"><b>Export backup</b><span class="d">Saves a .json file to your phone</span></div></button>
      <button class="cell" onClick=${() => fileRef.current.click()}><div class="grow"><b>Import</b><span class="d">A backup from this app, WrkTrack, Fitness Tracker or Daily Standard</span></div></button>
      ${hasSnap() && html`<button class="cell" onClick=${() => { if (!armed2) return setArmed2(true); DB = norm(JSON.parse(localStorage.getItem(LS+"-snap"))); save(); setArmed2(false); toast("Restored"); rerender(); }}><div class="grow"><b>${armed2 ? "Tap again to go back to this morning's copy" : "Undo today's changes"}</b><span class="d">Restores the copy saved when you first opened the app today</span></div></button>`}
      <button class="cell danger" onClick=${() => { if (!armed) return setArmed(true); DB = blank(); save(); setArmed(false); toast("All data deleted"); rerender(); }}><div class="grow"><b>${armed ? "Tap again to delete everything (back up first)" : "Delete all data"}</b></div></button>
    </section>
    <p class="foot">Your data stays on this phone. Once a day the app saves a backup file to Downloads (standard-DATE.json); Syncthing carries it off the phone. ${DB.lastExport ? `Last backup ${short(key(new Date(DB.lastExport)))}.` : "No backup yet."}</p>
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
