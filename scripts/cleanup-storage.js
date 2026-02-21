// Cleanup: Delete reel videos for DENIED + unreviewed PASS/REJECT profiles
const path = require('path');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // 1. Get DENIED profiles with videos
  const { data: denied } = await supabase
    .from('profiles')
    .select('username, reel_1_storage_path, reel_2_storage_path, reel_3_storage_path')
    .eq('videos_downloaded', true)
    .in('username', (
      await supabase.from('human_reviews').select('profile_username').eq('decision', 'DENIED')
    ).data.map(r => r.profile_username));

  // 2. Get unreviewed PASS/REJECT profiles with videos
  const { data: reviewed } = await supabase
    .from('human_reviews')
    .select('profile_username');
  const reviewedSet = new Set(reviewed.map(r => r.profile_username));

  const { data: passReject } = await supabase
    .from('profiles')
    .select('username, reel_1_storage_path, reel_2_storage_path, reel_3_storage_path')
    .eq('videos_downloaded', true)
    .in('recommendation', ['PASS', 'REJECT']);

  const unreviewed = (passReject || []).filter(p => !reviewedSet.has(p.username));

  const allProfiles = [...(denied || []), ...unreviewed];
  console.log(`Profiles to clean: ${allProfiles.length}`);

  // 3. Collect all storage paths
  const paths = [];
  const usernames = [];
  for (const p of allProfiles) {
    usernames.push(p.username);
    if (p.reel_1_storage_path) paths.push(p.reel_1_storage_path);
    if (p.reel_2_storage_path) paths.push(p.reel_2_storage_path);
    if (p.reel_3_storage_path) paths.push(p.reel_3_storage_path);
  }
  console.log(`Video files to delete: ${paths.length}`);

  // 4. Delete from storage in batches of 50
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 50) {
    const batch = paths.slice(i, i + 50);
    const { data, error } = await supabase.storage
      .from('reel-videos')
      .remove(batch);

    if (error) {
      console.error(`Batch ${i} error:`, error.message);
    } else {
      deleted += batch.length;
      console.log(`Deleted ${deleted}/${paths.length} files`);
    }
  }

  // 5. Clear storage paths in DB for these profiles
  for (let i = 0; i < usernames.length; i += 50) {
    const batch = usernames.slice(i, i + 50);
    const { error } = await supabase
      .from('profiles')
      .update({
        reel_1_storage_path: null,
        reel_2_storage_path: null,
        reel_3_storage_path: null,
        videos_downloaded: false
      })
      .in('username', batch);

    if (error) console.error('DB update error:', error.message);
  }

  console.log(`\nDone! Cleaned ${allProfiles.length} profiles, deleted ${deleted} video files.`);

  // 6. Check remaining files
  const { data: remaining } = await supabase.storage
    .from('reel-videos')
    .list('', { limit: 1000 });
  console.log(`Remaining folders in storage: ${(remaining || []).length}`);
}

main().catch(console.error);
