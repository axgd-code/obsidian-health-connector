# Health Connector for Obsidian

Turn your daily notes into a reliable health dashboard.

Health Connector imports your data from Garmin, Strava, and Google Health, then automatically writes it into the frontmatter of your Obsidian notes. You keep a clean, queryable history that works with Dataview, Templates, and your personal workflows.

## Why this plugin

- Centralize your activity data in one place: your vault
- Standardize frontmatter fields for consistent long-term tracking
- Remove repetitive manual health data entry

## What you get

- Multi-provider sync: Garmin, Strava, Google Health
- Unified frontmatter structure for daily notes
- Quick sync commands (today or a target date)
- Localized interface: French, English, Spanish

## Example workflow

Open your daily note, run a sync command, and your latest data appears in frontmatter. You can then build weekly or monthly trends with Dataview without manual cleanup.

Example fields (depending on provider):

```yaml
steps: 10234
distance_km: 7.4
calories: 2180
resting_hr: 54
sleep_hours: 7.2
```

## Manual installation

1. Build the plugin

```bash
npm install
npm run build
```

2. Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/health-connector/
```

3. Enable the plugin in Obsidian settings

## Configuration

Configure your credentials in the plugin settings UI:

- Garmin: username + password
- Strava: Client ID + Client Secret
- Google Health: Client ID + Client Secret

The Google OAuth redirect URI is defined in `src/config/oauth.ts`:

```ts
redirectUri: "http://127.0.0.1:53682/google/oauth/callback"
```

This value must exactly match an authorized redirect URI in Google Cloud.

## FAQ

### Do the data leave my vault?
No. Synced data are written to your local Obsidian notes.

### Can I use only one provider?
Yes. You can configure only Garmin, only Strava, only Google Health, or any combination.

### Is the plugin mobile-compatible?
Yes. The manifest declares the plugin as not desktop-only.

## Support the project

If this plugin helps you every day, you can support its development:

- https://paypal.me/axgdcode

## Development

```bash
npm run build
npm test
```

Optional shortcut for local deployment:

```bash
OBSIDIAN_PLUGIN_DIR="/absolute/path/to/vault/.obsidian/plugins/health-connector" npm run deploy:obsidian
```


## Security

- Never commit real secrets or a `.env` file that contains credentials.
- Use `.env.example` only as a local template.
- API credentials are stored locally in Obsidian plugin data.