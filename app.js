/* RP Gishari Youth Volunteers - 4-file deployment
   Frontend only uses the Supabase public/anon (publishable) key.
   Never put a service_role key in this file.
*/
const SUPABASE_URL = 'https://dbxzornmwqtpbuzxghsx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRieHpvcm5td3F0cGJ1enhnaHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzg2MTQsImV4cCI6MjEwNjcxNDYxNH0.tSaf11mNl_woKKqsvPlPdepI7ly28pZYMr0UJ2uSIpY';
const hasConfig = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('PASTE_');
let supabase = null;
let supabaseLoadPromise = null;
const SUPABASE_BROWSER_SDK_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2'
];

function getSupabaseCreateClient(){
  const sdk=window.supabase;
  return sdk && typeof sdk.createClient==='function' ? sdk.createClient.bind(sdk) : null;
}

function createSupabaseClient(){
  const createClient=getSupabaseCreateClient();
  if(!createClient) return null;
  return createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
}

function loadSupabaseBrowserSdk(){
  return new Promise((resolve,reject)=>{
    let index=0;
    const tryNext=()=>{
      const ready=createSupabaseClient();
      if(ready){resolve(ready);return;}
      if(index>=SUPABASE_BROWSER_SDK_URLS.length){
        reject(new Error('Supabase browser library could not be loaded.'));
        return;
      }
      const script=document.createElement('script');
      script.src=SUPABASE_BROWSER_SDK_URLS[index++];
      script.async=true;
      script.setAttribute('data-supabase-sdk','true');
      script.onload=()=>{
        const client=createSupabaseClient();
        if(client){resolve(client);return;}
        script.remove();
        tryNext();
      };
      script.onerror=()=>{
        script.remove();
        tryNext();
      };
      document.head.appendChild(script);
    };
    tryNext();
  });
}

function initSupabaseClient(){
  if(supabase) return Promise.resolve(supabase);
  if(!hasConfig) return Promise.resolve(null);
  const ready=createSupabaseClient();
  if(ready){
    supabase=ready;
    return Promise.resolve(supabase);
  }
  if(supabaseLoadPromise) return supabaseLoadPromise;
  supabaseLoadPromise=loadSupabaseBrowserSdk().then(client=>{
    supabase=client;
    return client;
  });
  return supabaseLoadPromise;
}

const isAdminPage = document.body?.dataset.page === 'admin';

const SETUP_SQL = String.raw`
-- RP GISHARI COLLEGE - YOUTH VOLUNTEERS
-- Run this entire script in Supabase SQL Editor.
-- It is safe for the current 4-file website and migrates legacy profiles when present.

create extension if not exists pgcrypto;

-- ============================================================
-- 1. CANONICAL VOLUNTEER TABLE
-- ============================================================
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

-- Legacy migration from the earlier 4-file version.
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute $migrate$
      insert into public.volunteers (
        id, auth_user_id, full_name, email, phone, sex, student_id, year_level, department, option_name,
        academic_year, district, availability, preferred_area, skills, emergency_contact, emergency_phone,
        bank_name, bank_account_name, bank_account_number, motivation, agreement_conduct, agreement_data,
        media_consent, status, role, created_at, updated_at
      )
      select
        p.id, p.id, p.full_name, p.email, p.phone, p.sex, p.student_id, p.year_level, p.department, p.option_name,
        p.academic_year, p.district, p.availability, p.preferred_area, p.skills, p.emergency_contact, p.emergency_phone,
        (to_jsonb(p)->>'bank_name'), (to_jsonb(p)->>'bank_account_name'), (to_jsonb(p)->>'bank_account_number'), p.motivation, p.agreement_conduct, p.agreement_data,
        p.media_consent, p.status, p.role, p.created_at, p.updated_at
      from public.profiles p
      on conflict (id) do nothing
    $migrate$;
  end if;
end $$;

-- ============================================================
-- 2. SECURITY FUNCTIONS + AUTH LINKING
-- ============================================================
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

create or replace function public.protect_volunteer_privileges()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    if OLD.auth_user_id is distinct from auth.uid() then
      raise exception 'Not allowed';
    end if;
    NEW.id := OLD.id;
    NEW.auth_user_id := OLD.auth_user_id;
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.created_at := OLD.created_at;
    NEW.email := OLD.email;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists protect_volunteer_privileges on public.volunteers;
create trigger protect_volunteer_privileges
before update on public.volunteers
for each row execute function public.protect_volunteer_privileges();

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.volunteers
  where lower(email)=lower(new.email) and auth_user_id is null
  order by created_at asc
  limit 1;

  if existing_id is not null then
    update public.volunteers set
      auth_user_id = new.id,
      email = new.email,
      full_name = coalesce(nullif(full_name,''), new.raw_user_meta_data->>'full_name',''),
      phone = coalesce(nullif(phone,''), new.raw_user_meta_data->>'phone',''),
      sex = coalesce(nullif(sex,''), new.raw_user_meta_data->>'sex',''),
      student_id = coalesce(student_id, new.raw_user_meta_data->>'student_id'),
      year_level = coalesce(nullif(year_level,''), new.raw_user_meta_data->>'year_level'),
      department = coalesce(nullif(department,''), new.raw_user_meta_data->>'department',''),
      option_name = coalesce(nullif(option_name,''), new.raw_user_meta_data->>'option_name',''),
      academic_year = coalesce(academic_year, new.raw_user_meta_data->>'academic_year'),
      district = coalesce(district, new.raw_user_meta_data->>'district'),
      availability = coalesce(availability, new.raw_user_meta_data->>'availability','Weekly'),
      preferred_area = coalesce(preferred_area, new.raw_user_meta_data->>'preferred_area'),
      skills = coalesce(skills, new.raw_user_meta_data->>'skills'),
      emergency_contact = coalesce(emergency_contact, new.raw_user_meta_data->>'emergency_contact'),
      emergency_phone = coalesce(emergency_phone, new.raw_user_meta_data->>'emergency_phone'),
      bank_name = coalesce(bank_name, new.raw_user_meta_data->>'bank_name'),
      bank_account_name = coalesce(bank_account_name, new.raw_user_meta_data->>'bank_account_name'),
      bank_account_number = coalesce(bank_account_number, new.raw_user_meta_data->>'bank_account_number'),
      motivation = coalesce(nullif(motivation,''), new.raw_user_meta_data->>'motivation',''),
      agreement_conduct = case when agreement_conduct then true else coalesce((new.raw_user_meta_data->>'agreement_conduct')::boolean,false) end,
      agreement_data = case when agreement_data then true else coalesce((new.raw_user_meta_data->>'agreement_data')::boolean,false) end,
      media_consent = case when media_consent then true else coalesce((new.raw_user_meta_data->>'media_consent')::boolean,false) end,
      updated_at = now()
    where id = existing_id;
    return new;
  end if;

  insert into public.volunteers (
    id, auth_user_id, full_name, email, phone, sex, student_id, year_level, department, option_name,
    academic_year, district, availability, preferred_area, skills, emergency_contact, emergency_phone,
    bank_name, bank_account_name, bank_account_number, motivation, agreement_conduct, agreement_data,
    media_consent, status, role
  ) values (
    new.id, new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone',''),
    coalesce(new.raw_user_meta_data->>'sex',''),
    new.raw_user_meta_data->>'student_id',
    coalesce(new.raw_user_meta_data->>'year_level',''),
    coalesce(new.raw_user_meta_data->>'department',''),
    coalesce(new.raw_user_meta_data->>'option_name',''),
    new.raw_user_meta_data->>'academic_year',
    new.raw_user_meta_data->>'district',
    coalesce(new.raw_user_meta_data->>'availability','Weekly'),
    new.raw_user_meta_data->>'preferred_area',
    new.raw_user_meta_data->>'skills',
    new.raw_user_meta_data->>'emergency_contact',
    new.raw_user_meta_data->>'emergency_phone',
    new.raw_user_meta_data->>'bank_name',
    new.raw_user_meta_data->>'bank_account_name',
    new.raw_user_meta_data->>'bank_account_number',
    coalesce(new.raw_user_meta_data->>'motivation',''),
    coalesce((new.raw_user_meta_data->>'agreement_conduct')::boolean,false),
    coalesce((new.raw_user_meta_data->>'agreement_data')::boolean,false),
    coalesce((new.raw_user_meta_data->>'media_consent')::boolean,false),
    'pending','volunteer'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================
-- 3. VOLUNTEER RLS
-- ============================================================
drop policy if exists volunteers_self_select on public.volunteers;
create policy volunteers_self_select on public.volunteers
for select to authenticated
using (auth_user_id=auth.uid() or public.is_admin(auth.uid()));

drop policy if exists volunteers_self_update on public.volunteers;
create policy volunteers_self_update on public.volunteers
for update to authenticated
using (auth_user_id=auth.uid() or public.is_admin(auth.uid()))
with check (auth_user_id=auth.uid() or public.is_admin(auth.uid()));

drop policy if exists volunteers_admin_insert on public.volunteers;
create policy volunteers_admin_insert on public.volunteers
for insert to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists volunteers_admin_delete on public.volunteers;
create policy volunteers_admin_delete on public.volunteers
for delete to authenticated
using (public.is_admin(auth.uid()));

-- ============================================================
-- 4. PUBLIC STATS (ONLY AGGREGATES)
-- ============================================================
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  idea text not null,
  status text not null default 'new' check (status in ('new','reviewed','archived')),
  created_at timestamptz not null default now()
);

alter table public.ideas enable row level security;
drop policy if exists ideas_public_insert on public.ideas;
create policy ideas_public_insert on public.ideas for insert to anon,authenticated with check (true);
drop policy if exists ideas_admin_select on public.ideas;
create policy ideas_admin_select on public.ideas for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists ideas_admin_update on public.ideas;
create policy ideas_admin_update on public.ideas for update to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists ideas_admin_delete on public.ideas;
create policy ideas_admin_delete on public.ideas for delete to authenticated
using (public.is_admin(auth.uid()));

create or replace function public.get_public_stats()
returns json
language plpgsql security definer set search_path=public
as $$
declare result json;
begin
  select json_build_object(
    'registered',count(*),
    'active',count(*) filter(where status='active'),
    'pending',count(*) filter(where status='pending'),
    'suspended',count(*) filter(where status='suspended'),
    'female',count(*) filter(where lower(sex)='female'),
    'male',count(*) filter(where lower(sex)='male'),
    'other_sex',count(*) filter(where lower(sex) not in ('female','male')),
    'ideas_received',(select count(*) from public.ideas)
  ) into result from public.volunteers;
  return result;
end;
$$;
grant execute on function public.get_public_stats() to anon, authenticated;

-- ============================================================
-- 5. POSTS / STORIES
-- ============================================================
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  category text not null default 'Story',
  excerpt text,
  content text,
  cover_url text,
  cover_path text,
  media_url text,
  media_path text,
  media_name text,
  media_type text,
  is_published boolean not null default false,
  published_at timestamptz,
  author_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare r record;
begin
  if to_regclass('public.posts') is not null then
    for r in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.conrelid='public.posts'::regclass and c.contype='f' and a.attname='author_id'
    loop
      execute format('alter table public.posts drop constraint %I',r.conname);
    end loop;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.posts'::regclass and conname='posts_author_id_fkey'
  ) then
    alter table public.posts add constraint posts_author_id_fkey
      foreign key (author_id) references public.volunteers(id) on delete set null;
  end if;
end $$;

alter table public.posts enable row level security;
drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts for select to anon,authenticated
using (is_published=true or public.is_admin(auth.uid()));
drop policy if exists posts_admin_write on public.posts;
create policy posts_admin_write on public.posts for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ============================================================
-- 6. HOMEPAGE SETTINGS
-- ============================================================
create table if not exists public.site_settings (
  id integer primary key default 1,
  college_name text default 'Youth Volunteers • RP Gishari College',
  logo_url text,
  hero_title text default 'Young people serve, lead and build a stronger Rwanda.',
  hero_subtitle text default 'A living digital home where Youth Volunteers show what they did, how they did it, what they learned and the difference they made.',
  hero_text text default 'Youth Volunteer of RP Gishari College is a student-led community for volunteering, learning, leadership, innovation and practical service.',
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists settings_public_read on public.site_settings;
create policy settings_public_read on public.site_settings for select to anon,authenticated using (true);
drop policy if exists settings_admin_write on public.site_settings;
create policy settings_admin_write on public.site_settings for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
insert into public.site_settings(id) values(1) on conflict(id) do nothing;

-- ============================================================
-- 7. STORAGE FOR IMAGES / AUDIO / VIDEO / DOCUMENTS
-- ============================================================
insert into storage.buckets(id,name,public)
values('youth-media','youth-media',true)
on conflict(id) do nothing;

drop policy if exists youth_media_public_read on storage.objects;
create policy youth_media_public_read on storage.objects
for select to anon,authenticated
using (bucket_id='youth-media');

drop policy if exists youth_media_admin_insert on storage.objects;
create policy youth_media_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id='youth-media' and public.is_admin(auth.uid()));

drop policy if exists youth_media_admin_update on storage.objects;
create policy youth_media_admin_update on storage.objects
for update to authenticated
using (bucket_id='youth-media' and public.is_admin(auth.uid()))
with check (bucket_id='youth-media' and public.is_admin(auth.uid()));

drop policy if exists youth_media_admin_delete on storage.objects;
create policy youth_media_admin_delete on storage.objects
for delete to authenticated
using (bucket_id='youth-media' and public.is_admin(auth.uid()));

-- ============================================================
-- 8. UPDATED_AT HELPER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists volunteers_set_updated_at on public.volunteers;
create trigger volunteers_set_updated_at before update on public.volunteers
for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.site_settings;
create trigger settings_set_updated_at before update on public.site_settings
for each row execute function public.set_updated_at();
`;

function q(id){return document.getElementById(id)}
function setLoading(button,loading,label='Please wait…'){
  if(!button) return;
  if(loading){
    if(button.dataset.loadingOriginalText===undefined){button.dataset.loadingOriginalText=button.textContent||''}
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.textContent=label;
    return;
  }
  button.disabled=false;
  button.removeAttribute('aria-busy');
  if(button.dataset.loadingOriginalText!==undefined){
    button.textContent=button.dataset.loadingOriginalText;
    delete button.dataset.loadingOriginalText;
  }
}
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

async function performLogin(email, password) {
  const loginMsg = q('loginMessage');
  const loginForm = q('volunteerLoginForm');
  const submitBtn = loginForm?.querySelector('button[type="submit"]');

  try {
    setLoading(submitBtn, true, 'Unlocking portal...');
    const client = await initSupabaseClient();
    if (!client) {
      throw new Error('Supabase is not configured.');
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password
    });

    if (error) throw error;

    const p = await currentVolunteer(data.user);
    if (!p) {
      message(loginMsg, 'Your volunteer record is not ready yet. Contact the program administrator.', 'error');
      await client.auth.signOut();
      return;
    }
    if (p.status === 'pending') {
      message(loginMsg, 'Your volunteer application is still Pending admin approval.', 'error');
      await client.auth.signOut();
      return;
    }
    if (p.status === 'suspended') {
      message(loginMsg, 'Your volunteer account is suspended.', 'error');
      await client.auth.signOut();
      return;
    }
    if (p.role === 'admin') {
      location.href = 'admin.html';
      return;
    }
    await showVolunteerAccount(p);
  } catch (err) {
    message(loginMsg, err.message || 'Failed to unlock portal. Check credentials.', 'error');
  } finally {
    setLoading(submitBtn, false);
  }
}

async function submitVolunteerLogin(e){
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  await performLogin(fd.get('email'), fd.get('password'));
}

async function showVolunteerAccount(p){q('portalLoginPanel')?.classList.add('hidden');q('portalRegisterPanel')?.classList.add('hidden');q('portalAccountPanel')?.classList.remove('hidden');text('accountName',p.full_name);text('accountStatus',p.status);text('accountLevel',p.year_level);text('accountDepartment',p.department);text('accountEmail',p.email);text('accountPhone',p.phone);text('accountCreated',dateText(p.created_at));}
async function loadVolunteerAccount(){const u=await currentUser();if(!u){showPortalTab('login');return}const p=await currentVolunteer(u);if(!p){showPortalTab('login');return}if(p.role==='admin'){location.href='admin.html';return}await showVolunteerAccount(p)}
function showPortalTab(tab){q('portalAccountPanel')?.classList.add('hidden');q('portalLoginPanel')?.classList.toggle('hidden',tab!=='login');q('portalRegisterPanel')?.classList.toggle('hidden',tab!=='register');document.querySelectorAll('[data-portal-tab]').forEach(b=>b.classList.toggle('active',b.dataset.portalTab===tab))}
function wirePortal(){document.querySelectorAll('[data-portal-tab]').forEach(b=>b.addEventListener('click',()=>showPortalTab(b.dataset.portalTab)));q('portalLogout')?.addEventListener('click',async()=>{await supabase?.auth.signOut();showPortalTab('login');q('portalAccountPanel')?.classList.add('hidden')});q('registrationForm')?.addEventListener('submit',submitRegistration);q('volunteerLoginForm')?.addEventListener('submit',submitVolunteerLogin)}
function wireMenu(){q('menuToggle')?.addEventListener('click',()=>q('mainNav')?.classList.toggle('open'));document.querySelectorAll('#mainNav a').forEach(a=>a.addEventListener('click',()=>q('mainNav')?.classList.remove('open')))}
async function loadPublic(){text('year',new Date().getFullYear());q('ideaForm')?.addEventListener('submit',submitIdea);if(hasConfig){try{await initSupabaseClient()}catch{}}await Promise.all([publicStats(),loadStories(),loadPublicSettings()]);}

async function bootVolunteerPortal(recoveredEmail=''){
  text('portalYear',new Date().getFullYear());
  wirePortal();
  showPortalTab('login');

  const params = new URLSearchParams(window.location.search);
  const urlEmail = params.get('email') || recoveredEmail;
  const urlPassword = params.get('password');

  if(urlEmail && q('volunteerLoginForm')) {
    q('volunteerLoginForm').elements.email.value = urlEmail;
  }
  if(urlPassword && q('volunteerLoginForm')) {
    q('volunteerLoginForm').elements.password.value = urlPassword;
  }

  if(!hasConfig){
    message(q('loginMessage'),'Volunteer login is ready. Add your Supabase project URL and public/anon key in app.js to connect accounts.','error');
    return;
  }

  // Automatically trigger login if both email and password are provided via query parameters
  if(urlEmail && urlPassword) {
    await performLogin(urlEmail, urlPassword);
    return;
  }

  try{
    await initSupabaseClient();
    await loadVolunteerAccount();
  }catch(err){
    message(q('loginMessage'),err.message||'Supabase could not be loaded. The form is still available.','error');
  }
}
