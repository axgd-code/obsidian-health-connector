const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'manifest.json');
const versionsJsonPath = path.join(rootDir, 'versions.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const packageJson = readJson(packageJsonPath);
const manifestJson = readJson(manifestJsonPath);
const versionsJson = readJson(versionsJsonPath);

const version = packageJson.version;
const minAppVersion = manifestJson.minAppVersion;

manifestJson.version = version;

const nextVersionsJson = {
  [version]: versionsJson[version] ?? minAppVersion,
};

writeJson(manifestJsonPath, manifestJson);
writeJson(versionsJsonPath, nextVersionsJson);
