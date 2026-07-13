const crypto = require('crypto');

// Generate keys directly in DER format
const keysDer = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'der'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'der'
  }
});

const publicKeyDer = keysDer.publicKey;

// SHA256 of the DER representation
const sha256 = crypto.createHash('sha256').update(publicKeyDer).digest('hex');

// Map hex characters to chrome's custom alphabet (0-f -> a-p)
const chromeAlphabet = 'abcdefghijklmnop';
const extensionId = sha256
  .slice(0, 32)
  .split('')
  .map(char => chromeAlphabet[parseInt(char, 16)])
  .join('');

// Convert DER to Base64 for manifest.json
const keyInManifest = publicKeyDer.toString('base64');

console.log(JSON.stringify({
  extensionId,
  redirectUrl: `https://${extensionId}.chromiumapp.org/`,
  manifestKey: keyInManifest
}, null, 2));
