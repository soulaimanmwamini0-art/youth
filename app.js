// Amakuru ya Supabase
const SUPABASE_URL = 'https://dbxzornmwqtpbuzxghsx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // Shyiramo Anon Key yawe yuzuye hano

// Guhuza na Supabase Client
let supabaseClient = null;
if (window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

document.addEventListener('DOMContentLoaded', () => {
  // Gusuzuma niba urubuga ruri kuri portal ya volunteer
  const urlParams = new URLSearchParams(window.location.search);
  const portal = urlParams.get('portal');
  if (portal === 'volunteer') {
    const portalPage = document.getElementById('volunteerPortal');
    const homeMain = document.getElementById('home');
    if (portalPage) portalPage.classList.remove('hidden');
    if (homeMain) homeMain.classList.add('hidden');
  }

  // Gufungura / Gufunga Menu kuri Mobile
  const menuToggle = document.getElementById('menuToggle');
  const mainNav = document.getElementById('mainNav');
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      mainNav.classList.toggle('show');
    });
  }

  // Guhinduranya amashami muri Portal (Tabs)
  const tabButtons = document.querySelectorAll('[data-portal-tab]');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-portal-tab');
      document.querySelectorAll('.portal-tabs button').forEach(b => b.classList.remove('active'));
      if (targetTab === 'login') {
        document.querySelectorAll('[data-portal-tab="login"]').forEach(b => b.classList.add('active'));
        document.getElementById('portalLoginPanel')?.classList.remove('hidden');
        document.getElementById('portalRegisterPanel')?.classList.add('hidden');
        document.getElementById('portalAccountPanel')?.classList.add('hidden');
      } else if (targetTab === 'register') {
        document.querySelectorAll('[data-portal-tab="register"]').forEach(b => b.classList.add('active'));
        document.getElementById('portalRegisterPanel')?.classList.remove('hidden');
        document.getElementById('portalLoginPanel')?.classList.add('hidden');
        document.getElementById('portalAccountPanel')?.classList.add('hidden');
      }
    });
  });

  // Gusoma amakuru rusange n'inkuru muri Supabase
  if (supabaseClient) {
    loadPublicData();
  }

  // Kohereza Igitekerezo (Idea Form)
  const ideaForm = document.getElementById('ideaForm');
  if (ideaForm) {
    ideaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(ideaForm);
      const data = {
        name: formData.get('name'),
        email: formData.get('email'),
        idea: formData.get('idea'),
        created_at: new Date()
      };
      const msgDiv = document.getElementById('ideaMessage');
      if (msgDiv) msgDiv.textContent = "Kohereza igitekerezo...";

      if (supabaseClient) {
        try {
          const { error } = await supabaseClient.from('ideas').insert([data]);
          if (error) throw error;
          if (msgDiv) {
            msgDiv.textContent = "Igitekerezo cyawe cyoherejwe neza! Murakoze.";
            msgDiv.style.color = "green";
          }
          ideaForm.reset();
        } catch (err) {
          if (msgDiv) {
            msgDiv.textContent = "Habaye ikibazo: " + err.message;
            msgDiv.style.color = "red";
          }
        }
      } else {
        if (msgDiv) {
          msgDiv.textContent = "Supabase ntiyahujwe neza.";
          msgDiv.style.color = "red";
        }
      }
    });
  }

  // Kwiyandikisha nk'Umukorerabushake (Registration Form)
  const registrationForm = document.getElementById('registrationForm');
  if (registrationForm) {
    registrationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(registrationForm);
      const password = formData.get('password');
      const password2 = formData.get('password2');
      const msgDiv = document.getElementById('registrationMessage');

      if (password !== password2) {
        if (msgDiv) {
          msgDiv.textContent = "Ijambo ry'ibanga ntirihura!";
          msgDiv.style.color = "red";
        }
        return;
      }

      if (msgDiv) msgDiv.textContent = "Kwiyandikisha biri mu nzira...";

      const volunteerData = {
        full_name: formData.get('full_name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        sex: formData.get('sex'),
        student_id: formData.get('student_id'),
        year_level: formData.get('year_level'),
        department: formData.get('department'),
        option_name: formData.get('option_name'),
        academic_year: formData.get('academic_year'),
        district: formData.get('district'),
        availability: formData.get('availability'),
        preferred_area: formData.get('preferred_area'),
        skills: formData.get('skills'),
        emergency_contact: formData.get('emergency_contact'),
        emergency_phone: formData.get('emergency_phone'),
        bank_name: formData.get('bank_name'),
        bank_account_name: formData.get('bank_account_name'),
        bank_account_number: formData.get('bank_account_number'),
        motivation: formData.get('motivation'),
        status: 'Pending',
        created_at: new Date()
      };

      if (supabaseClient) {
        try {
          const { error } = await supabaseClient.from('volunteers').insert([volunteerData]);
          if (error) throw error;
          if (msgDiv) {
            msgDiv.textContent = "Wiyandikishe neza! Tegereza ko umuyobozi abyemeza.";
            msgDiv.style.color = "green";
          }
          registrationForm.reset();
        } catch (err) {
          if (msgDiv) {
            msgDiv.textContent = "Habaye ikibazo: " + err.message;
            msgDiv.style.color = "red";
          }
        }
      } else {
        if (msgDiv) {
          msgDiv.textContent = "Supabase ntiyahujwe neza.";
          msgDiv.style.color = "red";
        }
      }
    });
  }

  // Kwinjira muri Konti (Login Form)
  const volunteerLoginForm = document.getElementById('volunteerLoginForm');
  if (volunteerLoginForm) {
    volunteerLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(volunteerLoginForm);
      const email = formData.get('email');
      const msgDiv = document.getElementById('loginMessage');
      if (msgDiv) msgDiv.textContent = "Urikwinjira...";

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('volunteers')
            .select('*')
            .eq('email', email)
            .single();

          if (error || !data) {
            throw new Error("Konti ntiyabonetse cyangwa email siyo.");
          }

          if (data.status !== 'Active' && data.status !== 'approved') {
            throw new Error("Konti yawe iracyari 'Pending' cyangwa yahagaritswe.");
          }

          document.getElementById('portalLoginPanel')?.classList.add('hidden');
          document.getElementById('portalAccountPanel')?.classList.remove('hidden');

          document.getElementById('accountName').textContent = data.full_name || 'Volunteer';
          document.getElementById('accountStatus').textContent = data.status || 'Active';
          document.getElementById('accountLevel').textContent = data.year_level || '—';
          document.getElementById('accountDepartment').textContent = data.department || '—';
          document.getElementById('accountEmail').textContent = data.email || '—';
          document.getElementById('accountPhone').textContent = data.phone || '—';
          document.getElementById('accountCreated').textContent = new Date(data.created_at).toLocaleDateString() || '—';

          if (msgDiv) msgDiv.textContent = "";
        } catch (err) {
          if (msgDiv) {
            msgDiv.textContent = err.message;
            msgDiv.style.color = "red";
          }
        }
      }
    });
  }

  // Gusohoka muri Konti (Logout)
  const logoutBtn = document.getElementById('portalLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      document.getElementById('portalAccountPanel')?.classList.add('hidden');
      document.getElementById('portalLoginPanel')?.classList.remove('hidden');
      volunteerLoginForm?.reset();
    });
  }

  // Gushyiraho umwaka w'Uburenganzira (Copyright Year)
  const yearEl = document.getElementById('year');
  const portalYearEl = document.getElementById('portalYear');
  const currentYear = new Date().getFullYear();
  if (yearEl) yearEl.textContent = currentYear;
  if (portalYearEl) portalYearEl.textContent = currentYear;
});

async function loadPublicData() {
  try {
    const { count: volCount } = await supabaseClient.from('volunteers').select('*', { count: 'exact', head: true });
    const { count: activeCount } = await supabaseClient.from('volunteers').select('*', { count: 'exact', head: true }).eq('status', 'Active');
    const { count: storiesCount } = await supabaseClient.from('stories').select('*', { count: 'exact', head: true });
    const { count: ideasCount } = await supabaseClient.from('ideas').select('*', { count: 'exact', head: true });

    if (document.getElementById('heroVolunteerCount')) document.getElementById('heroVolunteerCount').textContent = volCount || 0;
    if (document.getElementById('heroActiveCount')) document.getElementById('heroActiveCount').textContent = activeCount || 0;
    if (document.getElementById('statVolunteers')) document.getElementById('statVolunteers').textContent = volCount || 0;
    if (document.getElementById('statActive')) document.getElementById('statActive').textContent = activeCount || 0;
    if (document.getElementById('statActivities')) document.getElementById('statActivities').textContent = storiesCount || 0;
    if (document.getElementById('statIdeas')) document.getElementById('statIdeas').textContent = ideasCount || 0;

    const { data: stories } = await supabaseClient.from('stories').select('*').order('created_at', { ascending: false }).limit(6);
    const storiesGrid = document.getElementById('storiesGrid');
    if (storiesGrid) {
      if (stories && stories.length > 0) {
        storiesGrid.innerHTML = stories.map(story => `
          <article class="story-card">
            <h3>${story.title || ''}</h3>
            <p>${story.description || ''}</p>
          </article>
        `).join('');
      } else {
        storiesGrid.innerHTML = '<div class="loading-box">Nta nkuru zirasohoka.</div>';
      }
    }
  } catch (e) {
    console.log("Supabase fetch info notice:", e.message);
  }
}
