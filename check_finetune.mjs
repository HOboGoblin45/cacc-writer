import dotenv from 'dotenv';
dotenv.config();
const r = await fetch('https://api.openai.com/v1/fine_tuning/jobs/ftjob-EABXTQvjZC7C2i0mf05GvbWb', {
  headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY }
});
const d = await r.json();
console.log('Status:', d.status);
console.log('Model:', d.fine_tuned_model || 'not ready yet');
console.log('Trained tokens:', d.trained_tokens || 0);
if (d.error) console.log('Error:', JSON.stringify(d.error));
