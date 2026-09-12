const API_URL = 'https://neress-auth-api-2.onrender.com';

const alerts = [
  {level:'High', location:'Dima Hasao, Assam', detail:'Landslide risk rising due to continuous heavy rainfall', time:'11:42 AM', tone:'high'},
  {level:'High', location:'Phek, Nagaland', detail:'Slope instability detected (satellite + sensor telemetry)', time:'10:28 AM', tone:'high'},
  {level:'Moderate', location:'Tirap, Arunachal Pradesh', detail:'Soil moisture saturation levels are exceeding 78%', time:'09:15 AM', tone:'moderate'},
  {level:'Moderate', location:'Mamit, Mizoram', detail:'Road blockage reported by field responders', time:'08:03 AM', tone:'moderate'},
  {level:'Low', location:'West Jaintia Hills, Meghalaya', detail:'Normal conditions; hillside drainage functioning stably', time:'06:47 AM', tone:'low'}
];

const pageDetails = {
  'Live Map':['⌖','Live Map','Browse live sensor telemetry, risk zones, and geotechnical beacons across the North Eastern Region.'],
  'Risk Prediction':['↗','Risk Prediction','Predictive slope models combine rainfall, soil moisture, terrain and satellite data.'],
  'Alerts':['♢','Alerts','Review the prioritised emergency feed and coordinate an immediate response.'],
  'Rescue Teams':['✚','Rescue Teams','Track NDRF, SDRF, PWD, and community responders in real time.'],
  'Data & Analytics':['▥','Data & Analytics','Explore monitoring coverage, rainfall signals, and readiness trends.'],
  'Reports':['▤','Reports','Manage field reports, incident logs, and after-action documentation.'],
  'Settings':['⚙','Settings','Manage alert delivery, visual preferences, and offline information cache.']
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let toastTimer;

function renderAlerts(){
  $('#alertList').innerHTML = alerts.slice(0,4).map((alert,index) => `
    <article class="alert-item ${alert.tone}" data-alert="${index}">
      <div class="alert-meta"><b>${alert.level} priority</b><time>${alert.time}</time></div>
      <h3>${alert.location}</h3><p>${alert.detail}</p>
    </article>`).join('');
}

function showToast(message){
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>toast.classList.remove('show'),3200);
}

async function apiFetch(path, options = {}) {
  const token = sessionStorage.getItem('neresqToken');
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load operational data.');
  return data;
}
const safe = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));

function openModal(html){ $('#modalContent').innerHTML = html; $('#modalBackdrop').classList.remove('hidden'); }
function closeModal(){ $('#modalBackdrop').classList.add('hidden'); }
function completeSession(data) {
  sessionStorage.setItem('neresqToken', data.token);
  sessionStorage.setItem('neresqUser', JSON.stringify(data.user));
  $('#avatar').textContent = data.user.name.split(' ').map(word => word[0]).slice(0,2).join('').toUpperCase();
  $('#authOverlay').classList.add('hidden');
}
function currentUser() { try { return JSON.parse(sessionStorage.getItem('neresqUser') || 'null'); } catch { return null; } }

function openHelpline(){
  openModal(`<h2>Emergency Helpline Directory</h2><p>Call the nearest operational desk for immediate assistance and rescue coordination.</p>
    <div class="modal-list"><div><b>National Emergency Response</b><span>112</span></div><div><b>National Disaster Response Force</b><span>011-2436 3200</span></div><div><b>Assam State Disaster Management Authority</b><span>1077</span></div><div><b>NEResq Emergency Coordination Desk</b><span>+91 70020 11000</span></div></div>
    <button class="primary" data-action="close-modal">Close directory</button>`);
}

function openReport(){
  if (currentUser()?.role === 'guest') { showToast('Guest viewers cannot submit incident reports. Sign in as an operator.'); return; }
  openModal(`<h2>Report an incident</h2><p>Share clear, on-ground information. The NEResq dispatch team will review it immediately.</p>
    <form class="report-form" id="reportForm"><input required placeholder="Incident title (e.g. Rockfall on NH-54)"><select required><option value="">Select district</option><option>Dima Hasao, Assam</option><option>Phek, Nagaland</option><option>Tirap, Arunachal Pradesh</option><option>Mamit, Mizoram</option></select><textarea required placeholder="Location, road condition, people affected, or other urgent details"></textarea><button class="primary">Submit secure report →</button></form>`);
  $('#reportForm').addEventListener('submit',async event=>{
    event.preventDefault(); const [title,district,details]=[...event.target.elements].filter(item=>['INPUT','SELECT','TEXTAREA'].includes(item.tagName)).map(item=>item.value);
    try { await apiFetch('/api/reports',{method:'POST',body:JSON.stringify({title,district,details})}); closeModal(); showToast('Incident report logged — dispatch desk notified.'); }
    catch(error) { showToast(error.message); }
  });
}

function showBeacon(data){
  const [name,soil,rain,score] = data.split('|');
  openModal(`<h2>${name}</h2><p>Live geotechnical telemetry from the NEResq monitoring network.</p><div class="modal-list"><div><b>Soil moisture saturation</b><span>${soil}</span></div><div><b>Rainfall rate</b><span>${rain}</span></div><div><b>Current risk score</b><span>${score}/100</span></div></div><button class="primary" data-action="dispatch">Dispatch alert to field team →</button>`);
}

async function changeView(view){
  $$('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===view));
  $('#sidebar').classList.remove('open');
  if(view==='Dashboard'){
    $('#dashboardView').classList.remove('hidden'); $('#genericView').classList.add('hidden');
    $('#viewTitle').textContent='Landslide Early Warning & Rescue System';
  } else {
    const [icon,title,text] = pageDetails[view];
    $('#dashboardView').classList.add('hidden'); $('#genericView').classList.remove('hidden');
    $('#genericIcon').textContent=icon; $('#genericTitle').textContent=title; $('#genericText').textContent=text; $('#viewTitle').textContent=title;
    await renderTabData(view);
  }
}

async function renderTabData(view) {
  const target = $('#genericView .empty-state');
  const endpoints = { 'Live Map':'/api/map', 'Risk Prediction':'/api/risk-predictions', Alerts:'/api/alerts', 'Rescue Teams':'/api/rescue-teams', 'Data & Analytics':'/api/analytics', Reports:'/api/reports', Settings:'/api/settings' };
  if (!endpoints[view]) return;
  target.innerHTML = `<span id="genericIcon">⌛</span><h2>Loading ${safe(view)}…</h2><p>Retrieving authenticated operational data.</p>`;
  try {
    const data = await apiFetch(endpoints[view]);
    let body = '';
    if (view === 'Live Map') body = `<p><b>${safe(data.coverage)}</b> · updated ${safe(data.updatedAt)}</p><div class="modal-list">${data.zones.map(item=>`<div><b>${safe(item.district)} · ${safe(item.risk)} risk (${safe(item.score)}/100)</b><p>Soil: ${safe(item.soilMoisture)} · Rainfall: ${safe(item.rainfall)}<br>${safe(item.status)}</p></div>`).join('')}</div>`;
    if (view === 'Risk Prediction') body = `<div class="modal-list">${data.predictions.map(item=>`<div><b>${safe(item.district)} · ${safe(item.probability)}% likelihood</b><p>${safe(item.window)} — ${safe(item.driver)}<br><strong>${safe(item.action)}</strong></p></div>`).join('')}</div>`;
    if (view === 'Alerts') body = `<div class="modal-list">${data.alerts.map(item=>`<div><b>${safe(item.level)} · ${safe(item.location)}</b><p>${safe(item.message)}<br>${safe(item.time)} · ${safe(item.status)}</p></div>`).join('')}</div>`;
    if (view === 'Rescue Teams') body = `<div class="modal-list">${data.teams.map(item=>`<div><b>${safe(item.name)} · ${safe(item.status)}</b><p>${safe(item.district)} · ${safe(item.responders)} responders · ETA: ${safe(item.eta)}<br>${safe(item.equipment)}</p></div>`).join('')}</div>`;
    if (view === 'Data & Analytics') body = `<div class="modal-list"><div><b>System health</b><span>${safe(data.sensorHealth)}%</span></div><div><b>Sensor coverage</b><span>${safe(data.onlineSensors)} online across ${safe(data.monitoredDistricts)} districts</span></div><div><b>24-hour rainfall · Dima Hasao</b><span>${safe(data.rainfall24h)} mm</span></div></div>`;
    if (view === 'Reports') body = `${currentUser()?.role === 'guest' ? '<p>Guest access is view-only. Sign in as an operator to create a report.</p>' : '<button class="primary" data-action="report">Create incident report</button>'}<div class="modal-list">${data.reports.map(item=>`<div><b>${safe(item.id)} · ${safe(item.title)}</b><p>${safe(item.district)} · ${safe(item.priority)} · ${safe(item.status)}<br>${safe(item.createdAt)}</p></div>`).join('')}</div>`;
    if (view === 'Settings') body = `<div class="modal-list"><div><b>Rainfall alert threshold</b><span>${safe(data.rainfallAlertThreshold)} mm / 24h</span></div><div><b>Soil saturation threshold</b><span>${safe(data.soilSaturationThreshold)}%</span></div><div><b>Notifications</b><span>${data.notificationsEnabled ? 'Enabled' : 'Disabled'}</span></div><div><b>Rainfall animation</b><span>${data.rainfallAnimationEnabled ? 'Enabled' : 'Disabled'}</span></div></div>`;
    target.innerHTML = `<span id="genericIcon">${safe(pageDetails[view][0])}</span><h2 id="genericTitle">${safe(view)}</h2><p id="genericText">Live, authenticated data from the NEResq operations API.</p>${body}<button class="primary" data-view="Dashboard">Return to dashboard</button>`;
  } catch (error) {
    target.innerHTML = `<span id="genericIcon">⚠</span><h2 id="genericTitle">Unable to load ${safe(view)}</h2><p id="genericText">${safe(error.message)} Sign in again or verify the API deployment.</p><button class="primary" data-view="Dashboard">Return to dashboard</button>`;
  }
}

async function authenticate(event){
  event.preventDefault();
  const email=$('#email').value.trim(), password=$('#password').value;
  const submit = $('#authForm button[type="submit"]');
  $('#authError').textContent=''; submit.disabled=true; submit.textContent='Signing in…';
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    const data = await response.json();
    if(!response.ok) throw new Error(data.message || 'Unable to sign in.');
    completeSession(data); showToast(`Secure session started. Welcome, ${data.user.name}.`);
  } catch(error) { $('#authError').textContent=error.message === 'Failed to fetch' ? 'Cannot reach the authentication service. Check API_URL.' : error.message; }
  finally { submit.disabled=false; submit.textContent='Secure sign in →'; }
}

async function guestSignIn(){
  const button = $('#guestSignIn'); button.disabled = true; button.textContent = 'Opening guest access…'; $('#authError').textContent = '';
  try {
    const response = await fetch(`${API_URL}/api/auth/guest`, { method:'POST', headers:{'Content-Type':'application/json'} });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Unable to start guest access.');
    completeSession(data); showToast('Guest viewer access started. View-only permissions are active.');
  } catch(error) { $('#authError').textContent = error.message === 'Failed to fetch' ? 'Cannot reach the authentication service. Check API_URL.' : error.message; }
  finally { button.disabled = false; button.textContent = 'Continue as guest viewer'; }
}

async function restoreSession(){
  const token=sessionStorage.getItem('neresqToken');
  if(!token) return;
  try {
    const response=await fetch(`${API_URL}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`}});
    const data=await response.json();
    if(!response.ok) throw new Error();
    sessionStorage.setItem('neresqUser',JSON.stringify(data.user));
    $('#avatar').textContent=data.user.name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase();
    $('#authOverlay').classList.add('hidden');
  } catch { sessionStorage.removeItem('neresqToken'); sessionStorage.removeItem('neresqUser'); }
}

document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  const view=event.target.closest('[data-view]')?.dataset.view;
  if(view) changeView(view);
  if(action==='menu-open') $('#sidebar').classList.add('open');
  if(action==='menu-close') $('#sidebar').classList.remove('open');
  if(action==='helpline') openHelpline();
  if(action==='report') openReport();
  if(action==='close-modal') closeModal();
  if(action==='dispatch'){closeModal();showToast('Field alert dispatched to the nearest rescue team.');}
  if(action==='radar'){ $('#radarSweep').classList.toggle('visible'); event.target.classList.toggle('active'); }
  if(action==='theme'){ document.body.classList.toggle('dark'); showToast(document.body.classList.contains('dark')?'Night monitoring mode active.':'Day monitoring mode active.'); }
  if(action==='notifications') changeView('Alerts');
  if(action==='profile') { const user = currentUser(); openModal(`<h2>${safe(user?.name || 'NEResq user')}</h2><p>${safe(user?.role === 'guest' ? 'Guest viewer · view-only access' : 'Operator · rescue coordinator')}</p><button class="primary" data-action="signout">Sign out</button>`); }
  if(action==='signout') { sessionStorage.removeItem('neresqToken'); sessionStorage.removeItem('neresqUser'); closeModal(); $('#authForm').reset(); $('#authOverlay').classList.remove('hidden'); showToast('You have signed out.'); }
  if(action==='toast') showToast(event.target.dataset.message);
  const beacon=event.target.closest('[data-beacon]'); if(beacon) showBeacon(beacon.dataset.beacon);
  const alert=event.target.closest('[data-alert]'); if(alert){ const item=alerts[alert.dataset.alert]; openModal(`<h2>${item.location}</h2><p><b>${item.level} priority</b> · ${item.time}</p><p>${item.detail}</p><div class="modal-list"><div><b>Response recommendation</b><span>${item.level==='High'?'Stage 2 evacuation advised':'Field verification in progress'}</span></div></div><button class="primary" data-action="dispatch">Alert field response team →</button>`); }
});

$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal();});
$('#authForm').addEventListener('submit',authenticate);
$('#guestSignIn').addEventListener('click', guestSignIn);
$('#passwordToggle').addEventListener('click',()=>{const input=$('#password');input.type=input.type==='password'?'text':'password';});
$('#mapSearch').addEventListener('input',e=>{const query=e.target.value.toLowerCase();$$('.beacon').forEach(beacon=>{beacon.style.opacity=(!query||beacon.dataset.beacon.toLowerCase().includes(query))?'1':'.15';});});
$('#riskFilters').addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;$$('#riskFilters button').forEach(x=>x.classList.remove('selected'));button.classList.add('selected');const risk=button.dataset.risk;$$('.beacon').forEach(beacon=>{const visible=risk==='all'||beacon.classList.contains(risk);beacon.style.opacity=visible?'1':'.12';});});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeModal();$('#sidebar').classList.remove('open');}if(event.key==='d'||event.key==='D')changeView('Dashboard');if(event.key==='m'||event.key==='M')changeView('Live Map');if(event.key==='r'||event.key==='R')openReport();if(event.key==='h'||event.key==='H')openHelpline();});

renderAlerts();
restoreSession();
