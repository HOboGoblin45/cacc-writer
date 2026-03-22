import { readFileSync } from 'fs';
import { request } from 'https';

import dotenv from 'dotenv';
dotenv.config();
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Set OPENAI_API_KEY in .env'); process.exit(1); }

const file = readFileSync('training_output/training_data.jsonl');
console.log(`Training file: ${file.length} bytes, ${file.toString().split('\n').filter(Boolean).length} examples`);

const boundary = 'BOUNDARY' + Date.now();
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="training_data.jsonl"\r\nContent-Type: application/jsonl\r\n\r\n`),
  file,
  Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nfine-tune\r\n--${boundary}--\r\n`)
]);

console.log('Uploading to OpenAI...');

const req = request({
  hostname: 'api.openai.com',
  path: '/v1/files',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.id) {
      console.log(`✓ File uploaded: ${result.id} (${result.bytes} bytes)`);
      console.log('\nStarting fine-tune job...');
      
      // Now create the fine-tune job
      const ftBody = JSON.stringify({
        training_file: result.id,
        model: 'gpt-4.1-mini-2025-04-14',
        suffix: 'cacc-appraiser',
        hyperparameters: { n_epochs: 3 }
      });
      
      const ftReq = request({
        hostname: 'api.openai.com',
        path: '/v1/fine_tuning/jobs',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(ftBody)
        }
      }, (ftRes) => {
        let ftData = '';
        ftRes.on('data', c => ftData += c);
        ftRes.on('end', () => {
          const ft = JSON.parse(ftData);
          if (ft.id) {
            console.log(`✓ Fine-tune job started: ${ft.id}`);
            console.log(`  Model: ${ft.model}`);
            console.log(`  Status: ${ft.status}`);
            console.log(`  Fine-tuned model will be: ft:${ft.model}:cacc-appraiser`);
            console.log('\nThis will take 20-40 minutes. Check status with:');
            console.log(`  node -e "fetch('https://api.openai.com/v1/fine_tuning/jobs/${ft.id}',{headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY}}).then(r=>r.json()).then(d=>console.log(d.status,d.fine_tuned_model))"`);
          } else {
            console.error('Fine-tune failed:', ftData);
          }
        });
      });
      ftReq.write(ftBody);
      ftReq.end();
    } else {
      console.error('Upload failed:', data);
    }
  });
});
req.write(body);
req.end();
