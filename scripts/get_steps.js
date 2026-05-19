require('dotenv').config();
const { GarminConnect } = require('garmin-connect');

(async () => {
  // Credentials loaded from .env file
  const username = process.env.GARMIN_USER;
  const password = process.env.GARMIN_PASS;
  
  // Debug: verify credentials are loaded
  console.log('Username loaded:', username ? 'YES' : 'NO');
  console.log('Password loaded:', password ? 'YES' : 'NO');
  
  if (!username || !password) {
    console.error('Missing credentials. Set GARMIN_USER and GARMIN_PASS in your .env file.');
    console.error('Create a .env file with:');
    console.error('GARMIN_USER=your_email@example.com');
    console.error('GARMIN_PASS=your_password');
    process.exit(1);
  }

  try {
    const client = new GarminConnect({
      username: username,
      password: password
    });
    console.log('Connecting to Garmin...');
    await client.login();
    console.log('Successfully logged in!');
    
    const targetDate = new Date('2025-12-07');
    const steps = await client.getSteps(targetDate);
    console.log(`Steps for ${targetDate.toISOString().slice(0, 10)}:`, steps);
    process.exit(0);
  } catch (err) {
    console.error('Error fetching steps:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();