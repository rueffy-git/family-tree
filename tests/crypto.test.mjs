import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encrypt,decrypt,normalisePassphrase} from '../docs/crypto.js';

const phrase='synthetic testing words never use these';
const record={version:1,people:[{id:'test-person',name:'Synthetic person',note:'<img src=x onerror=alert(1)>'}]};
test('correct phrase recovers every byte and wrong phrase does not unlock',async()=>{
  const envelope=await encrypt(record,phrase);
  assert.deepEqual(await decrypt(envelope,phrase),record);
  assert.equal(JSON.stringify(envelope).includes('Synthetic'),false);
  await assert.rejects(decrypt(envelope,'incorrect synthetic phrase used for this test'));
});
test('tampered data is rejected and every publication uses fresh randomness',async()=>{
  const a=await encrypt(record,phrase),b=await encrypt(record,phrase);
  assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
  const damaged={...a,ciphertext:(a.ciphertext[0]==='A'?'B':'A')+a.ciphertext.slice(1)};
  await assert.rejects(decrypt(damaged,phrase));
  await assert.rejects(decrypt({...a,iterations:1},phrase));
  await assert.rejects(decrypt({...a,iv:'AA=='},phrase));
});
test('copy and paste spacing is normalised without weakening case sensitivity',()=>{
  assert.equal(normalisePassphrase('  words\n with   spaces  '),'words with spaces');
  assert.notEqual(normalisePassphrase('Words'),normalisePassphrase('words'));
});
