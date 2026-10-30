const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGunzip } = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const projectRoot = path.resolve(__dirname, '../../..');
const bundleRoot = path.join(projectRoot, 'deployment/current');
const hashFile = async (filename) => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
};
const resolveBundleFile = (filename) => {
  const resolved = path.resolve(bundleRoot, filename);
  const relative = path.relative(bundleRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Deployment path escapes the bundle');
  return resolved;
};

async function prepareDeployment() {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'manifest.json'), 'utf8'));
  const database = resolveBundleFile(manifest.database.file);
  const archive = resolveBundleFile(manifest.database.archive);
  const artifactRoot = resolveBundleFile(manifest.artifactRoot);
  if (!fs.statSync(artifactRoot).isDirectory()) throw new Error('Deployment figures are missing');
  if (!fs.existsSync(database) || await hashFile(database) !== manifest.database.sha256) {
    const temporary = `${database}.tmp-${process.pid}`;
    const hash = crypto.createHash('sha256');
    try {
      await pipeline(fs.createReadStream(archive), createGunzip(), new Transform({
        transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); },
      }), fs.createWriteStream(temporary, { flags: 'wx' }));
      if (hash.digest('hex') !== manifest.database.sha256) throw new Error('Deployment database checksum mismatch');
      fs.renameSync(temporary, database);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  }
  return { manifest, database, artifactRoot };
}
module.exports = { prepareDeployment };
if (require.main === module) prepareDeployment()
  .then(({ manifest }) => console.log(`Verified current database: ${manifest.sourceRun} (${manifest.database.sha256})`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
