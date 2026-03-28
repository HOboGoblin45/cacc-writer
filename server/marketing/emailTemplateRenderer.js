/**
 * server/marketing/emailTemplateRenderer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * HTML email template renderer for Real Brain campaigns.
 *
 * Generates responsive, branded HTML emails with:
 *   - Real Brain color scheme (gold #ffd341, green #00A86B, dark #10141a)
 *   - Professional typography and layout
 *   - Inline CSS for email client compatibility
 *   - Dynamic content injection
 */

/**
 * Render an email template with data
 * @param {string} templateName - 'welcome', 'countdown', 'feature_highlight', etc.
 * @param {Object} data - Template variables {daysRemaining, featureName, cta, etc.}
 * @returns {Object} {subject, html, textFallback}
 */
export function renderEmail(templateName, data = {}) {
  const templates = {
    welcome: renderWelcome,
    countdown: renderCountdown,
    feature_highlight: renderFeatureHighlight,
    trial_ending: renderTrialEnding,
    win_back: renderWinBack,
    newsletter: renderNewsletter,
    countdown_intro: renderCountdownIntro,
    countdown_differences: renderCountdownDifferences,
    countdown_ratings: renderCountdownRatings,
    countdown_market: renderCountdownMarket,
    countdown_grid: renderCountdownGrid,
    countdown_ai_demo: renderCountdownAiDemo,
    countdown_checklist: renderCountdownChecklist,
    countdown_launch: renderCountdownLaunch,
    onboarding_welcome: renderOnboardingWelcome,
    onboarding_voice_step: renderOnboardingVoiceStep,
    onboarding_voice_ready: renderOnboardingVoiceReady,
    onboarding_features: renderOnboardingFeatures,
    onboarding_trial_ending: renderOnboardingTrialEnding,
    winback_reengagement: renderWinbackReengagement,
    winback_features: renderWinbackFeatures,
    winback_discount: renderWinbackDiscount,
  };

  const renderer = templates[templateName];
  if (!renderer) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  return renderer(data);
}

// ── Base email wrapper ─────────────────────────────────────────────────────────

function baseEmailWrapper(subject, content, cta = null) {
  const ctaHtml = cta ? `<table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding: 24px 0;"><a href="${cta.url}" style="background-color: #00A86B; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 16px;">${cta.text}</a></td></tr></table>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f5;
      color: #333;
      margin: 0;
      padding: 0;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background-color: white;
    }
    .header {
      background: linear-gradient(135deg, #ffd341 0%, #00A86B 100%);
      padding: 32px 24px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 14px;
      opacity: 0.95;
    }
    .body {
      padding: 32px 24px;
    }
    .body h2 {
      font-size: 20px;
      font-weight: 600;
      color: #10141a;
      margin: 0 0 16px 0;
    }
    .body p {
      font-size: 15px;
      line-height: 1.6;
      color: #555;
      margin: 0 0 16px 0;
    }
    .body ul {
      margin: 16px 0;
      padding-left: 20px;
    }
    .body li {
      font-size: 15px;
      line-height: 1.6;
      color: #555;
      margin-bottom: 8px;
    }
    .highlight {
      background-color: #fffaf0;
      border-left: 4px solid #ffd341;
      padding: 16px;
      margin: 16px 0;
      border-radius: 4px;
    }
    .highlight-title {
      font-weight: 600;
      color: #10141a;
      margin-bottom: 8px;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 24px;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
    .footer a {
      color: #00A86B;
      text-decoration: none;
    }
    .gold-accent {
      color: #ffd341;
    }
    .green-accent {
      color: #00A86B;
    }
  </style>
</head>
<body>
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="background-color: #f5f5f5; padding: 20px 0;">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
          <tr>
            <td class="header">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <h1>Real Brain</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="body">
              ${content}
            </td>
          </tr>
          ${ctaHtml}
          <tr>
            <td class="footer">
              <p style="margin: 0 0 8px 0;">Real Brain — AI-Powered Appraisal Software</p>
              <p style="margin: 0 0 8px 0;"><a href="https://realbrain.app">Visit Real Brain</a> | <a href="https://realbrain.app/unsubscribe">Unsubscribe</a></p>
              <p style="margin: 0;">© ${new Date().getFullYear()} Real Brain. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    html,
    textFallback: stripHtml(content),
  };
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// ── Countdown series ─────────────────────────────────────────────────────────

function renderCountdownIntro(data) {
  const content = `
    <h2>The Clock is Ticking</h2>
    <p>UAD 3.6 is coming, and the appraisal industry is about to change.</p>
    <div class="highlight">
      <div class="highlight-title">What's Changing?</div>
      <p style="margin: 0;">The new Uniform Appraisal Data Set (UAD 3.6) introduces major form changes:</p>
      <ul style="margin: 8px 0 0 0;">
        <li>New URAR form structure</li>
        <li>Condition &amp; Quality rating changes (C1-C6, Q1-Q6)</li>
        <li>Market Conditions narrative restructuring</li>
        <li>Sales Comparison Grid per-adjustment narratives</li>
      </ul>
    </div>
    <p><strong>Real Brain is ready.</strong> Our AI has been fine-tuned for UAD 3.6 and generates market-compliant narratives automatically.</p>
    <p>Join us for a week of deep dives into each section of the new form.</p>
  `;

  return baseEmailWrapper(
    'The Clock is Ticking: UAD 3.6 is Coming',
    content,
    {
      text: 'Learn More',
      url: 'https://realbrain.app/uad36',
    }
  );
}

function renderCountdownDifferences(data) {
  const content = `
    <h2>Form 1004 vs New URAR: What's Different?</h2>
    <p>Yesterday we announced UAD 3.6. Today, we break down exactly what's changing.</p>
    <div class="highlight">
      <div class="highlight-title">Key Changes at a Glance</div>
      <ul style="margin: 0; padding-left: 20px;">
        <li><strong>Form Structure:</strong> New layout with restructured sections</li>
        <li><strong>Market Analysis:</strong> Form 1004MC is gone — replaced with integrated analysis</li>
        <li><strong>Ratings Systems:</strong> C1-C6 (Condition) and Q1-Q6 (Quality)</li>
        <li><strong>Adjustment Grid:</strong> Each adjustment now requires narrative support</li>
      </ul>
    </div>
    <p>Our field-by-field comparison guide (sent tomorrow) will give you a complete roadmap.</p>
  `;

  return baseEmailWrapper(
    "What's Different: Form 1004 vs New URAR",
    content,
    {
      text: 'See the Full Comparison',
      url: 'https://realbrain.app/uad36/comparison',
    }
  );
}

function renderCountdownRatings(data) {
  const content = `
    <h2>Condition &amp; Quality Ratings Under UAD 3.6</h2>
    <p>One of the biggest changes in UAD 3.6 is the overhaul of property condition and quality ratings.</p>
    <div class="highlight">
      <div class="highlight-title">New Ratings Framework</div>
      <p style="margin: 0 0 8px 0;"><strong>Condition (C1-C6):</strong> Describes the physical state and needed repairs</p>
      <p style="margin: 0;"><strong>Quality (Q1-Q6):</strong> Describes the overall construction and material quality</p>
    </div>
    <p>These ratings directly impact property valuation. Real Brain's rating engine automatically analyzes property features and assigns accurate ratings with narrative support.</p>
  `;

  return baseEmailWrapper(
    'Condition &amp; Quality Ratings Under UAD 3.6 (C1-C6, Q1-Q6)',
    content,
    {
      text: 'Explore the Rating Framework',
      url: 'https://realbrain.app/uad36/ratings',
    }
  );
}

function renderCountdownMarket(data) {
  const content = `
    <h2>Market Conditions: The End of Form 1004MC</h2>
    <p>Form 1004MC is being retired. Market analysis is now integrated directly into the main appraisal form.</p>
    <div class="highlight">
      <div class="highlight-title">The New Approach</div>
      <p style="margin: 0;">Instead of a separate form, you'll now provide structured market analysis in:</p>
      <ul style="margin: 8px 0 0 0;">
        <li>Subject neighborhood analysis</li>
        <li>Supply/demand indicators</li>
        <li>Absorption rates and market trends</li>
        <li>Days-on-market analysis</li>
      </ul>
    </div>
    <p>Real Brain analyzes MLS data and market indicators to generate compliant market analysis narratives automatically.</p>
  `;

  return baseEmailWrapper(
    'Market Conditions: The End of Form 1004MC',
    content,
    {
      text: 'See Market Analysis in Action',
      url: 'https://realbrain.app/uad36/market',
    }
  );
}

function renderCountdownGrid(data) {
  const content = `
    <h2>Sales Comparison Grid: Per-Adjustment Narratives</h2>
    <p>Every single comparable adjustment now requires a narrative explanation. No more one-word justifications.</p>
    <div class="highlight">
      <div class="highlight-title">What Changed</div>
      <p style="margin: 0;">UAD 3.6 requires appraisers to:</p>
      <ul style="margin: 8px 0 0 0;">
        <li>Document each adjustment dollar amount</li>
        <li>Explain the reasoning behind each adjustment</li>
        <li>Reference market data supporting the adjustment</li>
        <li>Consider both positive and negative adjustments</li>
      </ul>
    </div>
    <p><strong>This is where Real Brain shines.</strong> Our AI generates evidence-based adjustment narratives from your comps and market data.</p>
  `;

  return baseEmailWrapper(
    'Sales Comparison Grid: Per-Adjustment Narratives',
    content,
    {
      text: 'Watch the Adjustment Demo',
      url: 'https://realbrain.app/uad36/adjustments',
    }
  );
}

function renderCountdownAiDemo(data) {
  const content = `
    <h2>How AI Handles the New URAR</h2>
    <p>We've trained Real Brain on thousands of UAD 3.6 examples. See it in action.</p>
    <div class="highlight">
      <div class="highlight-title">What You'll See</div>
      <p style="margin: 0;">Our 10-minute demo shows:</p>
      <ul style="margin: 8px 0 0 0;">
        <li>Automatic condition &amp; quality rating generation</li>
        <li>Market analysis narrative creation</li>
        <li>Per-adjustment narrative support</li>
        <li>Form field auto-population</li>
      </ul>
    </div>
    <p>Real Brain doesn't just generate text — it understands UAD 3.6's logic and structure.</p>
  `;

  return baseEmailWrapper(
    'How AI Handles the New URAR',
    content,
    {
      text: 'Watch the Demo (10 min)',
      url: 'https://realbrain.app/demo/uad36',
    }
  );
}

function renderCountdownChecklist(data) {
  const content = `
    <h2>Your UAD 3.6 Checklist</h2>
    <p>Before launch day, make sure you're ready.</p>
    <div class="highlight">
      <div class="highlight-title">Prep Checklist</div>
      <ul style="margin: 0; padding-left: 20px;">
        <li>☐ Review the new form structure</li>
        <li>☐ Understand C1-C6 and Q1-Q6 ratings</li>
        <li>☐ Practice market condition narratives</li>
        <li>☐ Review adjustment narrative requirements</li>
        <li>☐ Set up Real Brain access</li>
        <li>☐ Upload a test report for voice training</li>
      </ul>
    </div>
    <p>Tomorrow, we launch. You'll be ready.</p>
  `;

  return baseEmailWrapper(
    'Your UAD 3.6 Checklist',
    content,
    {
      text: 'Download the Full Checklist',
      url: 'https://realbrain.app/uad36/checklist',
    }
  );
}

function renderCountdownLaunch(data) {
  const content = `
    <h2>Launch Day is Here</h2>
    <p>UAD 3.6 is official. Real Brain is ready to help you generate compliant, market-competitive appraisals.</p>
    <div class="highlight">
      <div class="highlight-title">What Happens Now?</div>
      <p style="margin: 0;">Start your first UAD 3.6 appraisal right now:</p>
      <ol style="margin: 8px 0 0 0; padding-left: 20px;">
        <li>Upload the property details and comps</li>
        <li>Real Brain analyzes the market and property</li>
        <li>AI generates compliant UAD 3.6 narratives</li>
        <li>Export to your appraisal software</li>
      </ol>
    </div>
    <p><strong>Welcome to the future of appraisal.</strong></p>
  `;

  return baseEmailWrapper(
    'Launch Day is Here: Real Brain Meets the New URAR',
    content,
    {
      text: 'Start Your First UAD 3.6 Case',
      url: 'https://realbrain.app/app',
    }
  );
}

// ── Onboarding series ──────────────────────────────────────────────────────────

function renderOnboardingWelcome(data) {
  const content = `
    <h2>Welcome to Real Brain</h2>
    <p>You've just joined the appraisers who are using AI to generate market-competitive appraisals in hours instead of days.</p>
    <p><strong>Here's what happens next:</strong></p>
    <ol>
      <li><strong>Step 1:</strong> Upload a prior appraisal report (for voice training)</li>
      <li><strong>Step 2:</strong> Create your first case</li>
      <li><strong>Step 3:</strong> Let Real Brain generate your first draft</li>
    </ol>
    <p>Your trial gives you access to all features. No credit card. No strings.</p>
  `;

  return baseEmailWrapper(
    'Welcome to Real Brain',
    content,
    {
      text: 'Get Started',
      url: 'https://realbrain.app/app',
    }
  );
}

function renderOnboardingVoiceStep(data) {
  const content = `
    <h2>Upload Your Reports for Voice Training</h2>
    <p>Real Brain's secret sauce is your voice. By uploading 2-3 of your recent appraisal reports, our AI learns your writing style and tone.</p>
    <p>The result? Narratives that sound like you, backed by market data.</p>
    <p><strong>Where to upload:</strong> Settings → Voice Training</p>
  `;

  return baseEmailWrapper(
    'Upload Your Reports for Voice Training',
    content,
    {
      text: 'Upload Reports Now',
      url: 'https://realbrain.app/settings/voice',
    }
  );
}

function renderOnboardingVoiceReady(data) {
  const content = `
    <h2>Your AI Voice is Ready</h2>
    <p>We've analyzed your writing style. Your voice model is ready to go.</p>
    <p>Now, start your first appraisal case. Real Brain will generate narratives in your voice, backed by intelligent analysis.</p>
  `;

  return baseEmailWrapper(
    'Your AI Voice is Ready — Start Your First Case',
    content,
    {
      text: 'Create Your First Case',
      url: 'https://realbrain.app/app',
    }
  );
}

function renderOnboardingFeatures(data) {
  const content = `
    <h2>Advanced Features: QC Engine &amp; Comp Intelligence</h2>
    <p>You've been using Real Brain for a week. Here's what else you can do:</p>
    <ul>
      <li><strong>QC Engine:</strong> Automatic narrative quality checking and grading</li>
      <li><strong>Comp Intelligence:</strong> Auto-suggestion for comparable sales from MLS</li>
      <li><strong>Market Analysis:</strong> Automated market trends and absorption rates</li>
      <li><strong>Voice Cloning:</strong> Generate narratives that sound exactly like you</li>
    </ul>
  `;

  return baseEmailWrapper(
    'Advanced Features: QC Engine &amp; Comp Intelligence',
    content,
    {
      text: 'Explore Advanced Features',
      url: 'https://realbrain.app/features',
    }
  );
}

function renderOnboardingTrialEnding(data) {
  const content = `
    <h2>Your Trial Ends Soon</h2>
    <p>Your 14-day trial expires in 2 days. If you're ready to continue, upgrade to a paid plan and keep building with Real Brain.</p>
    <p><strong>Current trial usage:</strong></p>
    <ul>
      <li>Appraisals generated: 5</li>
      <li>Hours saved: ~15</li>
      <li>Narratives refined: 12</li>
    </ul>
    <p>Ready to go pro?</p>
  `;

  return baseEmailWrapper(
    'Your Trial Ends Soon — Upgrade to Paid',
    content,
    {
      text: 'Choose Your Plan',
      url: 'https://realbrain.app/pricing',
    }
  );
}

// ── Win-back series ────────────────────────────────────────────────────────────

function renderWinbackReengagement(data) {
  const content = `
    <h2>We Miss You</h2>
    <p>You haven't used Real Brain in a while. We'd love to have you back.</p>
    <p>The appraisal world has changed. UAD 3.6 is live. And Real Brain is better than ever.</p>
    <p><strong>What if we made it even easier?</strong></p>
  `;

  return baseEmailWrapper(
    'We Miss You — Come Back to Real Brain',
    content,
    {
      text: 'Log In to Real Brain',
      url: 'https://realbrain.app/login',
    }
  );
}

function renderWinbackFeatures(data) {
  const content = `
    <h2>What's New in Real Brain</h2>
    <p>Since you last logged in, we've shipped:</p>
    <ul>
      <li><strong>UAD 3.6 Support:</strong> Full native support for the new form structure</li>
      <li><strong>Enhanced QC Engine:</strong> Faster, smarter quality checking</li>
      <li><strong>Mobile App:</strong> Access your cases anywhere</li>
      <li><strong>Real-time Collaboration:</strong> Work with team members on the same case</li>
    </ul>
  `;

  return baseEmailWrapper(
    "What's New in Real Brain",
    content,
    {
      text: 'See What\'s New',
      url: 'https://realbrain.app/whatsnew',
    }
  );
}

function renderWinbackDiscount(data) {
  const content = `
    <h2>Come Back for 30% Off</h2>
    <p>We want you back. Use code <strong style="color: #ffd341; font-size: 18px;">COMEBACK30</strong> for 30% off your first month.</p>
    <p>No expiration. No catches. Just a special offer for our returning appraisers.</p>
  `;

  return baseEmailWrapper(
    'Special Offer: Come Back for 30% Off',
    content,
    {
      text: 'Claim Your Discount',
      url: 'https://realbrain.app/pricing?code=COMEBACK30',
    }
  );
}

// ── Standalone templates ───────────────────────────────────────────────────────

function renderWelcome(data) {
  return renderOnboardingWelcome(data);
}

function renderCountdown(data) {
  const daysRemaining = data.daysRemaining || 7;
  const content = `
    <h2>Only ${daysRemaining} Days Left</h2>
    <p>Real Brain is launching in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Are you ready?</p>
  `;
  return baseEmailWrapper(`Only ${daysRemaining} Days Left`, content);
}

function renderFeatureHighlight(data) {
  const featureName = data.featureName || 'Feature';
  const description = data.description || 'Check out this powerful new capability.';
  const content = `
    <h2>${featureName}</h2>
    <p>${description}</p>
  `;
  return baseEmailWrapper(featureName, content);
}

function renderTrialEnding(data) {
  return renderOnboardingTrialEnding(data);
}

function renderWinBack(data) {
  return renderWinbackReengagement(data);
}

function renderNewsletter(data) {
  const content = `
    <h2>This Week in Appraisal</h2>
    <p>What's new in the world of appraisal and real estate valuation.</p>
  `;
  return baseEmailWrapper('This Week in Appraisal', content);
}

export default {
  renderEmail,
};
