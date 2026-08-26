import "./styles.css";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, limit, serverTimestamp, Timestamp
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "./firebase.js";

const CATEGORIES = [
  ["Příjem", "income", "#16805c"], ["Bydlení", "fixed", "#4777b7"],
  ["Energie", "fixed", "#6d5bd0"], ["Jídlo", "variable", "#d08b25"],
  ["Doprava", "variable", "#d35f3f"], ["Zábava", "variable", "#b6538a"],
  ["Zdraví", "unexpected", "#3c9c91"], ["Ostatní", "unexpected", "#727b85"]
];

const state = {
  user: null, page: "dashboard", transactions: [], categories: [],
  budgets: [], investments: [], goals: [], month: new Date(),
  dark: localStorage.getItem("fpk-dark") === "1",
  notifications: localStorage.getItem("fpk-notifications") !== "0",
  receiptUrl: null, installPrompt: null
};

const money = n => new Intl.NumberFormat("cs-CZ", {maximumFractionDigits:0}).format(Number(n)||0) + " Kč";
const dateKey = d => {
  const x = new Date(d); return x.toISOString().slice(0,10);
};
const monthKey = d => {
  const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`;
};
const currentMonth = () => monthKey(state.month);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));

function col(name) { return collection(db, "users", state.user.uid, name); }
function newId(name) { return doc(db, "users", state.user.uid, name).id; }

async function loadAll() {
  const [tx, cats, budgets, inv, goals] = await Promise.all([
    getDocs(query(col("transactions"), orderBy("date", "desc"), limit(500))),
    getDocs(col("categories")),
    getDocs(col("budgets")),
    getDocs(query(col("investments"), orderBy("date", "desc"), limit(300))),
    getDocs(col("goals"))
  ]);
  state.transactions = tx.docs.map(d => ({id:d.id, ...d.data()}));
  state.categories = cats.docs.map(d => ({id:d.id, ...d.data()}));
  state.budgets = budgets.docs.map(d => ({id:d.id, ...d.data()}));
  state.investments = inv.docs.map(d => ({id:d.id, ...d.data()}));
  state.goals = goals.docs.map(d => ({id:d.id, ...d.data()}));

  if (!state.categories.length) {
    const writes = CATEGORIES.map(([name,type,color]) => addDoc(col("categories"), {name,type,colorHex:color,icon:"receipt",isDefault:true}));
    await Promise.all(writes);
    const cats2 = await getDocs(col("categories"));
    state.categories = cats2.docs.map(d => ({id:d.id, ...d.data()}));
  }
}

function summary(month=currentMonth()) {
  const rows = state.transactions.filter(t => String(t.date||"").slice(0,7) === month);
  const income = rows.filter(t=>t.type==="income").reduce((a,t)=>a+Number(t.amount),0);
  const expense = rows.filter(t=>t.type==="expense").reduce((a,t)=>a+Number(t.amount),0);
  const planned = state.budgets.filter(b=>b.month===month).reduce((a,b)=>a+Number(b.amount),0);
  const byCat = {};
  rows.filter(t=>t.type==="expense").forEach(t=>byCat[t.categoryId]=(byCat[t.categoryId]||0)+Number(t.amount));
  return {income,expense,result:income-expense,planned,byCat};
}

function layout() {
  document.documentElement.classList.toggle("dark", state.dark);
  const app = document.querySelector("#app");
  if (!state.user) { renderAuth(app); return; }
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="logo">€</div><div><strong>Finance pod kontrolou</strong><span>Přehled vytváří klid.</span></div></div>
        <nav>${navItems().map(n=>`<button class="${state.page===n.id?"active":""}" data-page="${n.id}"><span>${n.icon}</span>${n.label}</button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <button class="ghost" id="installBtn" hidden>＋ Přidat do zařízení</button>
          <button class="ghost" data-page="settings">⚙ Nastavení</button>
          <button class="ghost danger" id="logout">Odhlásit</button>
        </div>
      </aside>
      <main class="main"><div class="mobile-head"><button id="menuBtn">☰</button><strong>Finance pod kontrolou</strong></div><div id="content"></div></main>
    </div>`;
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{
    state.page=b.dataset.page; 
    document.querySelector(".sidebar")?.classList.remove("open");
    layout();
  });
  document.querySelector("#logout").onclick=async()=>{await signOut(auth);};
  
  // Otevírání/zavírání menu na mobilu
  const menuBtn = document.querySelector("#menuBtn");
  const sidebar = document.querySelector(".sidebar");
  if (menuBtn && sidebar) {
    menuBtn.onclick = () => sidebar.classList.toggle("open");
  }

  if(state.installPrompt) { const b=document.querySelector("#installBtn"); b.hidden=false; b.onclick=installPWA; }
  renderPage();
}
function navItems(){ return [
  {id:"dashboard",label:"Přehled",icon:"⌂"},{id:"add",label:"Zapsat",icon:"＋"},
  {id:"history",label:"Historie",icon:"◷"},{id:"charts",label:"Grafy",icon:"◔"},
  {id:"goals",label:"Cíle",icon:"◎"},{id:"investments",label:"Spoření & investice",icon:"◇"},
  {id:"ai",label:"Finanční rádce",icon:"✦"},{id:"settings",label:"Nastavení",icon:"⚙"}
];}

function renderAuth(app) {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-brand"><div class="logo big">€</div><h1>Finance pod kontrolou</h1><p>Přehled vytváří klid.</p></div>
    <div class="tabs"><button class="tab active" data-auth="login">Přihlášení</button><button class="tab" data-auth="register">Registrace</button></div>
    <form id="authForm"><label>Email<input id="email" type="email" autocomplete="email" required></label>
    <label id="nameWrap" hidden>Jméno<input id="name" autocomplete="name"></label>
    <label>Heslo<input id="password" type="password" autocomplete="current-password" minlength="6" required></label>
    <button class="primary wide" type="submit" id="authSubmit">Přihlásit se</button><p id="authError" class="error"></p></form>
    <small>Data jsou synchronizována s Firebase a při dostupnosti ukládána i do offline cache zařízení.</small>
  </div></div>`;
  let mode="login";
  document.querySelectorAll("[data-auth]").forEach(b=>b.onclick=()=>{
    mode=b.dataset.auth; document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.auth===mode));
    document.querySelector("#nameWrap").hidden=mode!=="register"; document.querySelector("#authSubmit").textContent=mode==="register"?"Vytvořit účet":"Přihlásit se";
  });
  document.querySelector("#authForm").onsubmit=async e=>{
    e.preventDefault(); const email=document.querySelector("#email").value.trim(), password=document.querySelector("#password").value;
    const error=document.querySelector("#authError"); error.textContent="";
    try {
      if(mode==="register"){
        const name=document.querySelector("#name").value.trim();
        const cred=await createUserWithEmailAndPassword(auth,email,password);
        if(name) await updateProfile(cred.user,{displayName:name});
      } else await signInWithEmailAndPassword(auth,email,password);
    } catch(err){ error.textContent=authError(err.code); }
  };
}
function authError(code){
  return ({ "auth/invalid-credential":"Neplatný email nebo heslo.","auth/email-already-in-use":"Tento email už je registrovaný.","auth/weak-password":"Heslo musí mít alespoň 6 znaků.","auth/invalid-email":"Zkontroluj formát emailu.","auth/too-many-requests":"Příliš mnoho pokusů. Zkus to později."}[code] || "Operaci se nepodařilo dokončit.");
}

function renderPage(){
  const c=document.querySelector("#content"); if(!c) return;
  ({dashboard:renderDashboard,add:renderAdd,history:renderHistory,charts:renderCharts,goals:renderGoals,investments:renderInvestments,ai:renderAI,settings:renderSettings}[state.page]||renderDashboard)(c);
}

function header(title,sub=""){ return `<div class="page-head"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div><div class="head-actions"><span class="sync">● Firebase sync</span></div></div>`; }

function renderDashboard(c){
  const s=summary(), today=state.transactions.filter(t=>t.date===dateKey(new Date())).slice(0,8);
  c.innerHTML=header("Přehled","Měsíční přehled, který ti pomůže mít peníze pod kontrolou.")+
  `<section class="hero-grid">
    <article class="card balance"><span>Tento měsíc ti zbývá</span><strong class="${s.result<0?"negative":""}">${money(s.result)}</strong>
      <div class="stat-row"><div><small>↑ Příjmy</small><b>${money(s.income)}</b></div><div><small>↓ Výdaje</small><b>${money(s.expense)}</b></div></div>
      ${s.planned?`<div class="progress"><i style="width:${Math.min(100,s.expense/s.planned*100)}%"></i></div><small>Vyčerpáno ${Math.round(s.expense/s.planned*100)} % plánovaného rozpočtu</small>`:""}
    </article>
    <article class="card quick"><h3>Rychlá akce</h3><button class="primary" data-page="add">＋ Zapsat výdaj / příjem</button><button class="secondary" data-page="add">▣ Vyfotit účtenku</button></article>
  </section>
  <section class="section"><div class="section-head"><h2>Dnešní záznamy</h2><button class="link" data-page="history">Zobrazit historii →</button></div>
  ${today.length?`<div class="list">${today.map(txRow).join("")}</div>`:`<div class="empty">Zatím nic – jakmile něco utratíš, zapiš si to sem.</div>`}</section>
  <section class="tip"><b>💡 Tip</b><span>${motivation()}</span></section>`;
  bindPageButtons();
}
function motivation(){ const a=["Každá koruna, kterou znáš, se počítá.","Máš to pod kontrolou. Důležitý je další malý krok.","Finanční klid vzniká z přehledu, ne z dokonalosti.","Pokračuj. I malé změny se časem nasčítají."]; return a[new Date().getDate()%a.length]; }
function txRow(t){
  const cat=state.categories.find(c=>c.id===t.categoryId), sign=t.type==="expense"?"−":"+";
  return `<div class="row"><span class="dot" style="background:${cat?.colorHex||"#888"}"></span><div class="row-main"><b>${esc(cat?.name||"Bez kategorie")}</b><small>${esc(t.note||"")} · ${esc(t.date)}</small></div><strong class="${t.type==="expense"?"negative":"positive"}">${sign}${money(t.amount)}</strong></div>`;
}
function bindPageButtons(){ document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{state.page=b.dataset.page;layout();}); }

function renderAdd(c){
  const expenseCats=state.categories.filter(x=>x.type!=="income"), incomeCats=state.categories.filter(x=>x.type==="income");
  c.innerHTML=header("Nový záznam","Výdaj nebo příjem ulož přímo do svého Firebase účtu.")+
  `<form id="txForm" class="card form-card">
    <div class="seg"><button type="button" class="seg-on" data-type="expense">Výdaj</button><button type="button" data-type="income">Příjem</button></div>
    <label>Částka (Kč)<input id="amount" inputmode="decimal" required placeholder="0"></label>
    <label>Poznámka<input id="note" placeholder="Např. nákup potravin"></label>
    <label>Datum<input id="date" type="date" value="${dateKey(new Date())}" required></label>
    <label>Kategorie<select id="category">${expenseCats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
    <div class="receipt"><div><b>Účtenka</b><small>Fotku uložíme do Firebase Storage.</small></div><input id="receipt" type="file" accept="image/*" capture="environment"></div>
    <button class="primary wide" type="submit">Uložit záznam</button><p id="txMsg" class="success"></p>
  </form>`;
  let type="expense";
  document.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{
    type=b.dataset.type; document.querySelectorAll("[data-type]").forEach(x=>x.classList.toggle("seg-on",x.dataset.type===type));
    document.querySelector("#category").innerHTML=(type==="expense"?expenseCats:incomeCats).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
  });
  document.querySelector("#txForm").onsubmit=async e=>{
    e.preventDefault(); const amount=Number(document.querySelector("#amount").value.replace(",",".")), file=document.querySelector("#receipt").files[0];
    if(!amount || amount<=0) return;
    let receiptUrl=null;
    if(file){ const r=ref(storage,`users/${state.user.uid}/receipts/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi,"_")}`); await uploadBytes(r,file); receiptUrl=await getDownloadURL(r); }
    await addDoc(col("transactions"),{amount,type,categoryId:document.querySelector("#category").value,note:document.querySelector("#note").value.trim(),date:document.querySelector("#date").value,source:file?"receipt":"manual",receiptUrl,createdAt:serverTimestamp()});
    await loadAll(); e.target.reset(); document.querySelector("#date").value=dateKey(new Date()); document.querySelector("#txMsg").textContent="Uloženo a synchronizováno.";
  };
}

function renderHistory(c){
  const rows=state.transactions.filter(t=>String(t.date||"").slice(0,7)===currentMonth()).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const months=[...new Set(state.transactions.map(t=>String(t.date).slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6);
  c.innerHTML=header("Historie","Přehled posledních měsíců a detail jednotlivých zápisů.")+
  `<section class="month-grid">${months.length?months.map(m=>{const s=summary(m);return `<article class="card"><small>${m}</small><h3>${money(s.result)}</h3><span>příjmy ${money(s.income)} · výdaje ${money(s.expense)}</span></article>`}).join(""):`<div class="empty">Historie se objeví po prvním záznamu.</div>`}</section>
  <section class="section"><div class="section-head"><h2>Záznamy ${currentMonth()}</h2><button class="primary small" data-page="add">＋ Přidat</button></div>
  <div class="list">${rows.length?rows.map(t=>txRow(t)+`<button class="delete" data-del="${t.id}">Smazat</button>`).join(""):`<div class="empty">V tomto měsíci zatím nejsou žádné záznamy.</div>`}</div></section>`;
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(confirm("Opravdu smazat tento záznam?")){await deleteDoc(doc(db,"users",state.user.uid,"transactions",b.dataset.del));await loadAll();renderHistory(document.querySelector("#content"));}});
  bindPageButtons();
}

function renderCharts(c){
  const s=summary(), cats=Object.entries(s.byCat).map(([id,v])=>({cat:state.categories.find(x=>x.id===id),v})).filter(x=>x.cat);
  const max=Math.max(...cats.map(x=>x.v),1);
  c.innerHTML=header("Grafy a posun","Jednoduché vizualizace bez externího chart balíčku.")+
  `<section class="card chart-card"><h2>Výdaje podle kategorií</h2><div class="bars">${cats.length?cats.map(x=>`<div class="bar-row"><span>${esc(x.cat.name)}</span><div><i style="width:${x.v/max*100}%;background:${x.cat.colorHex}"></i></div><b>${money(x.v)}</b></div>`).join(""):`<div class="empty">Zatím žádné výdaje.</div>`}</div></section>
  <section class="card"><h2>Posledních 6 měsíců</h2><div class="mini-bars">${lastSixMonths().map(m=>{const x=summary(m);return `<div><div class="mini-bar" style="height:${Math.max(8,Math.min(130,Math.abs(x.result)/Math.max(1,...lastSixMonths().map(mm=>Math.abs(summary(mm).result))))*130)}px"></div><small>${m.slice(5)}</small><b>${money(x.result)}</b></div>`}).join("")}</div></section>`;
}
function lastSixMonths(){const out=[];let d=new Date(state.month);for(let i=5;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1);out.push(monthKey(x));}return out;}

function renderGoals(c){
  c.innerHTML=header("Finanční cíle","Splacení dluhu, rezerva nebo vlastní cíl – sleduj postup.")+
  `<div class="grid">${state.goals.filter(g=>g.active!==false).map(g=>{const p=Math.min(100,Number(g.currentAmount||0)/Number(g.targetAmount||1)*100);return `<article class="card"><span class="pill">${g.type==="debt"?"Splacení dluhu":g.type==="reserve"?"Finanční rezerva":"Cíl"}</span><h3>${esc(g.title)}</h3><div class="progress"><i style="width:${p}%"></i></div><p>${money(g.currentAmount||0)} z ${money(g.targetAmount)} · ${Math.round(p)} %</p><button class="secondary small" data-goal="${g.id}">Aktualizovat postup</button></article>`}).join("")||`<div class="empty">Zatím nemáš nastavený žádný cíl.</div>`}</div>
  <button class="floating primary" id="newGoal">＋ Nový cíl</button>`;
  document.querySelector("#newGoal").onclick=()=>goalDialog();
  document.querySelectorAll("[data-goal]").forEach(b=>b.onclick=()=>goalDialog(b.dataset.goal));
}
async function goalDialog(id=null){
  const old=state.goals.find(g=>g.id===id), title=prompt("Název cíle",old?.title||"Finanční rezerva"); if(!title)return;
  const target=Number(prompt("Cílová částka (Kč)",old?.targetAmount||100000)); if(!target)return;
  const current=Number(prompt("Aktuální stav (Kč)",old?.currentAmount||0));
  const type=(prompt("Typ: debt / reserve / other",old?.type||"reserve")||"reserve");
  if(old) await updateDoc(doc(db,"users",state.user.uid,"goals",id),{title,targetAmount:target,currentAmount:current,type});
  else await addDoc(col("goals"),{title,targetAmount:target,currentAmount:current,type,active:true,createdAt:serverTimestamp()});
  await loadAll(); renderGoals(document.querySelector("#content"));
}

function renderInvestments(c){
  const savings=state.investments.filter(x=>x.isSavings).reduce((a,x)=>a+Number(x.amount),0), invested=state.investments.filter(x=>!x.isSavings).reduce((a,x)=>a+Number(x.amount),0);
  c.innerHTML=header("Spoření a investice","Oddělený přehled vkladů, který zůstává pod tvým účtem.")+
  `<section class="hero-grid"><article class="card"><small>Spoření celkem</small><h2>${money(savings)}</h2></article><article class="card"><small>Investováno celkem</small><h2>${money(invested)}</h2></article></section>
  <section class="section"><div class="section-head"><h2>Historie vkladů</h2><button class="primary small" id="newInv">＋ Přidat</button></div><div class="list">${state.investments.map(x=>`<div class="row"><div class="row-main"><b>${esc(x.name)}</b><small>${x.isSavings?"Spoření":"Investice"} · ${esc(x.date||"")}</small></div><strong>${money(x.amount)}</strong></div>`).join("")||`<div class="empty">Zatím žádné vklady.</div>`}</div></section>`;
  document.querySelector("#newInv").onclick=async()=>{const name=prompt("Název vkladu");if(!name)return;const amount=Number(prompt("Částka (Kč)"));if(!amount)return;const isSavings=confirm("Je to spoření? (OK = ano, Zrušit = investice)");await addDoc(col("investments"),{name,amount,isSavings,date:dateKey(new Date()),createdAt:serverTimestamp()});await loadAll();renderInvestments(document.querySelector("#content"));};
}

function renderAI(c){
  c.innerHTML=header("Finanční rádce","Lehký lokální rádce nad tvými daty – bez posílání finančních dat do AI služby.")+
  `<section class="card chat"><div id="chatLog" class="chat-log"><div class="bubble bot">Ahoj! Vidím tvůj aktuální přehled. Zeptej se třeba „Jaké mám tento měsíc výdaje?“ nebo „Kde utrácím nejvíc?“</div></div><form id="chatForm"><input id="chatInput" placeholder="Napiš otázku…"><button class="primary">Odeslat</button></form></section>`;
  document.querySelector("#chatForm").onsubmit=e=>{e.preventDefault();const q=document.querySelector("#chatInput").value.trim();if(!q)return;const log=document.querySelector("#chatLog");log.innerHTML+=`<div class="bubble user">${esc(q)}</div><div class="bubble bot">${esc(answerAI(q))}</div>`;document.querySelector("#chatInput").value="";log.scrollTop=log.scrollHeight;};
}
function answerAI(q){
  const s=summary(), x=q.toLowerCase();
  if(x.includes("výdaj")||x.includes("utrác")) return `Tento měsíc máš výdaje ${money(s.expense)} a příjmy ${money(s.income)}. Zůstává ${money(s.result)}.`;
  if(x.includes("nejvíc")){const top=Object.entries(s.byCat).sort((a,b)=>b[1]-a[1])[0];const cat=top&&state.categories.find(c=>c.id===top[0]);return top?`Největší výdajová kategorie je ${cat?.name||"neznámá"}: ${money(top[1])}.`:"Zatím nemám dost dat.";}
  if(x.includes("cíl")||x.includes("rezerv")) return state.goals.length?`Máš ${state.goals.length} aktivních cílů. Nejbližší krok je aktualizovat jejich aktuální stav.`:"Zatím nemáš žádný cíl. Zkus si vytvořit první rezervu.";
  return `Aktuálně ti zbývá ${money(s.result)}. Pro konkrétnější odpověď se zeptej na výdaje, příjmy, kategorii nebo cíle.`;
}

function renderSettings(c){
  c.innerHTML=header("Nastavení","Předvolby zařízení a účtu.")+
  `<section class="card settings"><div class="setting"><div><b>Tmavý režim</b><small>Uloží se v tomto zařízení.</small></div><input id="dark" type="checkbox" ${state.dark?"checked":""}></div>
  <div class="setting"><div><b>Oznámení</b><small>Preference pro budoucí reminder funkce PWA.</small></div><input id="notif" type="checkbox" ${state.notifications?"checked":""}></div>
  <div class="setting"><div><b>Účet</b><small>${esc(state.user.email)}</small></div><button class="secondary" id="logout2">Odhlásit</button></div>
  <div class="setting"><div><b>Verze</b><small>Finance pod kontrolou PWA 1.0.0</small></div></div></section>`;
  document.querySelector("#dark").onchange=e=>{state.dark=e.target.checked;localStorage.setItem("fpk-dark",state.dark?"1":"0");layout();};
  document.querySelector("#notif").onchange=e=>{state.notifications=e.target.checked;localStorage.setItem("fpk-notifications",state.notifications?"1":"0");};
  document.querySelector("#logout2").onclick=()=>signOut(auth);
}

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.installPrompt=e; if(state.user)layout();});
async function installPWA(){if(!state.installPrompt)return;state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;layout();}

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
onAuthStateChanged(auth, async user=>{
  state.user=user;
  if(user){try{await loadAll();}catch(e){console.error(e);}state.page="dashboard";}
  layout();
});
