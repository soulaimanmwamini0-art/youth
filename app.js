/* RP Gishari Youth Volunteers - 4-file deployment
   Frontend only uses the Supabase public/anon (publishable) key.
   Never put a service_role key in this file.
*/
const SUPABASE_URL = 'https://dbxzornmwqtpbuzxghsx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRieHpvcm5td3F0cGJ1enhnaHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzg2MTQsImV4cCI6MjEwNjcxNDYxNH0.tSaf11mNl_woKKqsvPlPdepI7ly28pZYMr0UJ2uSIpY';
const hasConfig = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('PASTE_');
let supabase = null;
let supabaseLoadPromise = null;

function setLoading(button, loading, textContent) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.origText = button.textContent;
    if (textContent) button.textContent = textContent;
  } else {
    button.disabled = false;
    if (button.dataset.origText) button.textContent = button.dataset.origText;
  }
}

function initSupabaseClient(){
  if(supabase) return Promise.resolve(supabase);
  if(!hasConfig) return Promise.resolve(null);
  if(window.supabase?.createClient){
    supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    return Promise.resolve(supabase);
  }
  if(supabaseLoadPromise) return supabaseLoadPromise;
  supabaseLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.async=true;
    script.onload=()=>{
      try{
        if(!window.supabase?.createClient) throw new Error('Supabase SDK loaded but createClient is unavailable.');
        supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
        resolve(supabase);
      }catch(err){reject(err)}
    };
    script.onerror=()=>reject(new Error('Unable to load the Supabase browser library.'));
    document.head.appendChild(script);
  });
  return supabaseLoadPromise;
}

const isAdminPage = document.body?.dataset.page === 'admin';

const SETUP_SQL = String.raw`
-- RP GISHARI COLLEGE - YOUTH VOLUNTEERS
-- Run this entire script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text not null,
  sex text not null,
  student_id text,
  year_level text not null,
  department text not null,
  option_name text not null,
  academic_year text,
  district text,
  availability text default 'Weekly',
  preferred_area text,
  skills text,
  emergency_contact text,
  emergency_phone text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  motivation text not null,
  agreement_conduct boolean not null default false,
  agreement_data boolean not null default false,
  media_consent boolean not null default false,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  role text not null default 'volunteer' check (role in ('volunteer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.volunteers enable row level security;

create unique index if not exists volunteers_email_lower_uidx on public.volunteers (lower(email));
create index if not exists volunteers_status_idx on public.volunteers(status);
create index if not exists volunteers_year_idx on public.volunteers(year_level);
create index if not exists volunteers_role_idx on public.volunteers(role);
create index if not exists volunteers_auth_user_idx on public.volunteers(auth_user_id);

create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.volunteers
    where auth_user_id = uid and role='admin' and status='active'
  );
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated;
`;

function q(id){return document.getElementById(id)}
function text(id,v){const e=q(id);if(e)e.textContent=v??''}
function message(el,txt,type=''){if(!el)return;el.textContent=txt;el.className='form-message '+type}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function csvCell(v){return '"'+String(v??'').replaceAll('"','""')+'"'}
function downloadCsv(filename,rows){if(!rows.length){alert('No records match this selection.');return}const headers=Object.keys(rows[0]);const csv=[headers.map(csvCell).join(','),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function slugify(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_-]+/g,'-')}
function dateText(v){return v?new Date(v).toLocaleDateString():''}
async function currentUser(){if(!supabase)return null;const {data}=await supabase.auth.getUser();return data.user}
async function currentVolunteer(user){if(!supabase||!user)return null;const {data}=await supabase.from('volunteers').select('*').eq('auth_user_id',user.id).maybeSingle();return data}
async function ensureAdmin(user){const p=await currentVolunteer(user);return p&&p.role==='admin'&&p.status==='active'?p:null}

function drawDonut(id,items,legendId){const el=q(id),leg=q(legendId);if(!el||!leg)return;const total=items.reduce((a,x)=>a+x[1],0);let cur=0;const stops=items.map(x=>{const start=cur;cur+=total?x[1]/total*100:0;return `${x[2]} ${start}% ${cur}%`}).join(',');el.style.background=`conic-gradient(${stops||'#dfe5ec 0 100%'})`;leg.innerHTML=items.map(x=>`<div class="legend-row"><b><span class="legend-dot" style="background:${x[2]}"></span>${esc(x[0])}</b><span>${x[1]} (${total?Math.round(x[1]/total*100):0}%)</span></div>`).join('')}

async function publicStats(){if(!supabase){text('statVolunteers','—');text('statActive','—');return}const {data,error}=await supabase.rpc('get_public_stats');if(error||!data)return;const s=data;text('statVolunteers',s.registered??0);text('heroVolunteerCount',s.registered??0);text('statActive',s.active??0);text('heroActiveCount',s.active??0);text('sexTotal',(s.female||0)+(s.male||0)+(s.other_sex||0));text('statusTotal',(s.active||0)+(s.pending||0)+(s.suspended||0));if(q('statActivities')){const {count}=await supabase.from('posts').select('id',{count:'exact',head:true});text('statActivities',count??0)}if(q('statIdeas'))text('statIdeas',s.ideas_received??0);drawDonut('sexDonut',[['Female',s.female||0,'#b3122f'],['Male',s.male||0,'#2d6aa8'],['Other / undisclosed',s.other_sex||0,'#8f9db0']],'sexLegend');drawDonut('statusDonut',[['Active',s.active||0,'#2d6aa8'],['Pending',s.pending||0,'#b3122f'],['Suspended',s.suspended||0,'#8f9db0']],'statusLegend')}
async function loadPublicSettings(){if(!supabase)return;const {data}=await supabase.from('site_settings').select('*').eq('id',1).maybeSingle();if(!data)return;document.title=`${data.college_name||'Youth Volunteers'} • RP Gishari College`;const logo=q('siteLogoImage');if(logo&&data.logo_url){logo.src=data.logo_url;logo.classList.remove('hidden')}if(q('heroTitle'))q('heroTitle').textContent=data.hero_title||q('heroTitle').textContent;if(q('heroSubtitle'))q('heroSubtitle').textContent=data.hero_subtitle||q('heroSubtitle').textContent;if(q('heroText'))q('heroText').textContent=data.hero_text||q('heroText').textContent}
function mediaHtml(row){if(!row.media_url)return'';const type=row.media_type||'';if(type.startsWith('video/'))return `<video controls preload="metadata" style="width:100%;max-height:260px"><source src="${esc(row.media_url)}" type="${esc(type)}"></video>`;if(type.startsWith('audio/'))return `<audio controls style="width:100%"><source src="${esc(row.media_url)}" type="${esc(type)}"></audio>`;if(type.startsWith('image/'))return `<img src="${esc(row.media_url)}" alt="${esc(row.title)}" loading="lazy">`;return `<a class="story-link" href="${esc(row.media_url)}" target="_blank" rel="noopener">Open ${esc(row.media_name||'resource')}</a>`}
async function loadStories(){const grid=q('storiesGrid');if(!grid||!supabase)return;const {data,error}=await supabase.from('posts').select('*').eq('is_published',true).order('published_at',{ascending:false}).limit(12);if(error){grid.innerHTML='<div class="loading-box">Stories are temporarily unavailable.</div>';return}grid.innerHTML=(data||[]).map(r=>`<article class="story-card"><div class="story-media">${r.cover_url?`<img src="${esc(r.cover_url)}" alt="${esc(r.title)}" loading="lazy">`:''}<span class="story-badge">${esc(r.category)}</span></div><div class="story-body"><h3>${esc(r.title)}</h3><p>${esc(r.excerpt||r.content||'')}</p>${r.media_url?mediaHtml(r):''}<div class="story-link">Published ${dateText(r.published_at||r.created_at)}</div></div></article>`).join('')||'<div class="loading-box">No published stories yet.</div>'}

async function submitRegistration(e){
  e.preventDefault();
  const form=e.currentTarget;
  const button=form.querySelector('button[type="submit"]');
  const out=q('registrationMessage');
  const fd=new FormData(form);
  const email=String(fd.get('email')||'').trim().toLowerCase();
  const pass=String(fd.get('password')||'');
  const pass2=String(fd.get('password2')||'');

  try{
    if(!email){ throw new Error('Please enter your email address.'); }
    if(pass.length<8){ throw new Error('Password must be at least 8 characters.'); }
    if(pass!==pass2){ throw new Error('Passwords do not match.'); }
    if(!fd.get('agreement_conduct') || !fd.get('agreement_data')){
      throw new Error('Please accept the required volunteer agreements.');
    }

    setLoading(button,true,'Submitting application…');
    const client=await initSupabaseClient();
    if(!client){
      throw new Error('Supabase is not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY in app.js.');
    }

    const meta={};
    fd.forEach((value,key)=>{
      if(key!=='password' && key!=='password2'){
        meta[key]=typeof value==='string' ? value.trim() : value;
      }
    });
    meta.agreement_conduct=fd.get('agreement_conduct')==='on';
    meta.agreement_data=fd.get('agreement_data')==='on';
    meta.media_consent=fd.get('media_consent')==='on';

    const {data,error}=await client.auth.signUp({
      email,
      password:pass,
      options:{data:meta}
    });

    if(error) throw error;

    message(
      out,
      data?.user
        ? 'Application received. Your account is Pending until an administrator approves it.'
        : 'Application submitted successfully.',
      'success'
    );

    form.reset();
    setTimeout(()=>showPortalTab('login'),900);
  }catch(error){
    console.error('Volunteer registration error:',error);
    message(out,error?.message||'Unable to submit the volunteer application. Please try again.','error');
  }finally{
    setLoading(button,false);
  }
}

async function submitIdea(e){e.preventDefault();const f=e.currentTarget,fd=new FormData(f);await initSupabaseClient();if(!supabase){message(q('ideaMessage'),'Supabase is not configured.','error');return}const {error}=await supabase.from('ideas').insert({name:String(fd.get('name')||'').trim()||null,email:String(fd.get('email')||'').trim()||null,idea:String(fd.get('idea')||'').trim()});message(q('ideaMessage'),error?error.message:'Thank you — your idea has been received.',error?'error':'success');if(!error)f.reset()}

async function submitVolunteerLogin(e){e.preventDefault();await initSupabaseClient();if(!supabase){message(q('loginMessage'),'Supabase is not configured.','error');return}const fd=new FormData(e.currentTarget);const {data,error}=await supabase.auth.signInWithPassword({email:String(fd.get('email')).trim().toLowerCase(),password:String(fd.get('password'))});if(error){message(q('loginMessage'),error.message,'error');return}const p=await currentVolunteer(data.user);if(!p){message(q('loginMessage'),'Your volunteer record is not ready yet. Contact the program administrator.','error');await supabase.auth.signOut();return}if(p.status==='pending'){message(q('loginMessage'),'Your volunteer application is still Pending admin approval.','error');await supabase.auth.signOut();return}if(p.status==='suspended'){message(q('loginMessage'),'Your volunteer account is suspended. Please contact the program administrator.','error');await supabase.auth.signOut();return}if(p.role==='admin'){location.href='admin.html';return}await showVolunteerAccount(p)}
async function showVolunteerAccount(p){q('portalLoginPanel')?.classList.add('hidden');q('portalRegisterPanel')?.classList.add('hidden');q('portalAccountPanel')?.classList.remove('hidden');text('accountName',p.full_name);text('accountStatus',p.status);text('accountLevel',p.year_level);text('accountDepartment',p.department);text('accountEmail',p.email);text('accountPhone',p.phone);text('accountCreated',dateText(p.created_at));}
async function loadVolunteerAccount(){const u=await currentUser();if(!u){showPortalTab('login');return}const p=await currentVolunteer(u);if(!p){showPortalTab('login');return}if(p.role==='admin'){location.href='admin.html';return}await showVolunteerAccount(p)}
function showPortalTab(tab){q('portalAccountPanel')?.classList.add('hidden');q('portalLoginPanel')?.classList.toggle('hidden',tab!=='login');q('portalRegisterPanel')?.classList.toggle('hidden',tab!=='register');document.querySelectorAll('[data-portal-tab]').forEach(b=>b.classList.toggle('active',b.dataset.portalTab===tab))}
function wirePortal(){document.querySelectorAll('[data-portal-tab]').forEach(b=>b.addEventListener('click',()=>showPortalTab(b.dataset.portalTab)));q('portalLogout')?.addEventListener('click',async()=>{await supabase?.auth.signOut();showPortalTab('login');q('portalAccountPanel')?.classList.add('hidden')});q('registrationForm')?.addEventListener('submit',submitRegistration);q('volunteerLoginForm')?.addEventListener('submit',submitVolunteerLogin)}
function wireMenu(){q('menuToggle')?.addEventListener('click',()=>q('mainNav')?.classList.toggle('open'));document.querySelectorAll('#mainNav a').forEach(a=>a.addEventListener('click',()=>q('mainNav')?.classList.remove('open')))}
async function loadPublic(){text('year',new Date().getFullYear());q('ideaForm')?.addEventListener('submit',submitIdea);if(hasConfig){try{await initSupabaseClient()}catch{}}await Promise.all([publicStats(),loadStories(),loadPublicSettings()]);}
async function bootVolunteerPortal(){text('portalYear',new Date().getFullYear());wirePortal();showPortalTab('login');if(!hasConfig){message(q('loginMessage'),'Volunteer login is ready. Add your Supabase project URL and public/anon key in app.js to connect accounts.','error');return}try{await initSupabaseClient();await loadVolunteerAccount()}catch(err){message(q('loginMessage'),err.message||'Supabase could not be loaded. The form is still available.','error')}}

let volunteersCache=[];
async function loadVolunteers(){const {data,error}=await supabase.from('volunteers').select('*').order('created_at',{ascending:false});if(error){q('volunteerTable').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;return}volunteersCache=data||[];text('dashRegistered',volunteersCache.length);text('dashPending',volunteersCache.filter(x=>x.status==='pending').length);text('dashActive',volunteersCache.filter(x=>x.status==='active').length);renderVolunteerTable()}
function renderVolunteerTable(){const body=q('volunteerTable');if(!body)return;const s=(q('volunteerSearch')?.value||'').toLowerCase();const st=q('volunteerStatusFilter')?.value||'all';const yr=q('volunteerYearFilter')?.value||'all';const rows=volunteersCache.filter(v=>(st==='all'||v.status===st)&&(yr==='all'||v.year_level===yr)&&(!s||[v.full_name,v.email,v.phone,v.department,v.option_name,v.student_id,v.bank_name,v.bank_account_name,v.bank_account_number].join(' ').toLowerCase().includes(s)));body.innerHTML=rows.map(v=>`<tr><td><b>${esc(v.full_name)}</b><br><small>${esc(v.student_id||'')}</small></td><td>${esc(v.email)}<br>${esc(v.phone)}</td><td>${esc(v.year_level)} • ${esc(v.department)}<br>${esc(v.option_name)}</td><td>${esc(v.bank_name||'')}<br>${esc(v.bank_account_name||'')}<br><small>${esc(v.bank_account_number||'')}</small></td><td><span class="status-badge status-${esc(v.status)}">${esc(v.status)}</span></td><td>${esc(v.role)}${v.auth_user_id?'':'<br><small>Awaiting login</small>'}</td><td><div class="admin-actions">${v.status==='pending'?`<button class="primary" data-status="active" data-id="${v.id}">Approve</button>`:''}${v.status==='active'?`<button data-status="suspended" data-id="${v.id}">Suspend</button>`:''}${v.status==='suspended'?`<button data-status="active" data-id="${v.id}">Reactivate</button>`:''}${v.role==='volunteer'&&v.status==='active'&&v.auth_user_id?`<button class="primary" data-admin="${v.id}">Make admin</button>`:''}${v.role==='admin'&&v.auth_user_id?`<button class="danger" data-demote="${v.id}">Remove admin</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="7">No volunteers found.</td></tr>';body.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>setVolunteerStatus(b.dataset.id,b.dataset.status));body.querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>changeRole(b.dataset.admin,'admin'));body.querySelectorAll('[data-demote]').forEach(b=>b.onclick=()=>changeRole(b.dataset.demote,'volunteer'))}
async function setVolunteerStatus(id,status){const {error}=await supabase.from('volunteers').update({status,updated_at:new Date().toISOString()}).eq('id',id);if(error)alert(error.message);else await Promise.all([loadVolunteers(),loadAdmins()])}
async function changeRole(id,role){const me=await currentUser();const target=volunteersCache.find(x=>x.id===id);if(!target)return;if(target.auth_user_id===me?.id&&role==='volunteer'){alert('Do not remove admin access from your own account. Another admin can change your role.');return}if(role==='admin'&&!target.auth_user_id){alert('This volunteer has no login account yet. Ask them to register/login with this email first.');return}const {error}=await supabase.from('volunteers').update({role,updated_at:new Date().toISOString()}).eq('id',id);if(error)alert(error.message);else await Promise.all([loadVolunteers(),loadAdmins()])}
async function loadAdmins(){const list=q('adminList');if(!list)return;const {data,error}=await supabase.from('volunteers').select('*').eq('role','admin').eq('status','active').order('created_at');if(error){list.innerHTML=`<div class="admin-item">${esc(error.message)}</div>`;return}list.innerHTML=(data||[]).map(x=>`<div class="admin-item"><div class="admin-item-top"><h3>${esc(x.full_name)}</h3><span class="status-badge status-active">Admin</span></div><p>${esc(x.email)} • ${esc(x.phone)}<br>${esc(x.department)} • ${esc(x.year_level)}</p></div>`).join('')||'<div class="admin-item">No administrators yet.</div>'}
async function loadIdeas(){const list=q('ideaList');if(!list)return;const {data,error}=await supabase.from('ideas').select('*').order('created_at',{ascending:false}).limit(100);if(error){list.innerHTML=`<div class="admin-item">${esc(error.message)}</div>`;return}text('dashIdeas',(data||[]).filter(x=>x.status==='new').length);list.innerHTML=(data||[]).map(x=>`<div class="admin-item"><div class="admin-item-top"><h3>${esc((x.idea||'').slice(0,75))}</h3><span class="status-badge ${x.status==='new'?'status-pending':'status-active'}">${esc(x.status)}</span></div><p>${esc(x.name||'Anonymous')} ${x.email?'• '+esc(x.email):''}<br>${dateText(x.created_at)}</p><div class="admin-actions">${x.status!=='reviewed'?`<button data-idea="${x.id}" data-ideastatus="reviewed">Mark reviewed</button>`:''}${x.status!=='archived'?`<button class="danger" data-idea="${x.id}" data-ideastatus="archived">Archive</button>`:''}</div></div>`).join('')||'<div class="admin-item">No ideas yet.</div>';list.querySelectorAll('[data-idea]').forEach(b=>b.onclick=async()=>{await supabase.from('ideas').update({status:b.dataset.ideastatus}).eq('id',b.dataset.idea);loadIdeas()})}
async function loadPosts(){const list=q('adminPostList');if(!list)return;const {data,error}=await supabase.from('posts').select('*').order('created_at',{ascending:false});if(error){list.innerHTML=`<div class="admin-item">${esc(error.message)}</div>`;return}list.innerHTML=(data||[]).map(r=>`<div class="admin-item"><div class="admin-item-top"><h3>${esc(r.title)}</h3><span class="status-badge ${r.is_published?'status-active':'status-pending'}">${r.is_published?'Published':'Draft'}</span></div><p>${esc(r.category)} • ${dateText(r.created_at)}</p><div class="admin-actions"><button data-edit="${r.id}">Edit</button><button data-toggle="${r.id}">${r.is_published?'Unpublish':'Publish'}</button><button class="danger" data-delete="${r.id}">Delete</button></div></div>`).join('')||'<div class="admin-item">No stories yet.</div>';list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>fillPost(data.find(x=>x.id===b.dataset.edit)));list.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>togglePost(data.find(x=>x.id===b.dataset.toggle)));list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deletePost(data.find(x=>x.id===b.dataset.delete)))}
function fillPost(r){q('postId').value=r.id;q('postTitle').value=r.title;q('postCategory').value=r.category;q('postExcerpt').value=r.excerpt||'';q('postContent').value=r.content||'';q('postPublished').value=String(r.is_published);window.scrollTo({top:q('postManagement').offsetTop-70,behavior:'smooth'})}
function clearPost(){q('postForm').reset();q('postId').value=''}
async function togglePost(r){const {error}=await supabase.from('posts').update({is_published:!r.is_published,published_at:!r.is_published?(r.published_at||new Date().toISOString()):null,updated_at:new Date().toISOString()}).eq('id',r.id);if(error)alert(error.message);else loadPosts()}
async function deleteStoredPath(path){if(path)await supabase.storage.from('youth-media').remove([path])}
async function deletePost(r){if(!confirm(`Delete “${r.title}”?`))return;const {error}=await supabase.from('posts').delete().eq('id',r.id);if(error)alert(error.message);else{await deleteStoredPath(r.cover_path);await deleteStoredPath(r.media_path);loadPosts()}}
async function uploadMedia(file,uid){const path=`${uid}/${Date.now()}-${slugify(file.name).slice(0,70)}`;const {error}=await supabase.storage.from('youth-media').upload(path,file,{upsert:false});if(error)throw error;const {data}=supabase.storage.from('youth-media').getPublicUrl(path);return {path,url:data.publicUrl,name:file.name,type:file.type}}
async function savePost(e){e.preventDefault();const user=await currentUser();if(!await ensureAdmin(user))return;const id=q('postId').value;let old=null;if(id){const x=await supabase.from('posts').select('*').eq('id',id).maybeSingle();old=x.data}try{const cover=q('coverFile').files[0],media=q('mediaFile').files[0];let c={url:old?.cover_url||null,path:old?.cover_path||null},m={url:old?.media_url||null,path:old?.media_path||null,name:old?.media_name||null,type:old?.media_type||null};if(cover)c=await uploadMedia(cover,user.id);if(media)m=await uploadMedia(media,user.id);const published=q('postPublished').value==='true';const payload={title:q('postTitle').value.trim(),slug:old?.slug||`${slugify(q('postTitle').value)}-${Date.now().toString(36)}`,category:q('postCategory').value,excerpt:q('postExcerpt').value.trim(),content:q('postContent').value.trim(),cover_url:c.url,cover_path:c.path,media_url:m.url,media_path:m.path,media_name:m.name,media_type:m.type,is_published:published,published_at:published?(old?.published_at||new Date().toISOString()):null,author_id:(await currentVolunteer(user))?.id||null,updated_at:new Date().toISOString()};const result=id?await supabase.from('posts').update(payload).eq('id',id):await supabase.from('posts').insert(payload);if(result.error)throw result.error;if(cover&&old?.cover_path)await deleteStoredPath(old.cover_path);if(media&&old?.media_path)await deleteStoredPath(old.media_path);message(q('postMessage'),'Saved successfully.','success');clearPost();loadPosts()}catch(err){message(q('postMessage'),err.message,'error')}}
async function loadSettingsAdmin(){const {data}=await supabase.from('site_settings').select('*').eq('id',1).maybeSingle();if(!data)return;q('setCollegeName').value=data.college_name||'';q('setLogoUrl').value=data.logo_url||'';q('setHeroTitle').value=data.hero_title||'';q('setHeroSubtitle').value=data.hero_subtitle||'';q('setHeroText').value=data.hero_text||''}
async function saveSettings(e){e.preventDefault();if(!await ensureAdmin(await currentUser()))return;const {error}=await supabase.from('site_settings').upsert({id:1,college_name:q('setCollegeName').value.trim(),logo_url:q('setLogoUrl').value.trim(),hero_title:q('setHeroTitle').value.trim(),hero_subtitle:q('setHeroSubtitle').value.trim(),hero_text:q('setHeroText').value.trim(),updated_at:new Date().toISOString()});message(q('settingsMessage'),error?.message||'Homepage settings saved.',error?'error':'success')}
function exportVolunteers(level){const rows=volunteersCache.filter(v=>level==='all'||v.year_level===level).map(v=>({full_name:v.full_name,email:v.email,phone:v.phone,sex:v.sex,student_id:v.student_id,year_level:v.year_level,department:v.department,option:v.option_name,academic_year:v.academic_year,district:v.district,availability:v.availability,preferred_area:v.preferred_area,skills:v.skills,emergency_contact:v.emergency_contact,emergency_phone:v.emergency_phone,bank_name:v.bank_name,bank_account_name:v.bank_account_name,bank_account_number:v.bank_account_number,motivation:v.motivation,agreement_conduct:v.agreement_conduct,agreement_data:v.agreement_data,media_consent:v.media_consent,status:v.status,role:v.role,login_linked:!!v.auth_user_id,created_at:v.created_at}));downloadCsv(`rp-gishari-youth-volunteers-${level==='all'?'all':level}.csv`,rows)}

async function bootAdmin(){text('year',new Date().getFullYear());q('copySqlBtn')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(SETUP_SQL);alert('Supabase setup SQL copied.')}catch{alert(SETUP_SQL)}});try{await initSupabaseClient()}catch(err){message(q('loginMessage'),err.message||'Unable to load Supabase.','error');return}if(!supabase){message(q('loginMessage'),'Supabase is not configured. Add URL and public/anon key in app.js.','error');return}const login=q('loginView'),dash=q('dashboardView');const show=async()=>{const u=await currentUser();if(!u){login.classList.remove('hidden');dash.classList.add('hidden');q('logoutBtn').classList.add('hidden');return}const p=await ensureAdmin(u);if(!p){login.classList.remove('hidden');dash.classList.add('hidden');q('logoutBtn').classList.remove('hidden');message(q('loginMessage'),'This account is not an active administrator. Volunteer registration never grants admin access.','error');return}login.classList.add('hidden');dash.classList.remove('hidden');q('logoutBtn').classList.remove('hidden');text('adminName',p.full_name);text('adminNameLarge',p.full_name);text('adminEmail',p.email);await Promise.all([loadVolunteers(),loadAdmins(),loadIdeas(),loadPosts(),loadSettingsAdmin()])};q('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();message(q('loginMessage'),'Signing in…');const {error}=await supabase.auth.signInWithPassword({email:q('loginEmail').value.trim().toLowerCase(),password:q('loginPassword').value});if(error)return message(q('loginMessage'),error.message,'error');await show()});q('logoutBtn')?.addEventListener('click',async()=>{await supabase.auth.signOut();location.reload()});q('volunteerSearch')?.addEventListener('input',renderVolunteerTable);q('volunteerStatusFilter')?.addEventListener('change',renderVolunteerTable);q('volunteerYearFilter')?.addEventListener('change',renderVolunteerTable);document.querySelectorAll('[data-export]').forEach(b=>b.addEventListener('click',()=>exportVolunteers(b.dataset.export)));q('manualVolunteerForm')?.addEventListener('submit',addManualVolunteer);q('postForm')?.addEventListener('submit',savePost);q('resetPostBtn')?.addEventListener('click',clearPost);q('settingsForm')?.addEventListener('submit',saveSettings);supabase.auth.onAuthStateChange(()=>{show()});await show()}

function showPortalMode(){const home=q('publicHome'),portal=q('volunteerPortal');home?.classList.add('hidden');portal?.classList.remove('hidden');q('mainNav')?.classList.remove('open');document.title='Volunteer Login • RP Gishari College';bootVolunteerPortal()}

if(document.body?.dataset.page==='public'){wireMenu();const params=new URLSearchParams(location.search);if(params.get('portal')==='volunteer')showPortalMode();else loadPublic()}
if(isAdminPage){bootAdmin()}
