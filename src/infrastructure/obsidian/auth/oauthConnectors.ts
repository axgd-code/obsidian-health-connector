import { Notice } from 'obsidian';
import { StravaProvider } from '../../providers/strava/StravaProvider';
import { GoogleHealthProvider } from '../../providers/google/GoogleHealthProvider';

interface LoggerLike {
  error(message: string, ...args: unknown[]): void;
}

interface BaseAuthDeps {
  i18n: any;
  logger: LoggerLike;
}

interface StravaConnectDeps extends BaseAuthDeps {
  clientId: string;
  clientSecret: string;
  onTokens: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => Promise<void>;
}

interface GoogleConnectDeps extends BaseAuthDeps {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  onTokens: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => Promise<void>;
}

function renderAuthHtml(title: string, message: string): string {
  return `<html><body><h2>${title}</h2><p>${message}</p></body></html>`;
}

export async function connectStravaOAuth(deps: StravaConnectDeps): Promise<void> {
  let server: any;
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  try {
    const http = (window as any).require('http');
    server = http.createServer((req: any, res: any) => {
      try {
        const url = new URL(`http://localhost${req.url}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (code) {
          res.end(renderAuthHtml(`✅ ${deps.i18n.auth.successTitle('Strava')}`, deps.i18n.auth.successCloseTab));
          resolveCode(code);
        } else {
          res.end(renderAuthHtml(`❌ ${deps.i18n.auth.errorTitle}`, error ?? deps.i18n.auth.deniedDefault));
          rejectCode(new Error(`Strava OAuth denied: ${error ?? 'unknown'}`));
        }
      } catch (e) {
        res.end(deps.i18n.auth.internalError);
        rejectCode(e as Error);
      }
    });

    await new Promise<void>((res, rej) => server.listen(0, '127.0.0.1', (err: any) => err ? rej(err) : res()));
    const port = (server.address() as any).port;

    const redirectUri = `http://localhost:${port}`;
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(deps.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&approval_prompt=force&scope=activity%3Aread_all`;

    const { shell } = (window as any).require('electron');
    await shell.openExternal(authUrl);
    new Notice(deps.i18n.notices.stravaAuthorizeBrowser, 6000);

    const timeoutHandle = setTimeout(() => rejectCode(new Error('Timeout: pas de réponse Strava après 5 minutes')), 5 * 60 * 1000);
    const code = await codePromise;
    clearTimeout(timeoutHandle);

    const tokens = await StravaProvider.exchangeCode(deps.clientId, deps.clientSecret, code);
    await deps.onTokens(tokens);

    new Notice(deps.i18n.notices.stravaConnected);
  } catch (e) {
    deps.logger.error('Strava connect error:', e);
    new Notice(deps.i18n.notices.stravaError((e as Error).message));
  } finally {
    if (server) server.close();
  }
}

export async function connectGoogleOAuth(deps: GoogleConnectDeps): Promise<void> {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(deps.redirectUri);
  } catch {
    new Notice(deps.i18n.notices.googleError('redirect_uri invalide dans src/config/oauth.ts'));
    return;
  }

  const listenHost = redirectUrl.hostname;
  const listenPort = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80));
  const callbackPath = redirectUrl.pathname || '/';

  let server: any;
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  try {
    const http = (window as any).require('http');
    server = http.createServer((req: any, res: any) => {
      try {
        const url = new URL(req.url, redirectUrl.origin);
        if (url.pathname !== callbackPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (code) {
          res.end(renderAuthHtml(deps.i18n.auth.successTitle('Google Health'), deps.i18n.auth.successCloseTab));
          resolveCode(code);
        } else {
          res.end(renderAuthHtml(deps.i18n.auth.errorTitle, error ?? deps.i18n.auth.deniedDefault));
          rejectCode(new Error(`Google OAuth denied: ${error ?? 'unknown'}`));
        }
      } catch (e) {
        res.end(deps.i18n.auth.internalError);
        rejectCode(e as Error);
      }
    });

    await new Promise<void>((res, rej) => server.listen(listenPort, listenHost, (err: any) => err ? rej(err) : res()));

    const scopes = [
      'https://www.googleapis.com/auth/fitness.activity.read',
      'https://www.googleapis.com/auth/fitness.body.read',
      'https://www.googleapis.com/auth/fitness.heart_rate.read',
      'https://www.googleapis.com/auth/fitness.sleep.read',
    ].join(' ');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(deps.clientId)}&redirect_uri=${encodeURIComponent(deps.redirectUri)}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(scopes)}`;

    const { shell } = (window as any).require('electron');
    await shell.openExternal(authUrl);
    new Notice(deps.i18n.notices.googleAuthorizeBrowser, 6000);

    const timeoutHandle = setTimeout(() => rejectCode(new Error('Timeout: pas de réponse Google après 5 minutes')), 5 * 60 * 1000);
    const code = await codePromise;
    clearTimeout(timeoutHandle);

    const tokens = await GoogleHealthProvider.exchangeCode(deps.clientId, deps.clientSecret, code, deps.redirectUri);
    await deps.onTokens(tokens);

    new Notice(deps.i18n.notices.googleConnected);
  } catch (e) {
    deps.logger.error('Google Health connect error:', e);
    new Notice(deps.i18n.notices.googleError((e as Error).message));
  } finally {
    if (server) server.close();
  }
}
