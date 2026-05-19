# Garmin Connector for Obsidian

Garmin Connector is a plugin for Obsidian that allows you to import and synchronize your Garmin health data directly into your Obsidian vault. This plugin is designed to help you track your health metrics, visualize your progress, and integrate your fitness data with your notes and workflows.

## Features

- Import daily health data (steps, distance, etc.) from Garmin
- Synchronize data automatically or manually
- Multi-provider support (Garmin, Strava, etc.)
- Customizable templates for data display

## Installation

1. Download the latest release from the [GitHub repository](https://github.com/axgd-code/obsidian-health-connector/releases).
2. Copy the plugin folder into your Obsidian vault's `.obsidian/plugins/` directory.
3. Restart Obsidian and enable the plugin in the settings panel.

## Configuration

1. Create a `.env` file in the root of the plugin folder with your API credentials:

   ```env
   GARMIN_CLIENT_ID=your_client_id
   GARMIN_CLIENT_SECRET=your_client_secret
   # Add other provider credentials as needed
   ```

2. Edit the `manifest.json` and `config/template.ts` files if you need to customize plugin behavior or templates.

## Usage

- Use the command palette to trigger data synchronization (`Sync Garmin Data`).
- View your imported health data in daily or weekly notes.
- Customize templates in `src/config/template.ts` to change how data is displayed.

## Development

### Requirements
- Node.js (v18 or higher recommended)
- npm

### Build & Test

```bash
npm install
npm run build
npm test
```

### File Structure

- `src/` — Main plugin source code
- `scripts/` — Utility scripts for debugging and integration
- `tests/` — Unit and integration tests
- `styles.css` — Plugin styles
- `manifest.json` — Obsidian plugin manifest

## Providers

- **Garmin**: Main provider for health data
- **Strava**: Optional integration


## Localization

The plugin supports English, French, and Spanish. You can add more languages by editing the files in `src/i18n/`.

## Security

- Credentials are stored locally in the `.env` file and are not shared.
- OAuth and SSO flows are handled securely.

## Contributing

Contributions are welcome! Please open issues or pull requests on the [GitHub repository](https://github.com/your-repo/garmin-connector).

## License

This project is licensed under the MIT License.
