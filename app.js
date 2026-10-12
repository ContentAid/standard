"use strict";
const { html, render, useState, useEffect, useReducer, useRef } = htmPreact;

/* ================= content ================= */
// PROGRAM, MENU, TOPUPS and FOODS live in data.js so the plan can change without touching logic.
const { PROGRAM, MENU, TOPUPS, FOODS, ITEMS_DEFAULT, QUOTES, ALIAS } = window.DATA;
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEK = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SLOTS = [ // [id, label, from hour, to hour]
  ["breakfast","Breakfast",6,11],["lunch","Lunch",11,16],["snack","Workout snack",16,19],["dinner","Dinner",19,22],["bed","Before bed",21,26]
];
const BIG_JUMP = /squat|deadlift|leg press|romanian|hip thrust/i;

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
const fmtDate = (k) => parseKey(k).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };
const dayName = (k) => DAYS[parseKey(k).getDay()];
const repRange = (s) => { const m = String(s).match(/(\d+)(?:-(\d+))?/); return m ? [+m[1], +(m[2]||m[1])] : [8,12]; };
const restSec = (s) => { const m = String(s).match(/(\d+)(?:-(\d+))?\s*(min|sec|s\b)/); if (!m) return 90; const v = m[2] ? +m[2] : +m[1]; return m[3] === "min" ? v*60 : v; };

/* ================= storage ================= */
const LS = "standard-v1";
function blank(){
  return {v:2, days:{}, food:{}, water:{}, bw:[], lifts:[], custom:[], swaps:{},
    set:{p:150, k:2700, w:8}, items:JSON.parse(JSON.stringify(ITEMS_DEFAULT))};
}
function norm(d){
  const b = blank();
  if (!d || typeof d !== "object") return b;
  for (const k in b) if (d[k] == null || typeof d[k] !== typeof b[k] || Array.isArray(d[k]) !== Array.isArray(b[k])) d[k] = b[k];
  d.set = Object.assign(b.set, d.set);
  if (!Array.isArray(d.items.full) || d.items.full.length !== 4) d.items = b.items;
  d.v = 2;
  renameOld(d);
  return d;
}
// Old WrkTrack names -> new program names, so progression reads the old history.
function renameOld(D){ D.lifts.forEach((s) => s.exercises.forEach((e) => { if (ALIAS[e.name]) e.name = ALIAS[e.name]; })); }
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
      // Old plan dishes are not in the new menu; keep the day's totals as one entry per checked meal.
      const old = window.DATA.OLD_MEALS;
      const items = [];
      old.forEach(([id, label, vs]) => { const s = o.meals[dk][id]; if (s && s.checked) { const v = vs[s.variantIdx||0] || vs[0]; items.push({n:v[0], k:v[2], p:v[1], q:1, u:label}); } });
      if (items.length) { D.food[dk] = items; n++; }
    }
    for (const dk in (o.water || {})) if (D.water[dk] == null) D.water[dk] = o.water[dk];
    got.push(n+" food days");
  }
  if (o.days && typeof o.days === "object" && !o.lifts) {
    let n = 0;
    for (const dk in o.days) if (!D.days[dk] && o.days[dk] && Array.isArray(o.days[dk].d)) { D.days[dk] = o.days[dk]; n++; }
    got.push(n+" habit days");
  }
  renameOld(D);
  D.lifts.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts||0)-(b.ts||0));
  return got.join(", ");
}
function load(){
  try { const raw = localStorage.getItem(LS); if (raw) return norm(JSON.parse(raw)); } catch(e){}
  const D = blank();
  ["daily-standard-v1","wtrack_v1","ft-v2"].forEach((k) => { try { absorb(D, JSON.parse(localStorage.getItem(k))); } catch(e){} });
  return D;
}
let DB = load();
let saveOk = true;
function save(){
  try { localStorage.setItem(LS, JSON.stringify(DB)); saveOk = true; }
  catch(e){ saveOk = false; }
}
save();
// Ask the browser not to evict this site's storage under pressure.
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}

/* ================= habits ================= */
const dayRec = (k) => DB.days[k] || null;
const editDay = (k) => DB.days[k] || (DB.days[k] = {m:"full", d:[0,0,0,0], a:0});
const dayScore = (d) => !d ? 0 : d.d.reduce((s,v) => s + (v ? (d.m === "bare" ? .5 : 1) : 0), 0);
function streak(){
  let n = 0, d = new Date();
  if (dayScore(dayRec(key(d))) < 2) d = addDays(d,-1);
  while (dayScore(dayRec(key(d))) >= 2) { n++; d = addDays(d,-1); }
  return n;
}

/* ================= food ================= */
const foodList = (k) => DB.food[k] || [];
const totals = (k) => foodList(k).reduce((t,f) => (t.k += f.k*f.q, t.p += f.p*f.q, t), {k:0, p:0});
// Today's dish for a slot: the menu's dish for this weekday, shifted by however many times it was swapped.
function dish(k, slot){
  const opts = MENU.map((d) => d.meals.find((m) => m.slot === slot)).filter(Boolean);
  const base = WEEK.indexOf(dayName(k)) % opts.length;
  const sw = (DB.swaps[k] || {})[slot] || 0;
  return opts[(base + sw) % opts.length];
}
const eaten = (k, slot) => foodList(k).find((f) => f.slot === slot);
function logFood(f, slot){
  const k = today(), list = DB.food[k] || (DB.food[k] = []);
  const e = !slot && list.find((x) => x.n === f.n && !x.slot);
  if (e) e.q += 1; else list.push({n:f.n, u:f.u||"", k:f.k, p:f.p, q:1, slot:slot||undefined});
  save();
}
function recentFoods(){
  const c = {}, last = {};
  for (let i = 0; i < 21; i++) foodList(key(addDays(new Date(),-i))).forEach((f) => { if (f.slot) return; c[f.n] = (c[f.n]||0)+1; last[f.n] = last[f.n] || f; });
  return Object.keys(c).sort((a,b) => c[b]-c[a]).slice(0,6).map((n) => last[n]);
}
// Expected protein by this hour, linear from 07:00 to 22:00.
function proteinPace(){ const h = new Date().getHours() + new Date().getMinutes()/60; return DB.set.p * Math.max(0, Math.min(1, (h-7)/15)); }

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
function bestE1(name, exclude){
  let b = 0;
  DB.lifts.forEach((s) => { if (s !== exclude) s.exercises.forEach((e) => { if (e.name === name) e.sets.forEach((x) => { if (isDone(x) && num(x.w)) b = Math.max(b, epley(num(x.w), num(x.r))); }); }); });
  return b;
}
function e1History(name){
  return DB.lifts.map((s) => { const e = s.exercises.find((x) => x.name === name); if (!e) return null; let b = 0; e.sets.forEach((x) => { if (isDone(x) && num(x.w)) b = Math.max(b, epley(num(x.w), num(x.r))); }); return b ? {x:s.date, y:r1(b)} : null; }).filter(Boolean);
}
// Week number of training, counted from the first logged session. Every 5th week is a deload.
function trainingWeek(){
  const first = DB.lifts.find((s) => s.exercises.some((e) => e.sets.some(isDone)));
  if (!first) return 1;
  return Math.floor((parseKey(today()) - parseKey(first.date)) / (7*864e5)) + 1;
}
const isDeloadWeek = () => DB.set.deloadOff ? false : trainingWeek() % 5 === 0;
// Stalled = best e1RM has not beaten the session three sessions back.
function stalled(name){ const h = e1History(name); if (h.length < 4) return false; const last3 = h.slice(-3).map((p) => p.y); return Math.max(...last3) <= h[h.length-4].y; }

// The coach's prescription for one exercise today: weight, rep target, sets, and why.
function prescribe(e, rec){
  const [lo, hi] = repRange(e[2]);
  const last = lastPerf(e[0], rec);
  let sets = e[1], w = null, r = lo, why = `First time: pick a weight you can lift ${lo}–${hi} times with 1–2 reps left.`, up = false;
  if (last && !last.deload) {
    const top = Math.max(...last.sets.map((x) => num(x.w)));
    const work = last.sets.filter((x) => num(x.w) === top);
    const inc = BIG_JUMP.test(e[0]) ? 5 : 2.5;
    if (top && last.sets.length >= e[1] && work.length === last.sets.length && work.every((x) => num(x.r) >= hi)) {
      w = top + inc; r = lo; up = true; why = `You hit ${hi} reps on every set. Add ${inc} kg.`;
    } else if (top) {
      w = top; r = Math.min(hi, Math.max(...work.map((x) => num(x.r))) + 1); why = `Same weight. Beat last time by one rep, aim for ${hi}.`;
    } else { r = Math.min(hi, Math.max(...last.sets.map((x) => num(x.r))) + 1); why = `Bodyweight. Aim for ${r}+ reps.`; }
    if (stalled(e[0])) why += " Stalled 3 sessions: slow the lowering to 3 s.";
  } else if (last) { w = Math.max(...last.sets.map((x) => num(x.w))) / .9; w = round25(w); why = "Back from deload: last heavy weight."; }
  const mode = rec && rec.ready;
  if (rec && rec.deload) { sets = Math.max(1, Math.ceil(sets/2)); if (w) w = round25(w*.9); why = "Deload week: half the sets, 90% weight, leave 3 reps in the tank."; }
  else if (mode === "rough") { sets = Math.max(1, sets-1); if (w) w = round25(w*.95); why = "Rough day: one set fewer, 5% lighter. Showing up is the win."; up = false; }
  return {w, r, lo, hi, sets, why, up, last};
}
function liftStatus(k = today()){
  const day = dayName(k);
  if (!PROGRAM[day]) return {day, rest:true};
  const rec = DB.lifts.find((s) => s.date === k && s.day === day);
  const tot = rec ? rec.exercises.reduce((a,e) => a + e.sets.length, 0) : PROGRAM[day].ex.reduce((a,e) => a + e[1], 0);
  const done = rec ? rec.exercises.reduce((a,e) => a + e.sets.filter(isDone).length, 0) : 0;
  return {day, rec, tot, done, finished: rec && rec.finished};
}
function newSession(day, ready){
  const rec = {date:today(), day, ts:Date.now(), ready, deload:isDeloadWeek(), exercises:[]};
  rec.exercises = PROGRAM[day].ex.map((e) => {
    const p = prescribe(e, rec);
    return {name:e[0], sets:Array.from({length:p.sets}, () => ({w:"", r:"", done:false}))};
  });
  DB.lifts.push(rec); save();
  return rec;
}
function weekDone(){
  const now = new Date(), mon = key(addDays(now, now.getDay() === 0 ? -6 : 1-now.getDay())), out = {};
  DB.lifts.forEach((s) => { if (s.date >= mon && s.exercises.some((e) => e.sets.some(isDone))) out[s.day] = 1; });
  return out;
}

/* ================= coach ================= */
// Item 2 ("Train + protein") ticks itself once both halves are true; the coach never unticks a manual tick.
function autoTick(){
  const k = today(), ls = liftStatus(k), t = totals(k);
  const trained = ls.rest || (ls.done > 0 && ls.done >= ls.tot*.75);
  if (trained && t.p >= DB.set.p*.95) { const d = editDay(k); if (!d.d[1]) { d.d[1] = 1; d.auto = 1; save(); return true; } }
  return false;
}
function nextActions(){
  const k = today(), h = new Date().getHours(), out = [];
  const ls = liftStatus(k), t = totals(k), d = dayRec(k) || {m:"full", d:[0,0,0,0]};
  if (h < 12 && !DB.bw.some((b) => b.date === k)) out.push({kind:"weigh", title:"Weigh in", sub:"Before food, after the bathroom."});
  if (!ls.rest && ls.done < ls.tot) {
    const p = PROGRAM[ls.day], first = p.ex[0], pr = prescribe(first, ls.rec || {ready:"normal", deload:isDeloadWeek()});
    out.push({kind:"lift", title: ls.done ? `Finish ${p.title}` : `Train ${p.title}`, sub: ls.done ? `${ls.done}/${ls.tot} sets in. Pick up where you left.` : `${p.ex.length} lifts · starts with ${first[0]}${pr.w ? ` at ${fmt(pr.w)} kg × ${pr.r}` : ""}`});
  }
  const slot = SLOTS.find(([id,,,to]) => !eaten(k,id) && h < to) || SLOTS.find(([id]) => !eaten(k,id));
  if (slot) { const m = dish(k, slot[0]); out.push({kind:"meal", slot:slot[0], title:`${slot[1]}: ${m.n}`, sub:`${m.p} g protein · ${m.k} kcal`, dish:m}); }
  const gap = proteinPace() - t.p;
  if (gap > 25) { const tp = TOPUPS[0]; out.push({kind:"topup", title:`${Math.round(gap)} g behind on protein`, sub:`Fix: ${tp.n} (${tp.u}) adds ${tp.p} g.`, food:tp}); }
  const items = DB.items[d.m];
  const open = d.d.map((v,i) => v ? -1 : i).filter((i) => i >= 0 && i !== 1);
  if (open.length) out.push({kind:"habit", idx:open[0], title:items[open[0]], sub:"Tap when done."});
  return out.slice(0,4);
}
function verdict(){
  const k = today(), d = dayRec(k), sc = dayScore(d), t = totals(k), ls = liftStatus(k);
  const liftOk = ls.rest || ls.done >= ls.tot;
  if (sc >= 4 && t.p >= DB.set.p*.95 && liftOk) return ["Day won.", "Everything that counts is in. Rest."];
  if (sc >= 2 && new Date().getHours() >= 21) return ["Streak safe.", "Bare minimum is met. Anything more is a bonus."];
  const h = new Date().getHours();
  if (h < 12) return ["Morning.", "Win the first block, then everything gets easier."];
  if (h < 18) return ["Keep going.", `${Math.round(t.p)} g protein so far. ${ls.rest ? "Rest day." : liftOk ? "Training done." : "Training still ahead."}`];
  return ["Close it out.", sc >= 2 ? "Streak is safe. Finish strong." : `${(2 - sc)} more point${2-sc === 1 ? "" : "s"} keeps the streak.`];
}

/* ================= app shell ================= */
let rerender = () => {};
const commit = () => { save(); rerender(); };
let toastMsg = "", toastT = 0;
function toast(m){ toastMsg = m; toastT = Date.now(); rerender(); setTimeout(() => { if (Date.now() - toastT >= 2100) { toastMsg = ""; rerender(); } }, 2200); }

const I = {
  today:"M3 10.7 12 3l9 7.7M5.5 9.6V21h13V9.6",
  train:"M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.8 12h10.4",
  food:"M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-2.5 5-2.5 8h3V21",
  progress:"M3 16.5 9 10.5l4 4 8-8.5M16 6h5v5",
  check:"M5 12.5l4.5 4.5L19 7.5",
  swap:"M4 8h13l-3-3M20 16H7l3 3",
  plus:"M12 5v14M5 12h14",
  minus:"M5 12h14",
  close:"M6 6l12 12M18 6 6 18",
  left:"M15 5l-7 7 7 7", right:"M9 5l7 7-7 7",
  flame:"M12 2.5c2.6 3 4.4 5.3 4.4 8.6a4.4 4.4 0 0 1-8.8 0c0-1.3.4-2.3 1.1-3.2.3 1.3 1.1 2.1 2.1 2.2-.7-2.8.7-5.2 1.2-7.6Z",
  scale:"M4 5h16v15H4zM9 10a3 3 0 0 1 6 0M12 10l1.5-1.5",
  bolt:"M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
};
const Icon = ({n, s=22}) => html`<svg class="i" viewBox="0 0 24 24" width=${s} height=${s} aria-hidden="true"><path d=${I[n]}/></svg>`;

function App(){
  const [, force] = useReducer((x) => x+1, 0);
  rerender = force;
  const [tab, setTab] = useState("today");
  const [gym, setGym] = useState(null); // {day} while the full-screen session is open
  useEffect(() => {
    const vis = () => { if (!document.hidden) force(); };
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(force, 60000);
    return () => { document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, []);
  useEffect(() => { if (autoTick()) toast("“Train + protein” ticked for you"); });
  const go = (t) => { setTab(t); scrollTo(0,0); };
  const openGym = (day) => setGym({day: day || dayName(today())});
  return html`
    ${gym ? html`<${Gym} day=${gym.day} close=${() => { setGym(null); force(); }}/>` : html`
    <main class="wrap">
      ${tab === "today" && html`<${Today} go=${go} openGym=${openGym}/>`}
      ${tab === "train" && html`<${Train} openGym=${openGym}/>`}
      ${tab === "food" && html`<${Food}/>`}
      ${tab === "progress" && html`<${Progress}/>`}
    </main>
    <nav class="nav"><div class="in">
      ${[["today","Today"],["train","Train"],["food","Food"],["progress","Progress"]].map(([t,l]) => html`
        <button class=${tab === t ? "on" : ""} onClick=${() => go(t)} aria-current=${tab === t ? "page" : null}><${Icon} n=${t} s=${23}/>${l}</button>`)}
    </div></nav>`}
    <div class=${"toast" + (toastMsg ? " show" : "")} role="status">${toastMsg}</div>
    ${!saveOk && html`<div class="savewarn">This browser is blocking storage. Export from Progress to keep your data.</div>`}`;
}

function Head({kicker, title, right}){
  const st = streak();
  return html`<header class="head"><div class="grow"><div class="kicker">${kicker}</div><h1>${title}</h1></div>
    ${right}${st > 0 && html`<div class="streak" title="Streak"><${Icon} n="flame" s=${17}/><b class="num">${st}</b></div>`}</header>`;
}

/* ================= Today ================= */
function Today({go, openGym}){
  const k = today(), d = dayRec(k) || {m:"full", d:[0,0,0,0], a:0}, sc = dayScore(d);
  const t = totals(k), ls = liftStatus(k), [vh, vs] = verdict(), acts = nextActions();
  const items = DB.items[d.m];
  const q = QUOTES[Math.floor(parseKey(k).getTime()/864e5) % QUOTES.length];
  const allow = [0,6].includes(parseKey(k).getDay()) ? 2 : 1;
  const [bw, setBw] = useState("");
  const act = (a) => {
    if (a.kind === "lift") openGym();
    else if (a.kind === "meal") { logFood(a.dish, a.slot); buzz(10); toast(`Logged ${a.dish.n}`); rerender(); }
    else if (a.kind === "topup") { logFood(a.food); buzz(10); toast(`+${a.food.p} g protein`); rerender(); }
    else if (a.kind === "habit") { editDay(k).d[a.idx] = 1; buzz(10); commit(); }
  };
  const actLabel = {lift: ls.done ? "Resume" : "Start", meal:"Ate it", topup:"Add", habit:"Done"};
  return html`
    <${Head} kicker=${parseKey(k).toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})} title=${vh}/>
    <p class="verdict">${vs}</p>
    <section class="meters">
      <div class="meter"><span class="lbl">Standard</span><b class="num">${sc % 1 ? sc.toFixed(1) : sc}<small>/4</small></b><i style=${`--p:${sc/4}`}></i></div>
      <div class="meter"><span class="lbl">Protein</span><b class="num">${Math.round(t.p)}<small>/${DB.set.p}</small></b><i style=${`--p:${Math.min(1,t.p/DB.set.p)}`}></i></div>
      <div class="meter"><span class="lbl">${ls.rest ? "Rest day" : "Training"}</span><b class="num">${ls.rest ? "—" : html`${ls.done}<small>/${ls.tot}</small>`}</b><i style=${`--p:${ls.rest ? 1 : ls.tot ? ls.done/ls.tot : 0}`}></i></div>
    </section>

    ${acts.length > 0 && html`<section class="sec"><h2 class="lbl">Next up</h2>
      ${acts.map((a, i) => html`<div class=${"act" + (i === 0 ? " first" : "")} key=${a.kind+a.title}>
        <div class="grow"><div class="t">${a.title}</div><div class="s">${a.sub}</div></div>
        ${a.kind === "weigh" ? html`<form class="bwform" onSubmit=${(e) => { e.preventDefault(); if (!num(bw)) return; addBw(DB, k, bw); setBw(""); toast(`Logged ${num(bw)} kg`); commit(); }}>
            <input class="bwin num" type="number" inputmode="decimal" step="0.1" placeholder=${DB.bw.length ? DB.bw[DB.bw.length-1].kg : "kg"} value=${bw} onInput=${(e) => setBw(e.target.value)} aria-label="Bodyweight kg"/>
            <button class="pill">Log</button></form>`
          : html`<button class=${"pill" + (i === 0 ? " hot" : "")} onClick=${() => act(a)}>${actLabel[a.kind]}</button>`}
      </div>`)}
    </section>`}

    <section class="sec">
      <div class="sechead"><h2 class="lbl">Standard</h2>
        <div class="seg" role="group" aria-label="Standard level">
          ${["full","bare"].map((m) => html`<button class=${d.m === m ? "on" : ""} onClick=${() => { editDay(k).m = m; commit(); }}>${m === "full" ? "Full" : "Bare min"}</button>`)}
        </div></div>
      ${items.map((txt, i) => html`<button class=${"habit" + (d.d[i] ? " on" : "")} onClick=${() => { const dd = editDay(k); dd.d[i] = dd.d[i] ? 0 : 1; if (i === 1) dd.auto = 0; buzz(10); commit(); }}>
        <span class="box">${d.d[i] ? html`<${Icon} n="check" s=${18}/>` : ""}</span>
        <span class="grow"><span class="t">${txt}</span>
          ${i === 1 && html`<span class="s">${ls.rest ? "Rest day" : `Training ${ls.done}/${ls.tot}`} · protein ${Math.round(t.p)}/${DB.set.p} g${d.auto && d.d[1] ? " · ticked by coach" : ""}</span>`}</span>
      </button>`)}
      <div class="anime"><span class="grow">Anime episodes <b class=${"num" + (d.a > allow ? " over" : "")}>${d.a || 0}/${allow}</b></span>
        <button class="round" aria-label="One fewer" onClick=${() => { const dd = editDay(k); dd.a = Math.max(0, (dd.a||0) - 1); commit(); }}><${Icon} n="minus" s=${18}/></button>
        <button class="round" aria-label="One more" onClick=${() => { const dd = editDay(k); dd.a = (dd.a||0) + 1; commit(); }}><${Icon} n="plus" s=${18}/></button></div>
    </section>
    <p class="quote">${q}</p>`;
}

/* ================= Train ================= */
function Train({openGym}){
  const td = dayName(today()), [sel, setSel] = useState(PROGRAM[td] ? td : "Mon");
  const wd = weekDone(), p = PROGRAM[sel], deload = isDeloadWeek();
  const ls = liftStatus();
  // Today's own session must not count as "last time" for today's targets.
  const preview = DB.lifts.find((s) => s.date === today() && s.day === sel) || {ready:"normal", deload};
  return html`
    <${Head} kicker=${`Week ${trainingWeek()} of the block${deload ? " · deload" : ""}`} title="Train"/>
    ${deload && html`<div class="banner"><${Icon} n="bolt" s=${18}/><span>Deload week. Half the sets at 90% weight. Recovery is where the growth from the last 4 weeks lands.</span></div>`}
    <div class="week">${WEEK.map((d) => html`<button class=${"wd" + (d === sel ? " sel" : "") + (wd[d] ? " done" : "") + (d === td ? " today" : "")} onClick=${() => setSel(d)} aria-pressed=${d === sel}>
      <span>${d.slice(0,2)}</span><i></i></button>`)}</div>
    ${!p ? html`<section class="restday"><h2>Rest day</h2><p>Walk, stretch 10 minutes, eat your protein. Muscle is built today, not in the gym.</p></section>` : html`
      <section class="plan">
        <div class="plantop"><div class="grow"><div class="kicker">${sel}${sel !== td ? " · not today" : ""}</div><h2>${p.title}</h2><p class="mutep">${p.sub}</p></div></div>
        <ol class="exlist">${p.ex.map((e) => { const pr = prescribe(e, preview); return html`<li>
          <div class="grow"><b>${e[0]}</b><span>${pr.sets} × ${e[2]} · rest ${e[3]}</span></div>
          <div class="target num">${pr.w ? html`${fmt(pr.w)}<small>kg</small>` : html`<small>new</small>`}${pr.up ? html`<${Icon} n="progress" s=${14}/>` : ""}</div></li>`; })}</ol>
        <button class="cta" onClick=${() => openGym(sel)}>${sel === td && ls.done ? `Continue · ${ls.done}/${ls.tot} sets` : sel === td ? "Start session" : `Start ${p.title} today`}</button>
      </section>`}`;
}

/* ================= Gym mode ================= */
function Gym({day, close}){
  const p = PROGRAM[day];
  const existing = DB.lifts.find((s) => s.date === today() && s.day === day);
  const [rec, setRec] = useState(existing || null);
  const [i, setI] = useState(() => { if (!existing) return 0; const n = existing.exercises.findIndex((e) => e.sets.some((x) => !x.done)); return n < 0 ? existing.exercises.length-1 : n; });
  const [edit, setEdit] = useState(null); // set index being edited
  const [rest, setRest] = useState(null); // {end, total}
  const [now, setNow] = useState(Date.now());
  const [, force] = useReducer((x) => x+1, 0);
  const [summary, setSummary] = useState(false);
  const [val, setVal] = useState({w:"", r:""});
  const keyRef = useRef(null);
  useEffect(() => { if (!rest) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [rest]);
  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  if (!rec) return html`<div class="gym"><div class="gymbar"><button class="round" onClick=${close} aria-label="Close"><${Icon} n="close"/></button><span class="grow"></span></div>
    <div class="ready"><div class="kicker">${p.title}</div><h1>How do you feel?</h1><p class="mutep">The coach sets today's weights from this.</p>
    ${[["fresh","Fresh","Push it. Normal plan, chase the top of the rep range."],["normal","Normal","Normal plan."],["rough","Rough","Bad sleep or sore. One set fewer, 5% lighter."]].map(([v,l,s]) => html`
      <button class="readybtn" onClick=${() => { setRec(newSession(day, v)); setI(0); }}><b>${l}</b><span>${s}</span></button>`)}
    ${isDeloadWeek() && html`<p class="mutep" style="margin-top:14px">Deload week is on: half sets at 90% either way.</p>`}</div></div>`;

  const ex = rec.exercises[i], e = p.ex.find((x) => x[0] === ex.name) || [ex.name, ex.sets.length, "8-12", "90 sec", "8", ""];
  const pr = prescribe(e, rec);
  const cur = edit != null ? edit : ex.sets.findIndex((x) => !x.done);
  const allDone = cur < 0;
  const setObj = allDone ? null : ex.sets[cur];
  const lastSet = [...ex.sets].reverse().find((x) => x.done);
  const init = () => ({w: setObj && setObj.w !== "" ? setObj.w : lastSet ? lastSet.w : pr.w != null ? fmt(pr.w) : "", r: setObj && setObj.r !== "" ? setObj.r : lastSet ? lastSet.r : String(pr.r)});
  // Load the dial with this set's values whenever the exercise or set changes.
  const keyNow = i+":"+cur;
  if (keyRef.current !== keyNow) { keyRef.current = keyNow; const v = init(); if (v.w !== val.w || v.r !== val.r) setVal(v); }

  const step = (f, d) => setVal((v) => ({...v, [f]: String(Math.max(0, r1(num(v[f]) + d)))}));
  const logSet = () => {
    if (!num(val.r)) { toast("Reps first"); return; }
    const s = ex.sets[cur]; s.done = false; const best = bestE1(ex.name); // all-time, including earlier sets today
    s.w = val.w; s.r = val.r; s.done = true;
    s.pr = best > 0 && num(s.w) > 0 && epley(num(s.w), num(s.r)) > best + .01;
    save(); buzz(s.pr ? [60,40,60,40,140] : 20);
    if (s.pr) toast(`PR · est. 1RM ${fmt(epley(num(s.w), num(s.r)))} kg`);
    const wasEdit = edit != null; setEdit(null);
    const moreHere = ex.sets.some((x) => !x.done);
    const lastEx = i === rec.exercises.length-1;
    if (!wasEdit && (moreHere || !lastEx)) { const sec = restSec(e[3]); setRest({end:Date.now()+sec*1000, total:sec, next: moreHere ? `${ex.name} · set ${cur+2}` : rec.exercises[i+1].name}); setNow(Date.now()); }
    if (!moreHere && !lastEx && !wasEdit) setI(i+1);
    if (!moreHere && lastEx && !wasEdit) { rec.finished = true; save(); setSummary(true); }
    force();
  };
  const left = rest ? Math.max(0, Math.ceil((rest.end - now)/1000)) : 0;
  if (rest && left === 0 && !rest.rang) { rest.rang = true; buzz([200,80,200]); beep(); }

  if (summary) {
    let sets = 0, vol = 0; const prs = [];
    rec.exercises.forEach((x) => x.sets.forEach((s) => { if (isDone(s)) { sets++; vol += num(s.w)*num(s.r); if (s.pr) prs.push(`${x.name} ${fmt(num(s.w))}×${num(s.r)}`); } }));
    return html`<div class="gym"><div class="summary"><div class="kicker">${p.title} · done</div><h1>Session in.</h1>
      <div class="sumgrid"><div><b class="num">${sets}</b><span>sets</span></div><div><b class="num">${Math.round(vol).toLocaleString()}</b><span>kg moved</span></div><div><b class="num">${prs.length}</b><span>PRs</span></div></div>
      ${prs.length > 0 && html`<ul class="prs">${prs.map((x) => html`<li>${x}</li>`)}</ul>`}
      <p class="mutep">Now eat: ${dish(today(), "snack").n} (${dish(today(), "snack").p} g protein).</p>
      <button class="cta" onClick=${close}>Close</button></div></div>`;
  }

  return html`<div class="gym">
    <div class="gymbar">
      <button class="round" onClick=${close} aria-label="Close session"><${Icon} n="close"/></button>
      <div class="dots">${rec.exercises.map((x, j) => html`<button class=${"dot" + (j === i ? " on" : "") + (x.sets.every((s) => s.done) ? " done" : "")} onClick=${() => { setI(j); setEdit(null); }} aria-label=${x.name}></button>`)}</div>
      <button class="link" onClick=${() => { rec.finished = true; save(); setSummary(true); }}>Finish</button>
    </div>
    <div class="gymbody">
      <div class="kicker">${i+1} of ${rec.exercises.length} · ${e[2]} reps · RPE ${e[4]}</div>
      <h1 class="exname">${ex.name}</h1>
      <p class="cue">${e[5]}</p>
      <div class=${"coach" + (pr.up ? " up" : "")}><${Icon} n=${pr.up ? "progress" : "bolt"} s=${16}/><span>${pr.why}</span></div>
      ${pr.last && html`<p class="lastline">Last ${fmtDate(pr.last.date)}: ${pr.last.sets.map((x) => `${fmt(num(x.w))}×${num(x.r)}`).join("  ")}</p>`}

      <div class="setchips">${ex.sets.map((s, j) => html`<button class=${"sc" + (s.done ? " done" : "") + (s.pr ? " pr" : "") + (j === cur ? " cur" : "")} onClick=${() => { if (s.done) setEdit(edit === j ? null : j); }}>
        <span>${j+1}</span>${s.done ? html`<b class="num">${fmt(num(s.w))}×${num(s.r)}</b>` : html`<b class="num dimn">${j === cur ? "now" : "—"}</b>`}</button>`)}
        <button class="sc add" onClick=${() => { ex.sets.push({w:"", r:"", done:false}); setEdit(null); save(); force(); }} aria-label="Add a set"><${Icon} n="plus" s=${16}/></button>
      </div>

      ${allDone ? html`<div class="exdone"><b>All sets in.</b>${i < rec.exercises.length-1 ? html`<button class="cta" onClick=${() => setI(i+1)}>Next: ${rec.exercises[i+1].name}</button>` : html`<button class="cta" onClick=${() => { rec.finished = true; save(); setSummary(true); }}>Finish session</button>`}</div>` : html`
      <div class="dial">
        <div class="field"><span class="lbl">Weight · kg</span>
          <div class="ctl"><button class="big" onClick=${() => step("w", -2.5)} aria-label="Minus 2.5 kg"><${Icon} n="minus" s=${26}/></button>
          <input class="val num" type="number" inputmode="decimal" step="0.5" value=${val.w} placeholder="–" onInput=${(ev) => setVal({...val, w:ev.target.value})} aria-label="Weight in kg"/>
          <button class="big" onClick=${() => step("w", 2.5)} aria-label="Plus 2.5 kg"><${Icon} n="plus" s=${26}/></button></div></div>
        <div class="field"><span class="lbl">Reps · target ${pr.r}${pr.hi > pr.r ? `–${pr.hi}` : ""}</span>
          <div class="ctl"><button class="big" onClick=${() => step("r", -1)} aria-label="One rep fewer"><${Icon} n="minus" s=${26}/></button>
          <input class="val num" type="number" inputmode="numeric" value=${val.r} placeholder="0" onInput=${(ev) => setVal({...val, r:ev.target.value})} aria-label="Reps"/>
          <button class="big" onClick=${() => step("r", 1)} aria-label="One rep more"><${Icon} n="plus" s=${26}/></button></div></div>
      </div>
      <button class="cta log" onClick=${logSet}>${edit != null ? `Update set ${cur+1}` : `Log set ${cur+1} of ${ex.sets.length}`}</button>
      ${edit != null && html`<button class="link center" onClick=${() => { ex.sets[edit].done = false; ex.sets[edit].pr = false; setEdit(null); save(); force(); }}>Undo set ${edit+1}</button>`}`}
      <div class="exnav">
        <button class="link" disabled=${i === 0} onClick=${() => { setI(i-1); setEdit(null); }}><${Icon} n="left" s=${18}/>Prev</button>
        <button class="link" disabled=${i === rec.exercises.length-1} onClick=${() => { setI(i+1); setEdit(null); }}>Skip<${Icon} n="right" s=${18}/></button>
      </div>
    </div>
    ${rest && html`<div class=${"restov" + (left === 0 ? " go" : "")}>
      <div class="kicker">${left ? "Rest" : "Go"}</div>
      <${Ring} frac=${rest.total ? 1 - left/rest.total : 1} size=${240}><b class="num restnum">${Math.floor(left/60)}:${pad(left%60)}</b><//>
      <p class="mutep">Next: ${rest.next}</p>
      <div class="row">
        <button class="pill" onClick=${() => setRest({...rest, end:rest.end+15000, total:rest.total+15, rang:false})}>+15 s</button>
        <button class="pill hot" onClick=${() => setRest(null)}>${left ? "Skip rest" : "Start set"}</button></div></div>`}
  </div>`;
}
function Ring({frac, size, children}){
  const st = 10, r = (size-st)/2, c = 2*Math.PI*r;
  return html`<div class="ring" style=${`width:${size}px;height:${size}px`}><svg width=${size} height=${size}><circle cx=${size/2} cy=${size/2} r=${r} class="track" stroke-width=${st}/><circle cx=${size/2} cy=${size/2} r=${r} class="arc" stroke-width=${st} stroke-dasharray=${c.toFixed(1)} stroke-dashoffset=${(c*(1-Math.max(0,Math.min(1,frac)))).toFixed(1)}/></svg><div class="ringin">${children}</div></div>`;
}
function beep(){ try { const a = new (window.AudioContext||window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .12; o.start(); setTimeout(() => { o.stop(); a.close(); }, 300); } catch(e){} }

/* ================= Food ================= */
function Food(){
  const k = today(), t = totals(k), S = DB.set, list = foodList(k), wtr = DB.water[k] || 0;
  const [q, setQ] = useState(""), [custom, setCustom] = useState(null);
  const extras = list.map((f, idx) => ({f, idx})).filter(({f}) => !f.slot);
  const gap = proteinPace() - t.p;
  const ql = q.trim().toLowerCase();
  const all = [...DB.custom, ...TOPUPS, ...FOODS];
  const res = ql ? all.filter((f) => f.n.toLowerCase().includes(ql)).filter((f, j, a) => a.findIndex((x) => x.n === f.n) === j).slice(0,20) : recentFoods();
  const add = (f) => { logFood(f); buzz(8); toast(`+ ${f.n}`); rerender(); };
  return html`
    <${Head} kicker=${t.p >= S.p ? "Protein target hit" : gap > 10 ? `${Math.round(gap)} g behind pace` : "On pace"} title="Food"/>
    <section class="macros">
      <div class="big"><b class="num">${Math.round(t.p)}</b><span>/ ${S.p} g protein</span></div>
      <div class="bar lime"><i style=${`width:${Math.min(100,100*t.p/S.p)}%`}></i><em style=${`left:${Math.min(100,100*proteinPace()/S.p)}%`} title="Where you should be by now"></em></div>
      <div class="sub2"><span><b class="num">${Math.round(t.k)}</b> / ${S.k} kcal</span><span>${Math.max(0, Math.round(S.p - t.p))} g to go</span></div>
    </section>
    <section class="sec"><h2 class="lbl">Today's menu</h2>
      ${SLOTS.map(([id, label]) => { const m = dish(k, id), got = eaten(k, id); return html`<div class=${"meal" + (got ? " on" : "")} key=${id}>
        <button class="box" onClick=${() => { if (got) DB.food[k] = list.filter((f) => f !== got); else logFood(m, id); buzz(10); commit(); }} aria-label=${got ? "Mark not eaten" : "Mark eaten"}>${got ? html`<${Icon} n="check" s=${18}/>` : ""}</button>
        <div class="grow"><span class="slot">${label}</span><b>${got ? got.n : m.n}</b><span class="mm"><em>${got ? got.p : m.p} g</em> · ${got ? got.k : m.k} kcal</span></div>
        ${!got && html`<button class="round" onClick=${() => { const s = DB.swaps[k] || (DB.swaps[k] = {}); s[id] = (s[id]||0) + 1; commit(); }} aria-label="Swap dish"><${Icon} n="swap" s=${18}/></button>`}
      </div>`; })}
    </section>
    ${gap > 15 && html`<section class="sec"><h2 class="lbl">Top up</h2><div class="chips">${TOPUPS.slice(0,4).map((f) => html`<button class="fchip" onClick=${() => add(f)}><b>${f.n}</b><span><em>${f.p} g</em> · ${f.k} kcal · ${f.u}</span></button>`)}</div></section>`}
    <section class="sec"><h2 class="lbl">Water</h2>
      <div class="water">${Array.from({length:S.w}, (_, j) => html`<button class=${j < wtr ? "on" : ""} aria-label=${`${j+1} glasses`} onClick=${() => { DB.water[k] = wtr === j+1 ? j : j+1; commit(); }}></button>`)}<span class="num">${wtr}/${S.w}</span></div></section>
    <section class="sec"><h2 class="lbl">Something else</h2>
      <input class="search" type="search" placeholder="Search: paneer, roti, whey…" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Search foods"/>
      <div class="chips">${res.map((f) => html`<button class="fchip" onClick=${() => add(f)}><b>${f.n}</b><span><em>${r1(f.p)} g</em> · ${Math.round(f.k)} kcal${f.u ? " · "+f.u : ""}</span></button>`)}</div>
      ${ql && !res.length && html`<p class="mutep">No match.</p>`}
      ${custom ? html`<form class="custom" onSubmit=${(e) => { e.preventDefault(); if (!custom.n || !num(custom.k)) return toast("Name and kcal needed"); const f = {n:custom.n.trim(), u:"", k:num(custom.k), p:num(custom.p)}; DB.custom = [f, ...DB.custom.filter((x) => x.n !== f.n)]; setCustom(null); setQ(""); add(f); }}>
          <input placeholder="Name" value=${custom.n} onInput=${(e) => setCustom({...custom, n:e.target.value})} aria-label="Food name"/>
          <input type="number" inputmode="numeric" placeholder="kcal" value=${custom.k} onInput=${(e) => setCustom({...custom, k:e.target.value})} aria-label="Calories"/>
          <input type="number" inputmode="decimal" placeholder="protein g" value=${custom.p} onInput=${(e) => setCustom({...custom, p:e.target.value})} aria-label="Protein grams"/>
          <button class="pill hot">Add</button></form>`
        : html`<button class="link" onClick=${() => setCustom({n:q, k:"", p:""})}>+ Custom food</button>`}
      ${extras.length > 0 && html`<div class="extras">${extras.map(({f, idx}) => html`<div class="xrow" key=${f.n}>
        <div class="grow"><b>${f.n}</b><span><em>${r1(f.p*f.q)} g</em> · ${Math.round(f.k*f.q)} kcal</span></div>
        <div class="qty"><button aria-label="Less" onClick=${() => { f.q = Math.max(0, f.q - .5); if (!f.q) list.splice(idx, 1); commit(); }}><${Icon} n="minus" s=${16}/></button><b class="num">${f.q}</b><button aria-label="More" onClick=${() => { f.q += .5; commit(); }}><${Icon} n="plus" s=${16}/></button></div></div>`)}</div>`}
    </section>`;
}

/* ================= Progress ================= */
function Line({pts, unit=""}){
  if (pts.length < 2) return html`<p class="mutep">${pts.length ? "One entry. The line starts at two." : "No data yet."}</p>`;
  const W = 330, H = 110, ys = pts.map((p) => p.y), mn = Math.min(...ys), mx = Math.max(...ys), sp = mx-mn || 1;
  const X = (i) => 4 + (W-8)*i/(pts.length-1), Y = (v) => H-20 - (H-36)*(v-mn)/sp;
  const L = pts[pts.length-1];
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Trend">
    <polyline points=${pts.map((p,i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")} class="ln"/>
    <circle cx=${X(pts.length-1)} cy=${Y(L.y)} r="4.5" class="dotc"/>
    <text x="4" y="11">${fmt(mx)}${unit}</text><text x="4" y=${H-3}>${fmt(mn)}${unit}</text><text x=${W-4} y=${H-3} text-anchor="end">${fmtDate(L.x)}</text></svg>`;
}
function Progress(){
  const tk = today(), now = new Date();
  const [ex, setEx] = useState(null), [open, setOpen] = useState(null), [armed, setArmed] = useState(null), [bw, setBw] = useState("");
  const start = addDays(now, -(17*7) - ((now.getDay()+6) % 7));
  const cells = Array.from({length:18*7}, (_, j) => { const k = key(addDays(start, j)), s = dayScore(dayRec(k)); return {k, lv: k > tk ? "f" : s >= 3.5 ? 4 : s >= 2.5 ? 3 : s >= 1.5 ? 2 : s > 0 ? 1 : 0}; });
  let last30 = 0; for (let j = 0; j < 30; j++) if (dayScore(dayRec(key(addDays(now,-j)))) >= 2) last30++;
  const pd = Array.from({length:14}, (_, j) => { const k = key(addDays(now, j-13)); return {k, p: totals(k).p}; });
  const pmax = Math.max(DB.set.p*1.1, ...pd.map((x) => x.p));
  const names = [...new Set(DB.lifts.flatMap((s) => s.exercises.filter((e) => e.sets.some((x) => isDone(x) && num(x.w))).map((e) => e.name)))].sort();
  const cur = names.includes(ex) ? ex : names[0];
  const stalls = names.filter(stalled);
  const sessions = DB.lifts.filter((s) => s.exercises.some((e) => e.sets.some(isDone))).slice().reverse().slice(0, 10);
  const fileRef = useRef();
  const S = DB.set;
  const setT = (f, v) => { if (num(v) > 0) { S[f] = num(v); save(); } };
  return html`
    <${Head} kicker="Last 18 weeks" title="Progress"/>
    <section class="tiles"><div><b class="num hot">${streak()}</b><span>streak</span></div><div><b class="num">${last30}</b><span>of last 30</span></div><div><b class="num">${trainingWeek()}</b><span>training wk</span></div></section>
    <section class="sec"><h2 class="lbl">Standard</h2><div class="heat">${cells.map((c) => html`<i class=${"l"+c.lv + (c.k === tk ? " td" : "")} title=${c.k}></i>`)}</div></section>
    ${stalls.length > 0 && html`<section class="sec"><h2 class="lbl">Coach notes</h2>${stalls.map((n) => html`<p class="note"><b>${n}</b> has stalled for 3 sessions. Slow the lowering to 3 seconds; the next deload resets it.</p>`)}</section>`}
    <section class="sec"><h2 class="lbl">Protein · 14 days</h2>
      <svg class="chart" viewBox="0 0 330 90" role="img" aria-label="Protein per day"><line x1="0" x2="330" y1=${86 - 76*S.p/pmax} y2=${86 - 76*S.p/pmax} class="target"/>
      ${pd.map((x, j) => { const h = 76*x.p/pmax; return html`<rect x=${j*23.6+2} y=${86-h} width="18" height=${Math.max(h, x.p ? 2 : 0)} rx="3" class=${x.p >= S.p*.95 ? "hit" : "miss"}><title>${x.k}: ${Math.round(x.p)} g</title></rect>`; })}</svg></section>
    <section class="sec"><div class="sechead"><h2 class="lbl">Bodyweight</h2><form class="bwform" onSubmit=${(e) => { e.preventDefault(); if (!num(bw)) return; addBw(DB, tk, bw); setBw(""); toast("Logged"); commit(); }}><input class="bwin num" type="number" inputmode="decimal" step="0.1" placeholder="kg" value=${bw} onInput=${(e) => setBw(e.target.value)} aria-label="Bodyweight kg"/><button class="pill">Log</button></form></div>
      <${Line} pts=${DB.bw.slice(-60).map((b) => ({x:b.date, y:b.kg}))} unit=" kg"/></section>
    <section class="sec"><h2 class="lbl">Strength · best est. 1RM</h2>
      ${names.length ? html`<select value=${cur} onChange=${(e) => setEx(e.target.value)} aria-label="Exercise">${names.map((n) => html`<option value=${n}>${n}</option>`)}</select><${Line} pts=${e1History(cur)} unit=" kg"/>` : html`<p class="mutep">Log a few sessions and the trend shows here.</p>`}</section>
    <section class="sec"><h2 class="lbl">Sessions</h2>
      ${sessions.length ? sessions.map((s) => { const p = PROGRAM[s.day], n = s.exercises.reduce((a,e) => a + e.sets.filter(isDone).length, 0), id = s.date+s.day+s.ts; return html`
        <div key=${id}><button class="hist" onClick=${() => { setOpen(open === id ? null : id); setArmed(null); }}><span class="grow"><b>${p ? p.title : s.day}</b><span>${fmtDate(s.date)} · ${n} sets${s.deload ? " · deload" : ""}${s.ready === "rough" ? " · rough day" : ""}</span></span><${Icon} n=${open === id ? "minus" : "plus"} s=${16}/></button>
        ${open === id && html`<div class="det">${s.exercises.filter((e) => e.sets.some(isDone)).map((e) => html`<div><span>${e.name}</span><b>${e.sets.filter(isDone).map((x) => `${fmt(num(x.w))}×${num(x.r)}`).join(", ")}</b></div>`)}
          <button class="link danger" onClick=${() => { if (armed !== id) return setArmed(id); DB.lifts = DB.lifts.filter((x) => x !== s); setArmed(null); toast("Session deleted"); commit(); }}>${armed === id ? "Tap again to delete" : "Delete session"}</button></div>`}</div>`; }) : html`<p class="mutep">No sessions yet.</p>`}</section>
    <section class="sec"><h2 class="lbl">Targets</h2>
      ${[["p","Protein, g/day"],["k","Calories, kcal/day"],["w","Water, glasses"]].map(([f,l]) => html`<label class="kv"><span>${l}</span><input class="num" type="number" inputmode="numeric" value=${S[f]} onChange=${(e) => { setT(f, e.target.value); toast("Saved"); }}/></label>`)}
      <label class="kv"><span>Auto deload every 5th week</span><input type="checkbox" checked=${!S.deloadOff} onChange=${(e) => { S.deloadOff = !e.target.checked; commit(); }}/></label></section>
    <section class="sec"><h2 class="lbl">Daily standard items</h2>
      ${["full","bare"].map((m) => html`<div class="items"><span class="kicker">${m === "full" ? "Full" : "Bare min"}</span>${DB.items[m].map((txt, j) => html`<input value=${txt} onChange=${(e) => { if (e.target.value.trim()) { DB.items[m][j] = e.target.value.trim(); commit(); } }} aria-label=${`${m} item ${j+1}`}/>`)}</div>`)}</section>
    <section class="sec"><h2 class="lbl">Data</h2>
      <p class="mutep">Saved on this phone only. Export now and then. Import also takes backups from WrkTrack, Fitness Tracker and Daily Standard.</p>
      <div class="row"><button class="pill" onClick=${exportData}>Export</button><button class="pill" onClick=${() => fileRef.current.click()}>Import</button>
      <button class="link danger" onClick=${() => { if (armed !== "reset") return setArmed("reset"); DB = blank(); setArmed(null); toast("Wiped"); commit(); }}>${armed === "reset" ? "Tap again: wipes all" : "Reset"}</button></div>
      <input type="file" accept="application/json,.json" hidden ref=${fileRef} onChange=${(e) => importData(e.target)}/></section>`;
}
function exportData(){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], {type:"application/json"}));
  a.download = "standard-"+today()+".json"; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300); toast("Exported");
}
function importData(input){
  const f = input.files[0]; if (!f) return;
  f.text().then((txt) => {
    const o = JSON.parse(txt);
    if (o && (o.v === 1 || o.v === 2) && Array.isArray(o.lifts)) { DB = norm(o); toast("Backup restored"); }
    else { const got = absorb(DB, o); if (!got) throw 0; toast("Imported " + got); }
    commit();
  }).catch(() => toast("Not a backup this app knows")).finally(() => { input.value = ""; });
}

render(html`<${App}/>`, document.getElementById("root"));
if ("serviceWorker" in navigator && location.protocol !== "file:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
