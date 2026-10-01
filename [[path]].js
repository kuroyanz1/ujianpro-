const ITERATIONS = 100000;
const SESSION_HOURS = 12;
const enc = new TextEncoder();

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
});
const nowIso = () => new Date().toISOString();
const b64u = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const randomToken = () => {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return b64u(bytes);
};
async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64u(new Uint8Array(hash));
}
async function derive(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:fromB64u(saltB64), iterations:ITERATIONS, hash:'SHA-256'}, key, 256);
  return b64u(new Uint8Array(bits));
}
function cookieMap(request) {
  const out = {};
  const c = request.headers.get('Cookie') || '';
  for (const part of c.split(';')) { const [k,...v] = part.trim().split('='); if (k) out[k] = v.join('='); }
  return out;
}
function setSessionCookie(token) {
  return `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS*3600}`;
}
function clearSessionCookie() { return 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }
async function bodyJson(request) { try { return await request.json(); } catch { return {}; } }
function roleGuard(user, roles) { return user && roles.includes(user.role); }
function idFromPath(parts, index) { const id = Number(parts[index]); return Number.isInteger(id) && id > 0 ? id : null; }

async function getUser(request, env) {
  const token = cookieMap(request).sid;
  if (!token || !env.DB) return null;
  const th = await sha256(token);
  const row = await env.DB.prepare(`SELECT u.id,u.username,u.name,u.role,u.active,COALESCE(u.status,CASE WHEN u.active=1 THEN 'active' ELSE 'blocked' END) status,COALESCE(u.block_reason,'') block_reason,u.blocked_at,u.blocked_by,s.id session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(th, nowIso()).first();
  return row || null;
}
async function requireUser(request, env, roles = null) {
  const user = await getUser(request, env);
  if (!user) throw new Error('AUTH');
  if (user.status === 'deleted') throw new Error('ACCOUNT_DELETED');
  if (user.status === 'blocked' || Number(user.active) === 0) throw new Error('ACCOUNT_BLOCKED');
  if (roles && !roles.includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}
function publicUser(user) {
  if (!user) return null;
  return {id:user.id,username:user.username,name:user.name,role:user.role,active:Number(user.active),status:user.status||((Number(user.active)===1)?'active':'blocked'),block_reason:user.block_reason||'',blocked_at:user.blocked_at||null};
}
async function examRow(env, examId, user) {
  const exam = await env.DB.prepare(`SELECT id,title,description,duration_minutes,is_active,lock_on_violation,require_camera,require_screen,capture_evidence,created_by,created_at,updated_at FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return null;
  if (user.role === 'murid' && !exam.is_active) return null;
  const qsql = user.role === 'murid'
    ? `SELECT id,prompt,option_a,option_b,option_c,option_d,points,order_no FROM questions WHERE exam_id=? ORDER BY order_no,id`
    : `SELECT id,prompt,option_a,option_b,option_c,option_d,correct_option,points,order_no FROM questions WHERE exam_id=? ORDER BY order_no,id`;
  const qs = await env.DB.prepare(qsql).bind(examId).all();
  return {...exam, questions: qs.results || []};
}
async function getAttempt(env, attemptId, user) {
  let q = `SELECT a.*, e.title,e.duration_minutes,e.lock_on_violation,e.require_camera,e.require_screen,e.capture_evidence,u.username,u.name FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE a.id=?`;
  const params = [attemptId];
  if (user.role === 'murid') { q += ' AND a.user_id=?'; params.push(user.id); }
  const a = await env.DB.prepare(q).bind(...params).first();
  if (!a) return null;
  const ans = await env.DB.prepare(`SELECT question_id,selected_option FROM answers WHERE attempt_id=?`).bind(attemptId).all();
  const violations = await env.DB.prepare(`SELECT id,type,reason,metadata_json,created_at FROM violations WHERE attempt_id=? ORDER BY id DESC`).bind(attemptId).all();
  return {...a, answers: ans.results||[], violations: violations.results||[]};
}

async function login(request, env) {
  const {username='',password=''} = await bodyJson(request);
  if (!username || !password) return json({error:'Username dan password wajib diisi.'},400);
  const user = await env.DB.prepare(`SELECT * FROM users WHERE username=? LIMIT 1`).bind(username.trim()).first();
  if (!user) return json({error:'Username atau password salah.'},401);
  const hash = await derive(password, user.salt);
  if (hash !== user.password_hash) return json({error:'Password salah.'},401);
  const status = user.status || (user.active ? 'active' : 'blocked');
  if (status === 'deleted') return json({code:'ACCOUNT_DELETED',error:'Akun sudah dihapus oleh Admin.',user:publicUser({...user,status})},410);
  if (status === 'blocked' || !user.active) return json({code:'ACCOUNT_BLOCKED',error:'Akun sedang diblokir oleh Admin.',reason:user.block_reason||'Tidak ada alasan yang dicantumkan.',user:publicUser({...user,status})},423);
  const token = randomToken();
  const th = await sha256(token);
  const expires = new Date(Date.now()+SESSION_HOURS*3600*1000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)`).bind(user.id,th,expires).run();
  return json({ok:true,user:publicUser({...user,status:'active',active:1})},200,{'set-cookie':setSessionCookie(token)});
}

async function handle(request, env) {
  if (!env.DB) return json({error:'Binding D1 DB belum terpasang.'},500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
  const parts = path ? path.split('/') : [];
  const method = request.method;

  if (path === 'auth/login' && method === 'POST') return login(request, env);
  if (path === 'auth/logout' && method === 'POST') {
    const token = cookieMap(request).sid; if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ok:true},200,{'set-cookie':clearSessionCookie()});
  }
  if (path === 'auth/me' && method === 'GET') {
    const user = await getUser(request,env);
    return json({user:publicUser(user)});
  }

  let user;
  try { user = await requireUser(request,env); } catch (e) {
    if (e.message==='ACCOUNT_BLOCKED') { const blocked=await getUser(request,env); return json({code:'ACCOUNT_BLOCKED',error:'Akun sedang diblokir oleh Admin.',reason:blocked?.block_reason||'Tidak ada alasan yang dicantumkan.',user:publicUser(blocked)},423); }
    if (e.message==='ACCOUNT_DELETED') { const deleted=await getUser(request,env); return json({code:'ACCOUNT_DELETED',error:'Akun sudah dihapus oleh Admin.',user:publicUser(deleted)},410); }
    return json({error:e.message==='FORBIDDEN'?'Akses ditolak.':'Belum login.'},e.message==='FORBIDDEN'?403:401);
  }

  if (path === 'exams' && method === 'GET') {
    let rows;
    if (user.role === 'murid') rows = await env.DB.prepare(`SELECT id,title,description,duration_minutes,is_active,lock_on_violation,require_camera,require_screen,capture_evidence FROM exams WHERE is_active=1 ORDER BY id DESC`).all();
    else rows = await env.DB.prepare(`SELECT e.*,u.name creator_name FROM exams e JOIN users u ON u.id=e.created_by ORDER BY e.id DESC`).all();
    return json({exams:rows.results||[]});
  }
  if (parts[0] === 'exams' && parts.length === 2 && method === 'GET') {
    const ex = await examRow(env,idFromPath(parts,1),user); return ex ? json({exam:ex}) : json({error:'Ujian tidak ditemukan.'},404);
  }
  if (path === 'exams' && method === 'POST') {
    if (!roleGuard(user,['guru','admin'])) return json({error:'Akses guru/admin saja.'},403);
    const b=await bodyJson(request);
    const result=await env.DB.prepare(`INSERT INTO exams(title,description,duration_minutes,is_active,lock_on_violation,require_camera,require_screen,capture_evidence,created_by) VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      String(b.title||'Ujian Baru').slice(0,180), String(b.description||''), Math.max(1,Math.min(600,Number(b.duration_minutes)||30)), b.is_active?1:0, b.lock_on_violation!==false?1:0, b.require_camera?1:0, b.require_screen?1:0, b.capture_evidence!==false?1:0, user.id).run();
    return json({ok:true,id:result.meta.last_row_id});
  }
  if (parts[0]==='exams' && parts.length===2 && method==='PUT') {
    if (!roleGuard(user,['guru','admin'])) return json({error:'Akses guru/admin saja.'},403);
    const id=idFromPath(parts,1); const b=await bodyJson(request);
    const owned = user.role==='admin' ? await env.DB.prepare('SELECT id FROM exams WHERE id=?').bind(id).first() : await env.DB.prepare('SELECT id FROM exams WHERE id=? AND created_by=?').bind(id,user.id).first();
    if(!owned) return json({error:'Ujian tidak ditemukan.'},404);
    await env.DB.prepare(`UPDATE exams SET title=?,description=?,duration_minutes=?,is_active=?,lock_on_violation=?,require_camera=?,require_screen=?,capture_evidence=?,updated_at=? WHERE id=?`).bind(String(b.title||''),String(b.description||''),Math.max(1,Math.min(600,Number(b.duration_minutes)||30)),b.is_active?1:0,b.lock_on_violation!==false?1:0,b.require_camera?1:0,b.require_screen?1:0,b.capture_evidence!==false?1:0,nowIso(),id).run();
    return json({ok:true});
  }
  if (parts[0]==='exams' && parts[2]==='questions' && parts.length===3 && method==='POST') {
    if (!roleGuard(user,['guru','admin'])) return json({error:'Akses guru/admin saja.'},403);
    const examId=idFromPath(parts,1); const b=await bodyJson(request);
    const owned = user.role==='admin'?await env.DB.prepare('SELECT id FROM exams WHERE id=?').bind(examId).first():await env.DB.prepare('SELECT id FROM exams WHERE id=? AND created_by=?').bind(examId,user.id).first();
    if(!owned) return json({error:'Ujian tidak ditemukan.'},404);
    const order=Number(b.order_no)||((await env.DB.prepare('SELECT COALESCE(MAX(order_no),0)+1 n FROM questions WHERE exam_id=?').bind(examId).first()).n);
    const r=await env.DB.prepare(`INSERT INTO questions(exam_id,prompt,option_a,option_b,option_c,option_d,correct_option,points,order_no) VALUES(?,?,?,?,?,?,?,?,?)`).bind(examId,String(b.prompt||''),String(b.option_a||''),String(b.option_b||''),String(b.option_c||''),String(b.option_d||''),['A','B','C','D'].includes(b.correct_option)?b.correct_option:'A',Math.max(1,Number(b.points)||1),order).run();
    return json({ok:true,id:r.meta.last_row_id});
  }
  if (parts[0]==='questions' && parts.length===2 && (method==='PUT'||method==='DELETE')) {
    if (!roleGuard(user,['guru','admin'])) return json({error:'Akses guru/admin saja.'},403);
    const qid=idFromPath(parts,1); const q=await env.DB.prepare(`SELECT q.id,e.created_by FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.id=?`).bind(qid).first();
    if(!q || (user.role!=='admin' && q.created_by!==user.id)) return json({error:'Soal tidak ditemukan.'},404);
    if(method==='DELETE'){await env.DB.prepare('DELETE FROM questions WHERE id=?').bind(qid).run();return json({ok:true});}
    const b=await bodyJson(request); await env.DB.prepare(`UPDATE questions SET prompt=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_option=?,points=?,order_no=? WHERE id=?`).bind(String(b.prompt||''),String(b.option_a||''),String(b.option_b||''),String(b.option_c||''),String(b.option_d||''),['A','B','C','D'].includes(b.correct_option)?b.correct_option:'A',Math.max(1,Number(b.points)||1),Number(b.order_no)||0,qid).run(); return json({ok:true});
  }
  if (parts[0]==='exams' && parts[2]==='start' && parts.length===3 && method==='POST') {
    if(user.role!=='murid') return json({error:'Murid saja.'},403);
    const examId=idFromPath(parts,1); const ex=await env.DB.prepare('SELECT * FROM exams WHERE id=? AND is_active=1').bind(examId).first(); if(!ex) return json({error:'Ujian tidak tersedia.'},404);
    const existing=await env.DB.prepare('SELECT id,status FROM attempts WHERE exam_id=? AND user_id=?').bind(examId,user.id).first();
    if(existing) return json({error:'Kamu sudah memiliki sesi untuk ujian ini.',attempt_id:existing.id,status:existing.status},409);
    const b=await bodyJson(request);
    const r=await env.DB.prepare(`INSERT INTO attempts(exam_id,user_id,status,last_heartbeat,user_agent,client_id) VALUES(?,?,?,?,?,?)`).bind(examId,user.id,'in_progress',nowIso(),request.headers.get('User-Agent')||'',String(b.client_id||'')).run();
    return json({ok:true,attempt_id:r.meta.last_row_id});
  }
  if (parts[0]==='attempts' && parts.length===2 && method==='GET') {
    const a=await getAttempt(env,idFromPath(parts,1),user); return a?json({attempt:a}):json({error:'Attempt tidak ditemukan.'},404);
  }
  if(parts[0]==='attempts' && parts[2]==='heartbeat' && parts.length===3 && method==='POST'){
    const id=idFromPath(parts,1); const a=await getAttempt(env,id,user); if(!a)return json({error:'Attempt tidak ditemukan.'},404);
    if(a.status==='in_progress'){
      const previous = a.last_heartbeat ? Date.parse(a.last_heartbeat) : Date.now();
      const gap = Math.max(0, Date.now()-previous);
      if(gap > 45000){
        await env.DB.prepare('INSERT INTO violations(attempt_id,user_id,type,reason,metadata_json) VALUES(?,?,?,?,?)').bind(id,a.user_id,'HEARTBEAT_GAP','Perangkat tidak mengirim heartbeat lebih dari 45 detik; koneksi/perangkat kemungkinan terputus.',JSON.stringify({gap_ms:gap})).run();
        await env.DB.prepare('UPDATE attempts SET violation_count=violation_count+1,status=?,submitted_at=? WHERE id=?').bind(Number(a.lock_on_violation)===1?'locked':'in_progress',Number(a.lock_on_violation)===1?nowIso():null,id).run();
        return json({ok:true,status:Number(a.lock_on_violation)===1?'locked':'in_progress',gap_ms:gap});
      }
      await env.DB.prepare('UPDATE attempts SET last_heartbeat=? WHERE id=?').bind(nowIso(),id).run();
    }
    return json({ok:true,status:a.status});
  }
  if(parts[0]==='attempts' && parts[2]==='answer' && parts.length===3 && method==='POST'){
    if(user.role!=='murid')return json({error:'Murid saja.'},403); const id=idFromPath(parts,1); const a=await getAttempt(env,id,user); if(!a)return json({error:'Attempt tidak ditemukan.'},404); if(a.status!=='in_progress')return json({error:'Sesi ujian sudah dikunci atau selesai.'},409);
    const b=await bodyJson(request); const q=await env.DB.prepare('SELECT id FROM questions WHERE id=? AND exam_id=?').bind(Number(b.question_id),a.exam_id).first(); if(!q)return json({error:'Soal tidak valid.'},400);
    const opt=['A','B','C','D'].includes(b.selected_option)?b.selected_option:null;
    await env.DB.prepare(`INSERT INTO answers(attempt_id,question_id,selected_option,updated_at) VALUES(?,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET selected_option=excluded.selected_option,updated_at=excluded.updated_at`).bind(id,q.id,opt,nowIso()).run(); return json({ok:true});
  }
  if(parts[0]==='attempts' && parts[2]==='violation' && parts.length===3 && method==='POST'){
    if(user.role!=='murid')return json({error:'Murid saja.'},403);
    const id=idFromPath(parts,1); const a=await getAttempt(env,id,user); if(!a)return json({error:'Attempt tidak ditemukan.'},404); if(a.status!=='in_progress')return json({ok:true,status:a.status});
    const b=await bodyJson(request); const type=String(b.type||'UNKNOWN').slice(0,60); const reason=String(b.reason||'Pelanggaran ujian terdeteksi.').slice(0,300); const meta=JSON.stringify(b.metadata||{});
    await env.DB.prepare('INSERT INTO violations(attempt_id,user_id,type,reason,metadata_json) VALUES(?,?,?,?,?)').bind(id,a.user_id,type,reason,meta).run();
    await env.DB.prepare('UPDATE attempts SET violation_count=violation_count+1 WHERE id=?').bind(id).run();
    const shouldLock = Number(a.lock_on_violation)===1;
    if(shouldLock) await env.DB.prepare(`UPDATE attempts SET status='locked',submitted_at=? WHERE id=? AND status='in_progress'`).bind(nowIso(),id).run();
    return json({ok:true,locked:shouldLock});
  }
  if(parts[0]==='attempts' && parts[2]==='submit' && parts.length===3 && method==='POST'){
    if(user.role!=='murid')return json({error:'Murid saja.'},403); const id=idFromPath(parts,1); const a=await getAttempt(env,id,user); if(!a)return json({error:'Attempt tidak ditemukan.'},404); if(!['in_progress','expired'].includes(a.status))return json({error:'Sesi tidak dapat dikumpulkan.'},409);
    const qs=await env.DB.prepare('SELECT id,correct_option,points FROM questions WHERE exam_id=?').bind(a.exam_id).all(); const amap=new Map((a.answers||[]).map(x=>[x.question_id,x.selected_option])); let score=0,max=0; for(const q of qs.results||[]){max+=Number(q.points)||1;if(amap.get(q.id)===q.correct_option)score+=Number(q.points)||1;}
    const deadline = Date.parse(a.started_at) + Number(a.duration_minutes||30)*60000;
    const isLate = Date.now() > deadline;
    const finalStatus = isLate ? 'expired' : 'submitted';
    const finalScore = max ? Math.round(score/max*10000)/100 : 0;
    await env.DB.prepare(`UPDATE attempts SET status=?,submitted_at=?,score=? WHERE id=?`).bind(finalStatus,nowIso(),finalScore,id).run();
    return json({ok:true,score:finalScore,max_score:max,status:finalStatus});
  }
  async function scoreAttemptById(attemptId){
    const a=await env.DB.prepare('SELECT exam_id,started_at,duration_minutes FROM attempts WHERE id=?').bind(attemptId).first();
    if(!a)return null; const qs=await env.DB.prepare('SELECT id,correct_option,points FROM questions WHERE exam_id=?').bind(a.exam_id).all(); const ans=await env.DB.prepare('SELECT question_id,selected_option FROM answers WHERE attempt_id=?').bind(attemptId).all(); const amap=new Map((ans.results||[]).map(x=>[x.question_id,x.selected_option])); let score=0,max=0; for(const q of qs.results||[]){max+=Number(q.points)||1;if(amap.get(q.id)===q.correct_option)score+=Number(q.points)||1;} return {score:max?Math.round(score/max*10000)/100:0,max_score:max};
  }
  if(parts[0]==='attempts' && parts[2]==='terminate' && parts.length===3 && method==='POST'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403); const id=idFromPath(parts,1); const a=await env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(id).first(); if(!a)return json({error:'Percobaan tidak ditemukan.'},404); if(a.status!=='in_progress')return json({error:'Ujian tidak sedang berjalan.'},409); const scored=await scoreAttemptById(id); await env.DB.prepare(`UPDATE attempts SET status='submitted',submitted_at=?,score=?,ended_by=?,end_reason=? WHERE id=? AND status='in_progress'`).bind(nowIso(),scored.score,user.id,String((await bodyJson(request)).reason||'Diakhiri oleh Admin').slice(0,200),id).run(); return json({ok:true,score:scored.score,max_score:scored.max_score,status:'submitted'});
  }
  if(parts[0]==='attempts' && parts.length===2 && method==='DELETE'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403); const id=idFromPath(parts,1); const a=await env.DB.prepare('SELECT id FROM attempts WHERE id=?').bind(id).first(); if(!a)return json({error:'Percobaan tidak ditemukan.'},404); const evs=await env.DB.prepare('SELECT object_key FROM evidence WHERE attempt_id=?').bind(id).all(); if(env.MEDIA){for(const e of evs.results||[]){try{await env.MEDIA.delete(e.object_key)}catch{}}} await env.DB.prepare('DELETE FROM attempts WHERE id=?').bind(id).run(); return json({ok:true});
  }
  if(path==='results' && method==='GET'){
    let rows;
    if(user.role==='murid') rows=await env.DB.prepare(`SELECT a.id,e.title,a.started_at,a.submitted_at,a.status,a.score,a.violation_count,a.end_reason FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.user_id=? ORDER BY a.id DESC`).bind(user.id).all();
    else if(user.role==='guru') rows=await env.DB.prepare(`SELECT a.id,e.title,u.username,u.name,a.started_at,a.submitted_at,a.status,a.score,a.violation_count,a.end_reason FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE e.created_by=? ORDER BY a.id DESC`).bind(user.id).all();
    else rows=await env.DB.prepare(`SELECT a.id,e.title,u.username,u.name,a.started_at,a.submitted_at,a.status,a.score,a.violation_count,a.end_reason FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id ORDER BY a.id DESC`).all();
    return json({results:rows.results||[]});
  }
  if(path==='violations' && method==='GET'){
    if(!roleGuard(user,['guru','admin']))return json({error:'Guru/admin saja.'},403);
    let rows;
    if(user.role==='guru') rows=await env.DB.prepare(`SELECT v.*,u.username,u.name,e.title exam_title FROM violations v JOIN users u ON u.id=v.user_id JOIN attempts a ON a.id=v.attempt_id JOIN exams e ON e.id=a.exam_id WHERE e.created_by=? ORDER BY v.id DESC LIMIT 500`).bind(user.id).all();
    else rows=await env.DB.prepare(`SELECT v.*,u.username,u.name,e.title exam_title FROM violations v JOIN users u ON u.id=v.user_id JOIN attempts a ON a.id=v.attempt_id JOIN exams e ON e.id=a.exam_id ORDER BY v.id DESC LIMIT 500`).all();
    return json({violations:rows.results||[]});
  }
  if(path==='users' && method==='GET'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403); const rows=await env.DB.prepare(`SELECT id,username,name,role,active,COALESCE(status,CASE WHEN active=1 THEN 'active' ELSE 'blocked' END) status,COALESCE(block_reason,'') block_reason,blocked_at,created_at FROM users ORDER BY role,username`).all(); return json({users:rows.results||[]});
  }
  if(path==='users' && method==='POST'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403); const b=await bodyJson(request); if(!b.username||!b.password||!['murid','guru','admin'].includes(b.role))return json({error:'Data akun tidak lengkap.'},400); const saltBytes=new Uint8Array(16);crypto.getRandomValues(saltBytes);const salt=b64u(saltBytes);const hash=await derive(String(b.password),salt); try{const r=await env.DB.prepare(`INSERT INTO users(username,name,role,password_hash,salt,active,status,block_reason) VALUES(?,?,?,?,?,1,'active','')`).bind(String(b.username).trim(),String(b.name||b.username).slice(0,120),b.role,hash,salt).run();return json({ok:true,id:r.meta.last_row_id});}catch{return json({error:'Username sudah digunakan.'},409);}
  }
  if(parts[0]==='users' && parts.length===2 && method==='PATCH'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403);
    const id=idFromPath(parts,1); const b=await bodyJson(request);
    const target=await env.DB.prepare(`SELECT id,username,name,role,active,COALESCE(status,CASE WHEN active=1 THEN 'active' ELSE 'blocked' END) status,COALESCE(block_reason,'') block_reason FROM users WHERE id=?`).bind(id).first();
    if(!target)return json({error:'Akun tidak ditemukan.'},404);
    const action=String(b.action||'');
    if(action==='block') {
      if(target.id===user.id)return json({error:'Admin tidak dapat memblokir akun yang sedang dipakai.'},400);
      const reason=String(b.reason||'Akun diblokir Admin.').slice(0,300);
      await env.DB.prepare(`UPDATE users SET active=0,status='blocked',block_reason=?,blocked_at=?,blocked_by=? WHERE id=?`).bind(reason,nowIso(),user.id,id).run();
      const activeAttempts=await env.DB.prepare(`SELECT id FROM attempts WHERE user_id=? AND status='in_progress'`).bind(id).all();
      for(const a of activeAttempts.results||[]){
        await env.DB.prepare(`INSERT INTO violations(attempt_id,user_id,type,reason,metadata_json) VALUES(?,?,?,?,?)`).bind(a.id,id,'ADMIN_BLOCK','Akun diblokir oleh Admin: '+reason,JSON.stringify({blocked_by:user.id})).run();
        await env.DB.prepare(`UPDATE attempts SET status='locked',submitted_at=?,ended_by=?,end_reason=?,violation_count=violation_count+1 WHERE id=? AND status='in_progress'`).bind(nowIso(),user.id,'Diblokir oleh Admin: '+reason,a.id).run();
      }
      return json({ok:true,status:'blocked'});
    }
    if(action==='activate') {
      if(target.status==='deleted')return json({error:'Akun yang sudah dihapus tidak dapat diaktifkan.'},409);
      await env.DB.prepare(`UPDATE users SET active=1,status='active',block_reason='',blocked_at=NULL,blocked_by=NULL WHERE id=?`).bind(id).run();
      return json({ok:true,status:'active'});
    }
    if(action==='password') {
      if(!b.password)return json({error:'Password baru wajib diisi.'},400); const sb=new Uint8Array(16);crypto.getRandomValues(sb);const salt=b64u(sb);const hash=await derive(String(b.password),salt); await env.DB.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?').bind(hash,salt,id).run(); return json({ok:true});
    }
    if(typeof b.active!=='undefined') {
      await env.DB.prepare('UPDATE users SET active=?,status=? WHERE id=?').bind(b.active?1:0,b.active?'active':'blocked',id).run(); return json({ok:true});
    }
    return json({error:'Tindakan akun tidak dikenali.'},400);
  }
  if(parts[0]==='users' && parts.length===2 && method==='DELETE'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403);
    const id=idFromPath(parts,1); if(id===user.id)return json({error:'Akun yang sedang dipakai tidak bisa dihapus.'},400);
    const target=await env.DB.prepare('SELECT id,status FROM users WHERE id=?').bind(id).first(); if(!target)return json({error:'Akun tidak ditemukan.'},404);
    await env.DB.prepare(`UPDATE users SET active=0,status='deleted',block_reason='Akun dihapus oleh Admin',blocked_at=?,blocked_by=? WHERE id=?`).bind(nowIso(),user.id,id).run();
    return json({ok:true,status:'deleted'});
  }
  if(parts[0]==='users' && parts.length===3 && parts[2]==='history' && method==='GET'){
    if(user.role!=='admin')return json({error:'Admin saja.'},403);
    const id=idFromPath(parts,1); const student=await env.DB.prepare(`SELECT id,username,name,role,active,COALESCE(status,CASE WHEN active=1 THEN 'active' ELSE 'blocked' END) status,COALESCE(block_reason,'') block_reason,blocked_at,created_at FROM users WHERE id=? AND role='murid'`).bind(id).first();
    if(!student)return json({error:'Murid tidak ditemukan.'},404);
    const attempts=await env.DB.prepare(`SELECT a.id,a.exam_id,e.title,a.started_at,a.submitted_at,a.status,a.score,a.violation_count,a.end_reason FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.user_id=? ORDER BY a.id DESC`).bind(id).all();
    const violations=await env.DB.prepare(`SELECT v.id,v.attempt_id,v.type,v.reason,v.metadata_json,v.created_at,e.title exam_title FROM violations v JOIN attempts a ON a.id=v.attempt_id JOIN exams e ON e.id=a.exam_id WHERE v.user_id=? ORDER BY v.id DESC LIMIT 1000`).bind(id).all();
    const evidence=await env.DB.prepare(`SELECT ev.id,ev.attempt_id,ev.type,ev.bytes,ev.mime_type,ev.created_at,e.title exam_title FROM evidence ev JOIN attempts a ON a.id=ev.attempt_id JOIN exams e ON e.id=a.exam_id WHERE ev.user_id=? ORDER BY ev.id DESC LIMIT 500`).bind(id).all();
    return json({history:{student,attempts:attempts.results||[],violations:violations.results||[],evidence:evidence.results||[]}});
  }
  if(path==='evidence' && method==='POST'){
    if(user.role!=='murid')return json({error:'Murid saja.'},403);
    if(!env.MEDIA)return json({error:'R2 MEDIA belum terpasang.'},503);
    const fd=await request.formData(); const file=fd.get('file'); const attemptId=Number(fd.get('attempt_id')); const type=String(fd.get('type')||''); if(!(file instanceof File)||!attemptId||!['camera','screen'].includes(type))return json({error:'Bukti tidak valid.'},400);
    const a=await getAttempt(env,attemptId,user);if(!a)return json({error:'Attempt tidak ditemukan.'},404); if(file.size>25*1024*1024)return json({error:'Bukti terlalu besar (maks 25 MB).'},413);
    const key=`evidence/${a.exam_id}/${a.user_id}/${attemptId}/${crypto.randomUUID()}-${type}.webm`; await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type||'video/webm'}}); await env.DB.prepare(`INSERT INTO evidence(attempt_id,user_id,type,object_key,mime_type,bytes) VALUES(?,?,?,?,?,?)`).bind(attemptId,a.user_id,type,key,file.type||'video/webm',file.size).run(); return json({ok:true,key});
  }
  if(path==='evidence' && method==='GET'){
    if(!roleGuard(user,['guru','admin']))return json({error:'Guru/admin saja.'},403);
    const attemptId=Number(new URL(request.url).searchParams.get('attempt_id')||0);
    let q='SELECT ev.id,ev.attempt_id,ev.type,ev.mime_type,ev.bytes,ev.created_at,u.name,u.username,e.title exam_title FROM evidence ev JOIN attempts a ON a.id=ev.attempt_id JOIN users u ON u.id=ev.user_id JOIN exams e ON e.id=a.exam_id';
    const params=[];
    if(attemptId){q+=' WHERE ev.attempt_id=?';params.push(attemptId);}
    if(user.role==='guru'){q+=(attemptId?' AND':' WHERE')+' e.created_by=?';params.push(user.id);}
    q+=' ORDER BY ev.id DESC LIMIT 500';
    const rows=await env.DB.prepare(q).bind(...params).all();
    return json({evidence:rows.results||[]});
  }
  if(parts[0]==='evidence' && parts.length===2 && method==='GET'){
    if(!roleGuard(user,['guru','admin']))return json({error:'Guru/admin saja.'},403); if(!env.MEDIA)return json({error:'R2 belum terpasang.'},503); const eid=idFromPath(parts,1); const e=await env.DB.prepare(`SELECT * FROM evidence WHERE id=?`).bind(eid).first();if(!e)return json({error:'Evidence tidak ditemukan.'},404); const a=await env.DB.prepare('SELECT exam_id,user_id FROM attempts WHERE id=?').bind(e.attempt_id).first(); if(user.role==='guru'){const own=await env.DB.prepare('SELECT id FROM exams WHERE id=? AND created_by=?').bind(a.exam_id,user.id).first();if(!own)return json({error:'Akses ditolak.'},403);} const obj=await env.MEDIA.get(e.object_key);if(!obj)return json({error:'Object tidak ditemukan.'},404); return new Response(obj.body,{headers:{'content-type':e.mime_type,'cache-control':'private, no-store'}});
  }
  return json({error:'Endpoint tidak ditemukan.'},404);
}

export async function onRequest(context) {
  try { return await handle(context.request, context.env); }
  catch (e) { console.error(e); return json({error:'Kesalahan server.',detail:e?.message||String(e)},500); }
}
