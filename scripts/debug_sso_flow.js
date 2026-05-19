/**
 * Debug script: reproduce the exact Garmin SSO login flow step by step,
 * logging every cookie received and sent, to understand what Obsidian 
 * requestUrl would need.
 */
require('dotenv').config();

// Simple querystring stringify (no external dep)
function qsStringify(obj) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

const username = process.env.GARMIN_USER;
const password = process.env.GARMIN_PASS;

const GARMIN_SSO_ORIGIN = 'https://sso.garmin.com';
const GARMIN_SSO = `${GARMIN_SSO_ORIGIN}/sso`;
const GARMIN_SSO_EMBED = `${GARMIN_SSO}/embed`;
const SIGNIN_URL = `${GARMIN_SSO}/signin`;

const CSRF_RE = /name="_csrf"\s+value="([^"]+)"|value="([^"]+)"\s+name="_csrf"/;

// Manual cookie jar
const cookieJar = new Map();

function extractCookies(headers, stepName) {
  const rawCookies = [];
  
  // Node fetch getSetCookie
  if (typeof headers.getSetCookie === 'function') {
    rawCookies.push(...headers.getSetCookie());
  } else if (headers.get) {
    const sc = headers.get('set-cookie');
    if (sc) rawCookies.push(sc);
  }
  
  console.log(`\n=== ${stepName}: ${rawCookies.length} set-cookie header(s) ===`);
  for (const c of rawCookies) {
    console.log('  RAW:', c.substring(0, 120));
    const parts = c.split(';');
    const nv = parts[0].trim();
    const eqIdx = nv.indexOf('=');
    if (eqIdx === -1) continue;
    const name = nv.substring(0, eqIdx).trim();
    const value = nv.substring(eqIdx + 1).trim();
    cookieJar.set(name, value);
  }
  console.log(`  JAR now has ${cookieJar.size} cookies:`, [...cookieJar.keys()].join(', '));
}

function getCookieHeader() {
  return Array.from(cookieJar.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
}

async function main() {
  console.log('=== Step 1: GET embed (set cookies) ===');
  const step1Params = { clientId: 'GarminConnect', locale: 'en', service: 'https://connect.garmin.com/modern' };
  const step1Url = `${GARMIN_SSO_EMBED}?${qsStringify(step1Params)}`;
  console.log('URL:', step1Url);
  
  const r1 = await fetch(step1Url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    redirect: 'manual'
  });
  console.log('Status:', r1.status);
  extractCookies(r1.headers, 'Step1');
  await r1.text(); // consume body

  console.log('\n=== Step 2: GET signin (get CSRF) ===');
  const step2Params = {
    id: 'gauth-widget',
    embedWidget: 'true',
    locale: 'en',
    gauthHost: GARMIN_SSO_EMBED
  };
  const step2Url = `${SIGNIN_URL}?${qsStringify(step2Params)}`;
  console.log('URL:', step2Url);
  console.log('Cookie:', getCookieHeader().substring(0, 100));
  
  const r2 = await fetch(step2Url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Cookie': getCookieHeader()
    },
    redirect: 'manual'
  });
  console.log('Status:', r2.status);
  extractCookies(r2.headers, 'Step2');
  const step2Html = await r2.text();
  
  const csrfMatch = CSRF_RE.exec(step2Html);
  if (!csrfMatch) {
    console.error('CSRF not found!');
    console.log('HTML:', step2Html.substring(0, 300));
    process.exit(1);
  }
  const csrf = csrfMatch[1] || csrfMatch[2];
  console.log('CSRF:', csrf.substring(0, 20) + '...');

  console.log('\n=== Step 3: POST signin (credentials) ===');
  const signinParams = {
    id: 'gauth-widget',
    embedWidget: 'true',
    clientId: 'GarminConnect',
    locale: 'en',
    gauthHost: GARMIN_SSO_EMBED,
    service: GARMIN_SSO_EMBED,
    source: GARMIN_SSO_EMBED,
    redirectAfterAccountLoginUrl: GARMIN_SSO_EMBED,
    redirectAfterAccountCreationUrl: GARMIN_SSO_EMBED
  };
  const step3Url = `${SIGNIN_URL}?${qsStringify(signinParams)}`;
  const step3Body = qsStringify({ username, password, embed: 'true', _csrf: csrf });
  
  console.log('URL:', step3Url);
  console.log('Cookie:', getCookieHeader().substring(0, 150));
  console.log('Body:', step3Body.substring(0, 80) + '...');
  
  const r3 = await fetch(step3Url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': GARMIN_SSO_ORIGIN,
      'Referer': step2Url,
      'Cookie': getCookieHeader()
    },
    body: step3Body,
    redirect: 'manual'
  });
  console.log('Status:', r3.status);
  extractCookies(r3.headers, 'Step3');
  const step3Html = await r3.text();
  
  const ticketMatch = /ticket=([^"&]+)/.exec(step3Html);
  if (ticketMatch) {
    console.log('\n✅ TICKET FOUND:', ticketMatch[1].substring(0, 30) + '...');
  } else {
    console.log('\n❌ No ticket found');
    console.log('Title:', (/<title>([^<]*)<\/title>/.exec(step3Html) || ['', 'N/A'])[1]);
    console.log('HTML preview:', step3Html.substring(0, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
