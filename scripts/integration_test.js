require('./load_env').loadEnv();
const { GarminConnect } = require('garmin-connect');

async function test() {
  const username = process.env.GARMIN_USER;
  const password = process.env.GARMIN_PASS;

  if (!username || !password) {
    console.error('❌ Missing credentials. Set GARMIN_USER and GARMIN_PASS in .env');
    process.exit(1);
  }

  console.log('🔐 Connecting to Garmin with', username, '...');

  const client = new GarminConnect({ username, password });
  await client.login();
  console.log('✅ Login successful!\n');

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const testDate = yesterday;
  const dateStr = testDate.toISOString().slice(0, 10);

  console.log(`📅 Fetching data for ${dateStr}...\n`);

  const results = {};

  // Steps
  try {
    results.steps = await client.getSteps(testDate);
    console.log('👣 Steps:', results.steps);
  } catch (e) {
    console.log('👣 Steps: ERROR -', e.message);
  }

  // Heart rate
  try {
    const hr = await client.getHeartRate(testDate);
    results.heartRate = hr?.restingHeartRate ?? hr?.average ?? null;
    console.log('❤️  Heart rate:', results.heartRate, '(raw:', JSON.stringify(hr)?.slice(0, 80), ')');
  } catch (e) {
    console.log('❤️  Heart rate: ERROR -', e.message);
  }

  // Sleep
  try {
    const sleep = await client.getSleep(testDate);
    const secs = sleep?.dailySleepDTO?.sleepTimeSeconds ?? null;
    results.sleep_min = secs !== null ? Math.round(secs / 60) : null;
    console.log('💤 Sleep:', results.sleep_min, 'min (raw sleepTimeSeconds:', secs, ')');
  } catch (e) {
    console.log('💤 Sleep: ERROR -', e.message);
  }

  // Weight
  try {
    const w = await client.getWeight(testDate);
    results.weight = w?.weight ?? w?.weightInGrams != null ? (w.weightInGrams / 1000) : null;
    console.log('⚖️  Weight:', results.weight, 'kg (raw:', JSON.stringify(w)?.slice(0, 80), ')');
  } catch (e) {
    console.log('⚖️  Weight: ERROR -', e.message);
  }

  // Activities
  try {
    const activities = await client.getActivities(0, 5);
    const dateActivities = (activities || []).filter(a => {
      const d = (a.startTimeLocal || '').slice(0, 10);
      return d === dateStr;
    });
    console.log('🏃 Activities on', dateStr + ':', dateActivities.length,
      dateActivities.map(a => `${a.activityType?.typeKey ?? a.activityType} (${((a.distance ?? 0) / 1000).toFixed(1)}km)`).join(', ') || '(none)');
  } catch (e) {
    console.log('🏃 Activities: ERROR -', e.message);
  }

  console.log('\n✅ Integration test done.');
}

test().catch(err => {
  console.error('❌ Fatal error:', err.message || err);
  process.exit(1);
});
