import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { validateBody } from '../middleware/validateRequest.js';
import { parseMismoXml } from '../training/aciExtractor.js';

const router = express.Router();

// ── Validation Schemas ───────────────────────────────────────────────────────
const answerSchema = z.object({
  questionId: z.string().min(1),
  questionType: z.string().optional(),
  questionPrompt: z.string().min(1),
  answer: z.string().min(20),
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANSWERS_PATH = path.join(__dirname, '../../training_output/expert_reasoning_data.jsonl');
const XML_DIR = path.join(__dirname, '../../training_output/xml_exports');

// Pre-generate questions from XML data
let questionBank = [];

function initQuestions() {
  try {
    const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml')).slice(0, 50);
    for (const file of files) {
      try {
        const data = parseMismoXml(path.join(XML_DIR, file));
        if (!data.subject?.address) continue;
        const addr = `${data.subject.address}, ${data.subject.city || ''}, ${data.subject.state || ''}`;

        // Comp selection question
        questionBank.push({
          id: `comp_${file}`,
          type: 'comp_selection',
          title: 'Comp Selection Reasoning',
          prompt: `For the property at ${addr} (${data.subject.gla || '?'} SF, built ${data.subject.yearBuilt || '?'}, valued at $${(data.subject.appraisedValue || 0).toLocaleString()}), explain your process for selecting comparable sales. What factors matter most when choosing comps in this area? What would make you reject a potential comp?`,
          context: { address: addr, gla: data.subject.gla, yearBuilt: data.subject.yearBuilt, value: data.subject.appraisedValue }
        });

        // Adjustment reasoning
        questionBank.push({
          id: `adj_${file}`,
          type: 'adjustment_reasoning',
          title: 'Adjustment Reasoning',
          prompt: `For a property at ${addr}, how do you determine adjustment amounts? For example, what is your typical $/SF adjustment for GLA differences? How do you adjust for age/condition differences? Do you use paired sales analysis, market extraction, or rules of thumb?`,
          context: { address: addr }
        });

        // Condition rating
        questionBank.push({
          id: `cond_${file}`,
          type: 'condition_quality',
          title: 'Condition & Quality Rating',
          prompt: `The property at ${addr} was built in ${data.subject.yearBuilt || '?'}. How do you decide between condition ratings (C1-C6)? What specific factors make you choose C3 vs C4? What about quality ratings (Q1-Q6)?`,
          context: { address: addr, yearBuilt: data.subject.yearBuilt }
        });

        // Reconciliation
        if (data.subject.appraisedValue) {
          questionBank.push({
            id: `recon_${file}`,
            type: 'reconciliation',
            title: 'Value Reconciliation',
            prompt: `For ${addr}, your final value opinion was $${data.subject.appraisedValue.toLocaleString()}. Walk me through your reconciliation process. When your adjusted comp values give you a range, how do you decide the final number? Which comp do you weight most heavily and why?`,
            context: { address: addr, value: data.subject.appraisedValue }
          });
        }
      } catch {}
    }

    // Add general knowledge questions
    const generalQuestions = [
      { type: 'general', title: 'GLA Adjustment Rules', prompt: 'What is your typical $/SF adjustment for GLA differences in the Bloomington-Normal area? Does it vary by price range or neighborhood? How do you support this adjustment?' },
      { type: 'general', title: 'Time Adjustments', prompt: 'When do you apply a time/market conditions adjustment vs not? What data sources do you use to determine the rate? What is the current market trend in your area?' },
      { type: 'general', title: 'Maximum Adjustments', prompt: 'What is the maximum net and gross adjustment percentage you are comfortable with before looking for a different comp? How do you handle situations where all available comps require large adjustments?' },
      { type: 'general', title: 'Garage Adjustments', prompt: 'How do you adjust for garage differences (no garage vs 1-car vs 2-car vs 3-car)? What dollar amounts do you typically use? Does it vary by price range?' },
      { type: 'general', title: 'Basement Adjustments', prompt: 'How do you adjust for basement differences (no basement, unfinished, partially finished, fully finished)? How do you value finished basement square footage compared to above-grade GLA?' },
      { type: 'general', title: 'Age/Condition Interplay', prompt: 'How do age and condition interact in your analysis? Can a well-maintained 1950s home be rated the same condition as a poorly maintained 2000s home? How do you separate age adjustments from condition adjustments?' },
      { type: 'general', title: 'Highest and Best Use', prompt: 'Walk me through your highest and best use analysis for a typical residential property. When would you conclude HBU is something other than the existing use? What factors could change your conclusion?' },
      { type: 'general', title: 'Market Conditions', prompt: 'How do you characterize the current market in Bloomington-Normal? What data points do you look at? How has it changed over the past year?' },
      { type: 'general', title: 'Comp Search Radius', prompt: 'What is your typical search radius for comps? When do you expand it? How far back in time will you go for sales? What makes you use an older sale vs a more distant but recent one?' },
      { type: 'general', title: 'Lot Size Adjustments', prompt: 'How do you adjust for lot size differences? Is there a $/SF for land? At what point does a larger lot stop adding value linearly? How do you handle irregular lots or lots backing to busy roads?' },
    ];
    generalQuestions.forEach((q, i) => {
      questionBank.push({ id: `gen_${i}`, ...q });
    });

  } catch(e) { console.warn('Question init error:', e.message); }
}

initQuestions();

// GET next unanswered question
router.get('/questionnaire/next', (req, res) => {
  let answeredIds = new Set();
  try {
    if (fs.existsSync(ANSWERS_PATH)) {
      const lines = fs.readFileSync(ANSWERS_PATH, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { answeredIds.add(JSON.parse(line).questionId); } catch {}
      }
    }
  } catch {}

  const unanswered = questionBank.filter(q => !answeredIds.has(q.id));
  if (unanswered.length === 0) {
    return res.json({ ok: true, done: true, message: 'All questions answered!', total: questionBank.length });
  }

  const question = unanswered[Math.floor(Math.random() * unanswered.length)];
  res.json({ ok: true, question, progress: { answered: answeredIds.size, total: questionBank.length, remaining: unanswered.length } });
});

// POST answer
router.post('/questionnaire/answer', validateBody(answerSchema), (req, res) => {
  const { questionId, questionType, questionPrompt, answer } = req.validated;

  const example = {
    type: questionType || 'expert_reasoning',
    questionId,
    messages: [
      { role: 'system', content: 'You are Charles Cresci, an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC). You write USPAP-compliant appraisal reports in a professional, concise, data-driven style.' },
      { role: 'user', content: questionPrompt },
      { role: 'assistant', content: answer }
    ],
    answeredAt: new Date().toISOString()
  };

  fs.appendFileSync(ANSWERS_PATH, JSON.stringify(example) + '\n');
  res.json({ ok: true, saved: true });
});

// GET progress
router.get('/questionnaire/progress', (req, res) => {
  let answered = 0;
  try {
    if (fs.existsSync(ANSWERS_PATH)) {
      answered = fs.readFileSync(ANSWERS_PATH, 'utf-8').split('\n').filter(Boolean).length;
    }
  } catch {}
  res.json({ ok: true, answered, total: questionBank.length, remaining: questionBank.length - answered });
});

export default router;
