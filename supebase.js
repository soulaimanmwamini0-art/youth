// supabase.js - Gahuza-murongo na Supabase (Byakuwemo ibijyanye na Admin)

const SUPABASE_URL = 'https://dbxzornmwqtpbuzxghsx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRieHpvcm5td3F0cGJ1enhnaHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzg2MTQsImV4cCI6MjEwNjcxNDYxNH0.tSaf11mNl_woKKqsvPlPdepI7ly28pZYMr0UJ2uSIpY'; // Shyiramo Anon Key yose uko yakabaye

// Kwemeza no guhuza na Supabase client
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (!supabase) {
  console.error("Supabase SDK ntirashyirwa kuri murandasi (CDN). Reba ko yinjijwe muri HTML yawe.");
}
