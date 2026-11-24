const ITERATIONS = 600000;
const encoder = new TextEncoder();

export function normalisePassphrase(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encrypted data.');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

export function encode64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}

async function keyFor(passphrase, salt, usage) {
  const bytes = encoder.encode(normalisePassphrase(passphrase));
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:ITERATIONS},
      material, {name:'AES-GCM', length:256}, false, usage);
  } finally { bytes.fill(0); }
}

export async function encrypt(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ['encrypt']);
  const bytes = encoder.encode(JSON.stringify(data));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128}, key, bytes));
    return {version:1, algorithm:'AES-256-GCM', kdf:'PBKDF2-SHA256', iterations:ITERATIONS,
      salt:encode64(salt), iv:encode64(iv), ciphertext:encode64(ciphertext)};
  } finally { bytes.fill(0); }
}

export async function decrypt(envelope, passphrase) {
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256'
      || envelope.iterations !== ITERATIONS) throw new Error('Unsupported encrypted data.');
  const salt = decode64(envelope.salt), iv = decode64(envelope.iv), ciphertext = decode64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > 10000000)
    throw new Error('Invalid encrypted data.');
  const key = await keyFor(passphrase, salt, ['decrypt']);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv, tagLength:128}, key, ciphertext));
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  finally { bytes.fill(0); }
}
