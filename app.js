const app = document.getElementById('app');
const state = {
  user: null, exams: [], results: [], violations: [], users: [], currentExam: null,
  attempt: null, currentIndex: 0, heartbeat: null, timer: null, watchers: [],
  streams: { camera: null, screen: null }, blocked: false, blockedPoll: null, accountPoll: null
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const formatDate = (v) => v ? new Date(v).toLocaleString('id-ID') : '-';
const toast = (m, kind = '') => { const el = document.createElement('div'); el.className = 'toast ' + (kind ? kind + '-text' : ''); el.textContent = m; document.body.appendChild(el); setTimeout(() => el.remove(), 3200); };

async function api(path, opts = {}) {
  const headers = { ...(opts.body instanceof FormData ? {} : { 'content-type':'application/json' }), ...(opts.headers || {}) };
  const res = await fetch('/api/' + path, { ...opts, headers });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { error: text || 'Response tidak valid' }; }
  if (!res.ok) {
    if (res.status === 423 && data.code === 'ACCOUNT_BLOCKED') showBlockedScreen(data);
    if (res.status === 410 && data.code === 'ACCOUNT_DELETED') showDeletedScreen(data);
    throw Object.assign(new Error(data.error || 'Request gagal'), { data, status: res.status });
  }
  return data;
}

async function boot() {
  try {
    const me = await api('auth/me');
    state.user = me.user;
    if (!state.user) return renderEntrance();
    if (state.user.status === 'blocked' || Number(state.user.active) === 0) return showBlockedScreen({ user: state.user, reason: state.user.block_reason });
    await loadDashboard();
    startAccountMonitor();
  } catch (err) {
    if (err?.status === 423 || err?.status === 410) return;
    renderEntrance();
  }
}

function renderEntrance(){
  hideBlockedScreen();
  if(sessionStorage.getItem('ujianpro_intro_seen')==='1') return renderLanding();
  app.innerHTML=`<section class="intro-screen" aria-label="Pembuka UjianPro">
    <div class="intro-orbit one"></div><div class="intro-orbit two"></div><div class="intro-sparks"></div>
    <div class="intro-content">
      <div class="intro-wordmark">HOLOW</div>
      <p class="intro-tagline">Jadilah awan hitam yang menutupi para bintang</p>
      <p class="intro-powered">Powered by UjianPro</p>
      <div class="intro-progress"><span></span></div>
      <button id="introSkip" class="neo-btn neon">↦ &nbsp; SKIP</button>
    </div>
  </section>`;
  const skip=()=>{sessionStorage.setItem('ujianpro_intro_seen','1');renderLanding();};
  $('#introSkip').onclick=skip;
  setTimeout(()=>{ if($('#introSkip')) skip(); },3200);
}

function renderLanding(){
  hideBlockedScreen();
  app.innerHTML=`<main class="cyber-home">
    <div class="grid-glow"></div><div class="scanlines"></div>
    <section class="home-hero">
      <div class="home-logo-wrap"><img src="/logo.jpg" alt="Holow Execution" class="home-logo"></div>
      <div class="home-title">HOLOW<br>EXECUTION</div>
      <div class="home-subtitle">Premium School Examination</div>
      <div class="hero-video-frame">
        <video class="hero-video" autoplay muted loop playsinline preload="metadata" poster="/hero-poster.jpg" aria-label="Animasi HOLOW EXECUTION">
          <source src="/hero-animated.mp4" type="video/mp4">
        </video>
        <div class="hero-video-glow"></div>
      </div>
      <button id="goLogin" class="neo-btn neon wide enter-login-animated">↪ &nbsp; ENTER LOGIN</button>
    </section>
    <section class="feature-stack">
      <article class="feature-card"><div class="feature-icon">ϟ</div><div><h3>ULTRA FAST</h3><p>Ujian ringan dan responsif di perangkat sekolah.</p></div></article>
      <article class="feature-card"><div class="feature-icon shield">◈</div><div><h3>SECURE</h3><p>Audit log, timer, dan kontrol sesi ujian terpusat.</p></div></article>
    </section>
    <div class="home-note">UjianPro • School Edition</div>
  </main>`;
  $('#goLogin').onclick=renderLogin;
}

function renderLogin() {
  hideBlockedScreen();
  app.innerHTML=`<main class="login-screen cyber-page"><div class="scanlines"></div><div class="login-shell">
    <div class="login-logo-wrap"><img src="/logo.jpg" alt="Holow Execution" class="login-logo"></div>
    <div class="login-name">HOLOW<br>EXECUTION</div>
    <div class="login-sub">Premium School Examination</div>
    <form id="loginForm" class="login-form">
      <label class="neo-field"><span class="field-icon">◌</span><input name="username" autocomplete="username" placeholder="Username" required></label>
      <label class="neo-field"><span class="field-icon">◼</span><input id="passwordInput" name="password" type="password" autocomplete="current-password" placeholder="Password" required><button type="button" class="eye-btn" id="togglePassword" aria-label="Tampilkan password">◉</button></label>
      <button class="neo-btn neon wide" type="submit">↪ &nbsp; LOGIN</button>
    </form>
    <div class="login-foot">◈ Secure login • Encrypted connection</div>
    <button class="back-link" id="backHome">← Kembali</button>
    <div class="demo-hint">Demo: murid01 / 123456 • guru01 / 123456 • admin / admin123</div>
  </div></main>`;
  $('#togglePassword').onclick=()=>{const p=$('#passwordInput');p.type=p.type==='password'?'text':'password';};
  $('#backHome').onclick=renderLanding;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api('auth/login', { method:'POST', body:JSON.stringify({ username:f.get('username'), password:f.get('password') }) });
      state.user = r.user; toast('Login berhasil','ok'); await loadDashboard(); startAccountMonitor();
    } catch (err) {
      if (err.status === 423) return;
      toast(err.message,'danger');
    }
  };
}

async function loadDashboard() {
  if (state.user.role === 'murid') await Promise.all([loadExams(), loadResults()]);
  else await Promise.all([loadExams(), loadResults(), loadViolations()]);
  renderDashboard();
}

function startAccountMonitor(){
  clearInterval(state.accountPoll);
  if(!state.user || state.blocked) return;
  const tick=async()=>{
    if(!state.user || state.blocked) return;
    try{
      const me=await api('auth/me');
      if(!me.user){
        return showDeletedScreen({message:'Akun ini sudah dihapus oleh Admin dan tidak dapat digunakan lagi.'});
      }
      if(me.user.status==='deleted') return showDeletedScreen({user:me.user});
      if(me.user.status==='blocked' || Number(me.user.active)===0){
        return showBlockedScreen({user:me.user,reason:me.user.block_reason});
      }
      state.user=me.user;
    }catch(err){
      if(err.status===410) showDeletedScreen(err.data);
    }
  };
  state.accountPoll=setInterval(tick,3000);
}
async function loadExams() { state.exams = (await api('exams')).exams; }
async function loadResults() { state.results = (await api('results')).results; }
async function loadViolations() { state.violations = (await api('violations')).violations; }
async function loadUsers() { state.users = (await api('users')).users; }

function shell(content) {
  app.innerHTML = `<div class="wrap"><div class="top"><div class="brand">UjianPro<small>${esc(state.user.name)} · ${esc(state.user.role)}</small></div><div class="row"><span class="pill">${navigator.onLine?'online':'offline'}</span><button id="logout" class="btn">Keluar</button></div></div>${content}</div>`;
  $('#logout').onclick = async () => { clearInterval(state.accountPoll); state.accountPoll=null; await api('auth/logout',{method:'POST'}); location.reload(); };
}

function renderDashboard() { if (state.user.role === 'murid') return studentDash(); return staffDash(); }

function studentDash() {
  const name=esc(state.user.name||'Murid');
  app.innerHTML=`<main class="student-home cyber-page"><div class="scanlines"></div>
    <div class="student-top"><div><div class="student-brand">UjianPro <span>HOLOW</span></div><div class="student-welcome">${name}</div></div><div class="row"><span class="status-orb">${navigator.onLine?'ONLINE':'OFFLINE'}</span><button id="logout" class="neo-btn small">KELUAR</button></div></div>
    <section class="student-banner"><div class="banner-copy"><div class="eyebrow">SCHOOL EXAMINATION</div><h1>Dashboard Murid</h1><p>Pilih ujian aktif. Sistem akan menyimpan jawaban dan mencatat kejadian penting selama sesi.</p></div><div class="banner-mark"><img src="/logo.jpg" alt=""></div></section>
    <section class="student-section"><div class="section-head"><h2>UJIAN</h2><span class="section-line"></span></div><div id="examList" class="exam-grid"></div></section>
    <section class="student-section"><div class="section-head"><h2>HASIL TERBARU</h2><span class="section-line"></span></div><div id="resultList" class="result-grid"></div></section>
  </main>`;
  $('#logout').onclick = async () => { clearInterval(state.accountPoll); state.accountPoll=null; await api('auth/logout',{method:'POST'}); location.reload(); };
  const el = $('#examList');
  if (!state.exams.length) el.innerHTML = '<div class="notice">Belum ada ujian aktif.</div>';
  state.exams.forEach(e => {
    const r = state.results.find(x => x.title === e.title);
    const d = document.createElement('article'); d.className='exam-card-cyber';
    d.innerHTML = `<div class="exam-card-line"></div><div class="exam-kicker">EXAM // ${String(e.id).padStart(3,'0')}</div><h3>${esc(e.title)}</h3><p>${esc(e.description||'')}</p><div class="exam-meta"><span>${e.duration_minutes} MIN</span><span>${e.require_camera?'CAMERA':'NO CAMERA'}</span><span>${e.require_screen?'SCREEN':'NO SCREEN'}</span></div><button class="neo-btn ${r?'':'neon'}">${r?'VIEW STATUS':'START EXAM'}</button>`;
    d.querySelector('button').onclick = () => r ? toast('Kamu sudah punya sesi untuk ujian ini.','warn') : startExam(e);
    el.appendChild(d);
  });
  const rl = $('#resultList');
  if (!state.results.length) rl.innerHTML = '<div class="notice">Belum ada hasil.</div>';
  state.results.slice(0,8).forEach(x => { const d=document.createElement('div'); d.className='result-chip'; d.innerHTML=`<div><b>${esc(x.title)}</b><div>${esc(x.status)}</div></div><strong>${x.score??0}</strong><span>${x.violation_count} pelanggaran</span>`; rl.appendChild(d); });
}

async function staffDash() {
  const adminTools = state.user.role==='admin' ? '<button class="btn" id="usersBtn">Akun</button><button class="btn" id="studentsBtn">Riwayat Murid</button>' : '';
  shell(`<div class="row space"><div><h1 class="title">Dashboard ${state.user.role==='admin'?'Admin':'Guru'}</h1><p class="subtitle">Kelola ujian, hasil, akun, dan audit log.</p></div><div class="row"><button class="btn primary" id="newExam">+ Ujian</button>${adminTools}<button class="btn" id="refreshBtn">Refresh</button></div></div><div class="grid grid3" style="margin:16px 0"><div class="stat"><div class="muted">Ujian</div><b>${state.exams.length}</b></div><div class="stat"><div class="muted">Attempt</div><b>${state.results.length}</b></div><div class="stat"><div class="muted">Pelanggaran</div><b>${state.violations.length}</b></div></div><div class="grid grid2"><div class="card"><h2>Ujian</h2><div id="staffExams" class="list"></div></div><div class="card"><h2>Log pelanggaran terbaru</h2><div id="violList" class="list"></div><h2 style="margin-top:18px">Evidence terbaru</h2><div id="eviList" class="list"></div></div></div><div class="card" style="margin-top:16px"><h2>Hasil peserta</h2><div class="table-wrap"><table class="table"><thead><tr><th>Peserta</th><th>Ujian</th><th>Status</th><th>Nilai</th><th>Pelanggaran</th><th>Mulai</th><th>Akhir</th></tr></thead><tbody id="resultRows"></tbody></table></div></div>`);
  $('#newExam').onclick=()=>examModal();
  $('#refreshBtn').onclick=async()=>{await loadDashboard();toast('Data diperbarui','ok')};
  if ($('#usersBtn')) $('#usersBtn').onclick=async()=>{await loadUsers();usersModal();};
  if ($('#studentsBtn')) $('#studentsBtn').onclick=async()=>{await loadUsers();studentsHistoryModal();};

  const exel=$('#staffExams');
  state.exams.forEach(e=>{
    const d=document.createElement('div'); d.className='item';
    d.innerHTML=`<h3>${esc(e.title)}</h3><div class="muted">${e.duration_minutes} menit · ${e.is_active?'AKTIF':'NONAKTIF'} · lock=${e.lock_on_violation?'ON':'OFF'}</div><div class="row" style="margin-top:10px"><button class="btn">Edit</button><button class="btn primary">Soal</button><button class="btn ${e.is_active?'danger':'ok'}">${e.is_active?'Matikan':'Aktifkan'}</button><button class="btn danger">Hapus ujian</button></div>`;
    const bs=d.querySelectorAll('button');
    bs[0].onclick=()=>examModal(e);
    bs[1].onclick=()=>questionModal(e);
    bs[2].onclick=async()=>{await api('exams/'+e.id,{method:'PUT',body:JSON.stringify({...e,is_active:e.is_active?0:1})});await loadDashboard();};
    bs[3].onclick=async()=>{
      if(e.is_active) return toast('Matikan ujian terlebih dahulu sebelum menghapusnya.','warn');
      if(!confirm(`Hapus ujian "${e.title}" saja? Soal, percobaan, jawaban, pelanggaran, dan evidence yang terkait dengan ujian ini juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
      try{await api('exams/'+e.id,{method:'DELETE'});toast('Ujian dihapus','ok');await loadDashboard();}catch(err){toast(err.message,'danger')}
    };
    exel.appendChild(d);
  });
  const vl=$('#violList');
  if (!state.violations.length) vl.innerHTML='<div class="notice">Belum ada pelanggaran.</div>';
  state.violations.slice(0,8).forEach(v=>{const d=document.createElement('div');d.className='item';d.innerHTML=`<b>${esc(v.type)}</b><div>${esc(v.name)} · ${esc(v.exam_title)}</div><div class="muted">${esc(v.reason)} · ${formatDate(v.created_at)}</div>`;vl.appendChild(d)});
  try {
    const evs=(await api('evidence')).evidence; const el=$('#eviList'); if(!evs.length)el.innerHTML='<div class="notice">Belum ada evidence.</div>';
    evs.slice(0,6).forEach(v=>{const d=document.createElement('div');d.className='item';d.innerHTML=`<b>${esc(v.type)}</b> · ${esc(v.name)}<div class="muted">${esc(v.exam_title)} · ${(v.bytes/1024/1024).toFixed(2)} MB · ${formatDate(v.created_at)}</div><button class="btn" style="margin-top:8px">Buka</button>`;d.querySelector('button').onclick=()=>window.open('/api/evidence/'+v.id,'_blank','noopener');el.appendChild(d)});
  } catch {}
  const rr=$('#resultRows'); state.results.forEach(r=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(r.name||r.username||'-')}</td><td>${esc(r.title)}</td><td>${esc(r.status)}</td><td>${r.score}</td><td>${r.violation_count}</td><td>${formatDate(r.started_at)}</td><td>${formatDate(r.submitted_at)}</td>`;rr.appendChild(tr);});
}

function modal(html, options={}) {
  const back=document.createElement('div'); back.className='modal-back'; back.innerHTML=`<div class="modal card">${html}</div>`; document.body.appendChild(back);
  if(options.noBackdropClose!==true) back.addEventListener('click',e=>{if(e.target===back)back.remove()});
  return back;
}

function examModal(e={}) {
  const m=modal(`<div class="row space"><h2>${e.id?'Edit':'Buat'} Ujian</h2><button class="btn" data-close>Tutup</button></div><form id="examForm" class="grid"><div class="field"><label>Judul</label><input class="input" name="title" value="${esc(e.title||'')}" required></div><div class="field"><label>Deskripsi</label><textarea class="textarea" name="description">${esc(e.description||'')}</textarea></div><div class="grid grid2"><div class="field"><label>Durasi (menit)</label><input class="input" name="duration_minutes" type="number" min="1" max="600" value="${e.duration_minutes||30}"></div><div class="field"><label>Status</label><select class="select" name="is_active"><option value="1" ${e.is_active?'selected':''}>Aktif</option><option value="0" ${!e.is_active?'selected':''}>Nonaktif</option></select></div></div><div class="checks"><label class="check"><input type="checkbox" name="lock_on_violation" ${e.lock_on_violation!==false&&e.lock_on_violation!==0?'checked':''}> Kunci sesi saat pelanggaran</label><label class="check"><input type="checkbox" name="require_camera" ${e.require_camera?'checked':''}> Wajib kamera</label><label class="check"><input type="checkbox" name="require_screen" ${e.require_screen?'checked':''}> Minta screen-share</label><label class="check"><input type="checkbox" name="capture_evidence" ${e.capture_evidence!==false&&e.capture_evidence!==0?'checked':''}> Simpan evidence singkat</label></div><div class="notice warn">Kamera dan screen-share memerlukan izin browser. Website tidak dapat mengunci seluruh Android.</div><button class="btn primary">Simpan</button></form>`);
  $('[data-close]',m).onclick=()=>m.remove();
  $('#examForm',m).onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);const body={title:f.get('title'),description:f.get('description'),duration_minutes:Number(f.get('duration_minutes')),is_active:f.get('is_active')==='1',lock_on_violation:f.has('lock_on_violation'),require_camera:f.has('require_camera'),require_screen:f.has('require_screen'),capture_evidence:f.has('capture_evidence')};try{await api(e.id?'exams/'+e.id:'exams',{method:e.id?'PUT':'POST',body:JSON.stringify(body)});m.remove();await loadDashboard();toast('Ujian disimpan','ok')}catch(err){toast(err.message,'danger')}};
}

async function questionModal(e){if(!e.questions)e=(await api('exams/'+e.id)).exam;const existing=e.questions||[];const m=modal(`<div class="row space"><h2>Soal: ${esc(e.title)}</h2><button class="btn" data-close>Tutup</button></div><div id="qList" class="list"></div><hr style="border-color:var(--border)"><h3>Tambah soal</h3><form id="qForm" class="grid"><div class="field"><label>Pertanyaan</label><textarea class="textarea" name="prompt" required></textarea></div><div class="grid grid2"><input class="input" name="option_a" placeholder="Pilihan A" required><input class="input" name="option_b" placeholder="Pilihan B" required><input class="input" name="option_c" placeholder="Pilihan C" required><input class="input" name="option_d" placeholder="Pilihan D" required></div><div class="grid grid2"><div class="field"><label>Kunci</label><select class="select" name="correct_option"><option>A</option><option>B</option><option>C</option><option>D</option></select></div><div class="field"><label>Poin</label><input class="input" name="points" type="number" min="1" value="1"></div></div><button class="btn primary">Tambah soal</button></form>`);$('[data-close]',m).onclick=()=>m.remove();const list=$('#qList',m);if(!existing.length)list.innerHTML='<div class="notice">Belum ada soal.</div>';existing.forEach(q=>{const d=document.createElement('div');d.className='item';d.innerHTML=`<b>${q.order_no}. ${esc(q.prompt)}</b><div class="muted">A. ${esc(q.option_a)} · B. ${esc(q.option_b)} · C. ${esc(q.option_c)} · D. ${esc(q.option_d)} · kunci ${q.correct_option??'?'}</div><div class="row" style="margin-top:8px"><button class="btn">Edit</button><button class="btn danger">Hapus</button></div>`;const bs=d.querySelectorAll('button');bs[0].onclick=()=>editQuestionModal(q,e,m);bs[1].onclick=async()=>{if(!confirm('Hapus soal ini?'))return;await api('questions/'+q.id,{method:'DELETE'});m.remove();await questionModal({...e,questions:(await api('exams/'+e.id)).exam.questions});};list.appendChild(d)});$('#qForm',m).onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);try{await api('exams/'+e.id+'/questions',{method:'POST',body:JSON.stringify({prompt:f.get('prompt'),option_a:f.get('option_a'),option_b:f.get('option_b'),option_c:f.get('option_c'),option_d:f.get('option_d'),correct_option:f.get('correct_option'),points:Number(f.get('points'))})});m.remove();questionModal(await api('exams/'+e.id).then(x=>x.exam));}catch(err){toast(err.message,'danger')}};
}

function editQuestionModal(q,e,parent){const m=modal(`<div class="row space"><h2>Edit soal</h2><button class="btn" data-close>Tutup</button></div><form id="editQ" class="grid"><div class="field"><label>Pertanyaan</label><textarea class="textarea" name="prompt" required>${esc(q.prompt)}</textarea></div><div class="grid grid2"><input class="input" name="option_a" value="${esc(q.option_a)}" required><input class="input" name="option_b" value="${esc(q.option_b)}" required><input class="input" name="option_c" value="${esc(q.option_c)}" required><input class="input" name="option_d" value="${esc(q.option_d)}" required></div><div class="grid grid2"><div class="field"><label>Kunci</label><select class="select" name="correct_option">${['A','B','C','D'].map(x=>`<option ${q.correct_option===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Poin</label><input class="input" name="points" type="number" min="1" value="${q.points||1}"></div></div><div class="field"><label>Nomor urut</label><input class="input" name="order_no" type="number" min="0" value="${q.order_no||0}"></div><button class="btn primary">Simpan perubahan</button></form>`);$('[data-close]',m).onclick=()=>m.remove();$('#editQ',m).onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);try{await api('questions/'+q.id,{method:'PUT',body:JSON.stringify({prompt:f.get('prompt'),option_a:f.get('option_a'),option_b:f.get('option_b'),option_c:f.get('option_c'),option_d:f.get('option_d'),correct_option:f.get('correct_option'),points:Number(f.get('points')),order_no:Number(f.get('order_no'))})});m.remove();parent.remove();await questionModal({...e,questions:(await api('exams/'+e.id)).exam.questions});toast('Soal diperbarui','ok')}catch(err){toast(err.message,'danger')}};}

async function usersModal(){
  const m=modal(`<div class="row space"><h2>Akun</h2><button class="btn" data-close>Tutup</button></div><div class="notice">Status <b>diblokir</b> berarti akun nonaktif dan murid akan melihat layar blokir sampai Admin mengaktifkannya kembali.</div><div id="uList" class="list" style="margin-top:12px"></div><hr style="border-color:var(--border)"><h3>Buat akun</h3><form id="uForm" class="grid"><div class="grid grid2"><input class="input" name="username" placeholder="username" required><input class="input" name="name" placeholder="nama lengkap" required></div><div class="grid grid2"><input class="input" name="password" placeholder="password" required><select class="select" name="role"><option value="murid">Murid</option><option value="guru">Guru</option><option value="admin">Admin</option></select></div><button class="btn primary">Tambah akun</button></form>`);
  $('[data-close]',m).onclick=()=>m.remove(); const ul=$('#uList',m);
  if(!state.users.length)ul.innerHTML='<div class="notice">Belum ada akun.</div>';
  state.users.forEach(u=>{
    const status=u.status||((Number(u.active)===1)?'active':'inactive'); const statusText=status==='blocked'?'DIBLOKIR':status==='deleted'?'DIHAPUS':'AKTIF';
    const d=document.createElement('div');d.className='item';
    const statusAction=status==='blocked'?'<button class="btn ok">Aktifkan</button>':status==='active'?'<button class="btn danger">Blokir</button>':'';
    const deleteAction=status!=='deleted'?'<button class="btn danger">Hapus</button>':'';
    d.innerHTML=`<div class="row space"><div><b>${esc(u.username)}</b> · ${esc(u.name)}<div class="muted">${esc(u.role)} · ${statusText}</div>${status==='blocked'?`<div class="muted">Alasan: ${esc(u.block_reason||'-')}</div>`:''}</div><div class="row"><button class="btn">Password</button>${u.role==='murid'?'<button class="btn">Riwayat</button><button class="btn danger">Akhiri ujian</button>':''}${statusAction}${deleteAction}</div></div>`;
    const buttons=d.querySelectorAll('button'); let offset=0;
    buttons[offset++].onclick=async()=>{const np=prompt('Password baru untuk '+u.username+':');if(np){try{await api('users/'+u.id,{method:'PATCH',body:JSON.stringify({action:'password',password:np})});toast('Password diubah','ok')}catch(err){toast(err.message,'danger')}}};
    if(u.role==='murid'){
      buttons[offset++].onclick=async()=>{m.remove();await studentHistoryModal(u);};
      buttons[offset++].onclick=async()=>{m.remove();await activeAttemptsModal(u);};
    }
    if(status==='blocked' || status==='active'){
      const statusButton=buttons[offset++];
      statusButton.onclick=async()=>{try{if(status==='blocked'){await api('users/'+u.id,{method:'PATCH',body:JSON.stringify({action:'activate'})});toast('Akun diaktifkan','ok')}else{const reason=prompt('Alasan pemblokiran untuk '+u.username+':');if(!reason)return;await api('users/'+u.id,{method:'PATCH',body:JSON.stringify({action:'block',reason})});toast('Akun diblokir','warn')}m.remove();await loadUsers();usersModal();}catch(err){toast(err.message,'danger')}};
    }
    if(status!=='deleted'){
      const deleteButton=buttons[offset++];
      deleteButton.onclick=async()=>{if(u.id===state.user.id)return toast('Akun yang sedang dipakai tidak bisa dihapus.','warn');if(!confirm(`HAPUS PERMANEN akun ${u.username}? Akun, sesi, percobaan ujian, jawaban, pelanggaran, dan evidence milik murid akan dihapus. Tindakan ini tidak dapat dibatalkan.`))return;try{await api('users/'+u.id,{method:'DELETE'});toast('Akun dihapus','ok');m.remove();await loadUsers();usersModal();}catch(err){toast(err.message,'danger')}};
    }
    ul.appendChild(d);
  });
  $('#uForm',m).onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);try{await api('users',{method:'POST',body:JSON.stringify({username:f.get('username'),name:f.get('name'),password:f.get('password'),role:f.get('role')})});m.remove();await loadUsers();usersModal();toast('Akun dibuat','ok')}catch(err){toast(err.message,'danger')}};
}

async function activeAttemptsModal(student){
  try{
    const r=await api('users/'+student.id+'/history');
    const h=r.history;
    const active=(h.attempts||[]).filter(a=>a.status==='in_progress');
    const m=modal(`<div class="row space"><h2>Akhiri ujian · ${esc(student.name)}</h2><button class="btn" data-close>Tutup</button></div><p class="subtitle">Admin dapat mengakhiri sesi ujian yang masih berjalan. Jawaban yang sudah tersimpan akan dinilai.</p><div id="activeAttempts" class="list"></div>`);
    $('[data-close]',m).onclick=()=>m.remove();
    const list=$('#activeAttempts',m);
    if(!active.length){list.innerHTML='<div class="notice">Murid ini tidak memiliki ujian yang sedang berjalan.</div>';return;}
    active.forEach(a=>{
      const d=document.createElement('div');d.className='item';
      d.innerHTML=`<div class="row space"><div><b>${esc(a.title)}</b><div class="muted">Mulai ${formatDate(a.started_at)} · Pelanggaran: ${a.violation_count}</div></div><button class="btn danger">Akhiri ujian</button></div>`;
      d.querySelector('button').onclick=async()=>{
        if(!confirm(`Akhiri ujian "${a.title}" untuk ${student.name}? Jawaban yang tersimpan akan dinilai.`))return;
        try{
          const rr=await api('attempts/'+a.id+'/terminate',{method:'POST',body:JSON.stringify({reason:'Diakhiri oleh Admin'})});
          toast('Ujian diakhiri. Nilai: '+rr.score,'ok');
          m.remove();
          await loadDashboard();
          await activeAttemptsModal(student);
        }catch(err){toast(err.message,'danger')}
      };
      list.appendChild(d);
    });
  }catch(err){toast(err.message,'danger')}
}

async function studentsHistoryModal(){
  const m=modal(`<div class="row space"><h2>Riwayat Murid</h2><button class="btn" data-close>Tutup</button></div><p class="subtitle">Pilih murid untuk melihat seluruh percobaan, nilai, pelanggaran, dan tindakan Admin.</p><div id="studentList" class="list"></div>`);
  $('[data-close]',m).onclick=()=>m.remove(); const el=$('#studentList',m); const students=state.users.filter(x=>x.role==='murid');
  if(!students.length)el.innerHTML='<div class="notice">Belum ada akun murid.</div>';
  students.forEach(u=>{
    const status=u.status||'active'; const d=document.createElement('div');d.className='item';
    const action=status==='blocked'?'<button class="btn ok">Aktifkan</button>':status==='active'?'<button class="btn danger">Blokir</button>':'';
    d.innerHTML=`<div class="row space"><div><b>${esc(u.name)}</b><div class="muted">${esc(u.username)} · ${status==='blocked'?'DIBLOKIR':status==='deleted'?'DIHAPUS':'AKTIF'}</div></div><div class="row"><button class="btn primary">Lihat riwayat</button>${action}</div></div>`;
    const bs=d.querySelectorAll('button'); bs[0].onclick=async()=>{m.remove();await studentHistoryModal(u);};
    if(bs[1])bs[1].onclick=async()=>{try{if(status==='blocked')await api('users/'+u.id,{method:'PATCH',body:JSON.stringify({action:'activate'})});else{const reason=prompt('Alasan pemblokiran:');if(!reason)return;await api('users/'+u.id,{method:'PATCH',body:JSON.stringify({action:'block',reason})});}toast(status==='blocked'?'Akun diaktifkan':'Akun diblokir','ok');m.remove();await loadUsers();studentsHistoryModal();}catch(err){toast(err.message,'danger')}};
    el.appendChild(d);
  });
}

async function studentHistoryModal(student){
  try {
    const r=await api('users/'+student.id+'/history'); const h=r.history; const m=modal(`<div class="row space"><h2>Riwayat: ${esc(h.student.name)}</h2><button class="btn" data-close>Tutup</button></div><div class="grid grid3" style="margin:14px 0"><div class="stat"><div class="muted">Percobaan</div><b>${h.attempts.length}</b></div><div class="stat"><div class="muted">Pelanggaran</div><b>${h.violations.length}</b></div><div class="stat"><div class="muted">Status akun</div><b>${h.student.status==='blocked'?'DIBLOKIR':h.student.status==='deleted'?'DIHAPUS':'AKTIF'}</b></div></div><div class="card" style="margin-bottom:14px"><h3>Informasi akun</h3><div class="muted">${esc(h.student.username)} · ${esc(h.student.role)} · dibuat ${formatDate(h.student.created_at)}</div>${h.student.status==='blocked'?`<div class="notice danger" style="margin-top:10px">Alasan blokir: ${esc(h.student.block_reason||'-')}</div>`:''}</div><h3>Riwayat ujian</h3><div id="historyAttempts" class="list"></div><h3 style="margin-top:18px">Riwayat pelanggaran</h3><div id="historyViolations" class="list"></div>`);
    $('[data-close]',m).onclick=()=>m.remove(); const al=$('#historyAttempts',m), vl=$('#historyViolations',m);
    if(!h.attempts.length)al.innerHTML='<div class="notice">Belum ada percobaan ujian.</div>';
    h.attempts.forEach(a=>{const d=document.createElement('div');d.className='item';const active=a.status==='in_progress';d.innerHTML=`<div class="row space"><div><b>${esc(a.title)}</b><div class="muted">Status: ${esc(a.status)} · Nilai: ${a.score} · Pelanggaran: ${a.violation_count}</div><div class="muted">Mulai ${formatDate(a.started_at)} · Selesai ${formatDate(a.submitted_at)}${a.end_reason?' · '+esc(a.end_reason):''}</div></div><div class="row">${active?'<button class="btn danger">Akhiri ujian</button>':''}<button class="btn danger">Hapus percobaan</button></div></div>`;const bs=d.querySelectorAll('button');if(active)bs[0].onclick=async()=>{if(!confirm('Akhiri ujian murid ini sekarang? Jawaban yang tersimpan akan dinilai.'))return;try{const rr=await api('attempts/'+a.id+'/terminate',{method:'POST',body:JSON.stringify({reason:'Diakhiri oleh Admin'})});toast('Ujian diakhiri. Nilai: '+rr.score,'ok');m.remove();studentHistoryModal(student)}catch(err){toast(err.message,'danger')}};const del=bs[active?1:0];del.onclick=async()=>{if(!confirm('Hapus percobaan ini dan evidence terkait? Tindakan ini tidak dapat dibatalkan.'))return;try{await api('attempts/'+a.id,{method:'DELETE'});toast('Percobaan dihapus','ok');m.remove();studentHistoryModal(student)}catch(err){toast(err.message,'danger')}};al.appendChild(d);});
    if(!h.violations.length)vl.innerHTML='<div class="notice">Belum ada pelanggaran.</div>';
    h.violations.forEach(v=>{const d=document.createElement('div');d.className='item';d.innerHTML=`<b>${esc(v.type)}</b><div>${esc(v.exam_title)} · ${formatDate(v.created_at)}</div><div class="muted">${esc(v.reason)}</div>`;vl.appendChild(d)});
  } catch(err) { toast(err.message,'danger'); }
}

async function startExam(ex){
  try {
    const r=await api('exams/'+ex.id); state.currentExam=r.exam;
    const c='client-'+crypto.randomUUID(); const a=await api('exams/'+ex.id+'/start',{method:'POST',body:JSON.stringify({client_id:c})});
    state.attempt={id:a.attempt_id,status:'in_progress',answers:[],violations:[]}; state.currentIndex=0;
    await prepareExamMedia(); await enterExamUI();
  } catch(err) { if(state.blocked)return; toast(err.message,'danger'); }
}

async function prepareExamMedia(){
  const ex=state.currentExam;
  if(ex.require_camera){
    try { state.streams.camera=await navigator.mediaDevices.getUserMedia({video:true,audio:false}); }
    catch { toast('Izin kamera tidak diberikan. Ujian tidak dapat dimulai.','danger'); await lockCurrent('CAMERA_PERMISSION','Kamera wajib diizinkan untuk ujian.'); throw Error('Kamera wajib'); }
  }
  if(ex.require_screen){
    if(!navigator.mediaDevices.getDisplayMedia) throw Error('Browser tidak mendukung screen-share');
    try { state.streams.screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}); state.streams.screen.getVideoTracks()[0].addEventListener('ended',()=>registerViolation('SCREEN_SHARE_STOP','Screen-share dihentikan oleh pengguna.')); }
    catch { throw Error('Izin screen-share wajib diberikan'); }
  }
}

async function enterExamUI(){
  document.body.classList.add('lock-ui');
  shell(`<main class="exam-screen cyber-page"><div class="scanlines"></div>
    <div class="exam-topbar"><div><div class="exam-brand">UjianPro <span>HOLOW EXECUTION</span></div><div class="exam-title-mini">${esc(state.currentExam.title)}</div></div><div class="exam-top-actions"><div class="vio-pill">VIOLATIONS <b id="vioCount">0</b></div><div class="exam-timer"><span>TIME</span><b id="timer">--:--</b></div><button class="neo-btn danger small" id="finish">SUBMIT</button></div></div>
    <div class="exam-grid-layout">
      <aside class="exam-sidebar">
        <div class="side-card"><div class="side-title">QUESTION MAP</div><div class="qnav" id="qnav"></div></div>
        <div class="side-card"><div class="side-title">SYSTEM</div><div class="system-row"><span>Internet</span><b id="netStatus">${navigator.onLine?'ONLINE':'OFFLINE'}</b></div><div class="system-row"><span>Fullscreen</span><b id="fsStatus">READY</b></div></div>
        <video id="cam" class="media-preview cyber-media ${state.streams.camera?'':'hidden'}" autoplay muted playsinline></video>
        <video id="screen" class="media-preview cyber-media ${state.streams.screen?'':'hidden'}" autoplay muted playsinline></video>
      </aside>
      <section class="exam-main-panel"><div class="exam-warning">⚠ STAY ON THIS PAGE • TAB SWITCH, FULLSCREEN EXIT, OFFLINE, OR STOPPING SCREEN-SHARE MAY BE LOGGED.</div><div id="qbox" class="question-panel"></div><div class="exam-nav"><button class="neo-btn" id="prev">← PREVIOUS</button><button class="neo-btn neon" id="next">NEXT →</button></div><div class="exam-disclaimer">Penguncian seluruh Android memerlukan aplikasi kiosk terpisah.</div></section>
    </div>
  </main>`);
  if(state.streams.camera)$('#cam').srcObject=state.streams.camera;
  if(state.streams.screen)$('#screen').srcObject=state.streams.screen;
  setupExamWatchers(); renderQuestion(); startTimer();
  $('#prev').onclick=()=>{state.currentIndex=Math.max(0,state.currentIndex-1);renderQuestion()};
  $('#next').onclick=()=>{state.currentIndex=Math.min(state.currentExam.questions.length-1,state.currentIndex+1);renderQuestion()};
  $('#finish').onclick=()=>submitExam(false);
  try{await document.documentElement.requestFullscreen?.()}catch{}
}

function renderQuestion(){
  const qs=state.currentExam.questions; const q=qs[state.currentIndex]; const ans=new Map((state.attempt.answers||[]).map(a=>[a.question_id,a.selected_option]));
  $('#qnav').innerHTML=qs.map((x,i)=>`<button class="qdot-cy ${i===state.currentIndex?'active':''} ${ans.has(x.id)?'done':''}" data-i="${i}">${String(i+1).padStart(2,'0')}</button>`).join('');
  $$('.qdot-cy').forEach(b=>b.onclick=()=>{state.currentIndex=Number(b.dataset.i);renderQuestion()});
  $('#qbox').innerHTML=`<div class="question-number">QUESTION ${String(state.currentIndex+1).padStart(2,'0')} / ${String(qs.length).padStart(2,'0')}</div><h2 class="question-cy">${esc(q.prompt)}</h2><div class="options-cy">${['A','B','C','D'].map(o=>`<label class="option-cy ${ans.get(q.id)===o?'selected':''}"><input type="radio" name="answer" value="${o}" ${ans.get(q.id)===o?'checked':''}><span class="option-letter">${o}</span><span>${esc(q['option_'+o.toLowerCase()])}</span></label>`).join('')}</div>`;
  $$('input[name="answer"]').forEach(i=>i.onchange=async()=>{const selected=i.value;const idx=(state.attempt.answers||[]).findIndex(a=>a.question_id===q.id);if(idx>=0)state.attempt.answers[idx].selected_option=selected;else state.attempt.answers.push({question_id:q.id,selected_option:selected});try{await api('attempts/'+state.attempt.id+'/answer',{method:'POST',body:JSON.stringify({question_id:q.id,selected_option:selected})});renderQuestion()}catch(err){toast(err.message,'danger')}});
}

function startTimer(){
  const started=Date.now(); const total=state.currentExam.duration_minutes*60*1000; clearInterval(state.timer);
  state.timer=setInterval(()=>{const remain=total-(Date.now()-started); if(remain<=0){clearInterval(state.timer);submitExam(true);return;} const mm=Math.floor(remain/60000);const ss=Math.floor(remain/1000)%60; $('#timer').textContent=String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');},1000);
}

function setupExamWatchers(){
  const onVis=()=>{if(document.hidden)registerViolation('VISIBILITY_CHANGE','Halaman ujian ditinggalkan atau tab berpindah.')};
  const onFs=()=>{$('#fsStatus').textContent=document.fullscreenElement?'Aktif':'Keluar fullscreen';if(!document.fullscreenElement)registerViolation('FULLSCREEN_EXIT','Fullscreen ditinggalkan.')};
  const onOff=()=>{$('#netStatus').textContent='Terputus';if($('#conn'))$('#conn').textContent='offline';registerViolation('OFFLINE','Koneksi internet terputus.')};
  const onOn=()=>{$('#netStatus').textContent='Tersambung';if($('#conn'))$('#conn').textContent='online'};
  document.addEventListener('visibilitychange',onVis);document.addEventListener('fullscreenchange',onFs);window.addEventListener('offline',onOff);window.addEventListener('online',onOn);
  state.watchers=[['visibilitychange',onVis],['fullscreenchange',onFs],['offline',onOff],['online',onOn]];
  state.heartbeat=setInterval(async()=>{try{const r=await api('attempts/'+state.attempt.id+'/heartbeat',{method:'POST',body:'{}'});if(r.status==='locked'){stopExam();toast('Sesi ujian dikunci oleh sistem.','danger');await loadResults();return studentDash();}}catch(err){if(err.status===423)return;}},10000);
  window.onbeforeunload=e=>{e.preventDefault();e.returnValue='Ujian masih berlangsung.'};
  ['contextmenu','copy','cut','paste'].forEach(ev=>document.addEventListener(ev,blockExam));
}
function blockExam(e){e.preventDefault();registerViolation('BROWSER_ACTION','Percobaan menyalin/menempel atau menu konteks saat ujian.')}

async function captureEvidence(type,stream){
  if(!stream||!state.currentExam?.capture_evidence)return;
  return new Promise(resolve=>{try{const rec=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onerror=()=>resolve();rec.onstop=async()=>{try{const blob=new Blob(chunks,{type:'video/webm'});if(blob.size>25*1024*1024)return resolve();const fd=new FormData();fd.append('attempt_id',String(state.attempt.id));fd.append('type',type);fd.append('file',blob,`${type}-${Date.now()}.webm`);await fetch('/api/evidence',{method:'POST',body:fd})}catch{}finally{resolve()}};rec.start();setTimeout(()=>{try{if(rec.state==='recording')rec.stop()}catch{resolve()}},4000)}catch{resolve()}});
}

async function registerViolation(type,reason){
  if(!state.attempt||state.attempt.status!=='in_progress')return;
  try{const r=await api('attempts/'+state.attempt.id+'/violation',{method:'POST',body:JSON.stringify({type,reason,metadata:{url:location.href,visibility:document.visibilityState,online:navigator.onLine}})});state.attempt.status=r.locked?'locked':'in_progress';if($('#vioCount'))$('#vioCount').textContent=Number($('#vioCount').textContent||0)+1;if(r.locked){await Promise.all([captureEvidence('camera',state.streams.camera),captureEvidence('screen',state.streams.screen)]);stopExam();toast('Ujian dikunci karena pelanggaran.','danger');await loadResults();studentDash()}}catch(err){if(err.status===423)return;toast('Gagal mencatat pelanggaran: '+err.message,'danger')}}
async function lockCurrent(type,reason){try{await api('attempts/'+state.attempt.id+'/violation',{method:'POST',body:JSON.stringify({type,reason})})}catch{}}
async function submitExam(expired){if(!state.attempt||state.attempt.status!=='in_progress')return;try{const r=await api('attempts/'+state.attempt.id+'/submit',{method:'POST',body:'{}'});toast(expired?'Waktu habis, jawaban dikumpulkan.':'Ujian dikumpulkan.','ok');stopExam();await loadResults();studentDash()}catch(err){if(err.status===423)return;toast(err.message,'danger')}}

function stopExam(){
  clearInterval(state.heartbeat);clearInterval(state.timer);state.heartbeat=null;state.timer=null;window.onbeforeunload=null;
  for(const [ev,fn] of state.watchers){const target=ev==='offline'||ev==='online'?window:document;target.removeEventListener(ev,fn)} state.watchers=[];
  [state.streams.camera,state.streams.screen].forEach(s=>s?.getTracks().forEach(t=>t.stop())); state.streams={camera:null,screen:null};
  ['contextmenu','copy','cut','paste'].forEach(ev=>document.removeEventListener(ev,blockExam)); document.body.classList.remove('lock-ui'); try{document.exitFullscreen?.()}catch{}
}

function showBlockedScreen(data={}){
  state.blocked=true; state.user=data.user||state.user||null; stopExam();
  app.setAttribute('inert',''); document.body.classList.add('account-blocked');
  document.onkeydown=state.blocked?((e)=>{if(['Tab','Escape','Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault()}):null;
  let overlay=$('#blockedOverlay');
  if(!overlay){overlay=document.createElement('div');overlay.id='blockedOverlay';document.body.appendChild(overlay);}
  overlay.innerHTML=`<div class="blocked-panel"><div class="blocked-icon">!</div><h1>Akun Diblokir</h1><p class="blocked-main">Akses kamu sedang dinonaktifkan oleh Admin.</p><div class="blocked-status strong">Status akun: <b>DIBLOKIR</b></div><div class="blocked-reason"><b>Alasan pemblokiran:</b><br>${esc(data.reason||state.user?.block_reason||'Tidak dicantumkan.')}</div><p>Ujian/sesi kamu dapat dihentikan oleh Admin. <b>Jangan menutup halaman ini. Konfirmasi kepada Admin atau pengawas dan tunggu aktivasi.</b></p><div class="blocked-status"><span class="dot"></span> Menunggu aktivasi Admin…</div></div>`;
  if(state.blockedPoll)return;
  state.blockedPoll=setInterval(checkBlockedStatus,5000); checkBlockedStatus();
}
async function checkBlockedStatus(){
  if(!state.blocked)return;
  try{const me=await api('auth/me'); if(me.user?.status==='deleted')return showDeletedScreen({user:me.user}); if(me.user && me.user.status!=='blocked' && Number(me.user.active)===1){state.user=me.user;state.blocked=false;hideBlockedScreen();toast('Akun sudah diaktifkan oleh Admin.','ok');await loadDashboard();}}
  catch(err){if(err.status===410){showDeletedScreen(err.data)}}
}
function hideBlockedScreen(){document.onkeydown=null;state.blocked=false;if(state.blockedPoll){clearInterval(state.blockedPoll);state.blockedPoll=null;}$('#blockedOverlay')?.remove();app.removeAttribute('inert');document.body.classList.remove('account-blocked');startAccountMonitor()}
function showDeletedScreen(data={}){clearInterval(state.accountPoll);state.accountPoll=null;state.blocked=true;stopExam();app.setAttribute('inert','');document.body.classList.add('account-blocked');let overlay=$('#blockedOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='blockedOverlay';document.body.appendChild(overlay);}overlay.innerHTML=`<div class="blocked-panel"><div class="blocked-icon">×</div><h1>Akun Dihapus</h1><p class="blocked-main">${esc(data.message||'Akun ini sudah dihapus oleh Admin dan tidak dapat digunakan lagi.')}</p><p>Status akun: <b>DIHAPUS PERMANEN</b></p><p>Hubungi Admin sekolah untuk informasi lebih lanjut.</p></div>`;if(state.blockedPoll){clearInterval(state.blockedPoll);state.blockedPoll=null;}}

window.addEventListener('load',boot);
