/**
 * server/integrations/emailTemplates.js
 * ----------------------------------------
 * Pre-built email templates for Charles's appraisal workflow.
 *
 * Usage:
 *   import { TEMPLATES, renderTemplate } from './emailTemplates.js';
 *   const { to, subject, body } = renderTemplate('inspectionRequest', ['John', '123 Main St', '555-1234']);
 */

export const TEMPLATES = {
  /**
   * Request to schedule property inspection.
   * params: [borrowerOrOwner, address, phone (optional)]
   */
  inspectionRequest: (borrower, address, phone) => ({
    subject: `Appraisal Inspection Request - ${address}`,
    body: [
      'Hello,',
      '',
      `I am a certified real estate appraiser and have been engaged to appraise the property at ${address}.`,
      '',
      'I would like to schedule an inspection at your earliest convenience. Please contact me at your convenience to arrange a time.',
      '',
      'Thank you,',
      'Charles P. Cresci',
      'Cresci Appraisal & Consulting Company',
      '(309) 826-5285',
    ].join('\n'),
  }),

  /**
   * Deliver completed appraisal report to client.
   * params: [clientName, address, value]
   */
  reportDelivery: (clientName, address, value) => ({
    subject: `Appraisal Report - ${address}`,
    body: [
      `Dear ${clientName},`,
      '',
      `Please find attached the completed appraisal report for the property located at ${address}.`,
      '',
      `The opinion of market value is ${value}.`,
      '',
      'Please let me know if you have any questions.',
      '',
      'Respectfully submitted,',
      'Charles P. Cresci',
      'Certified Residential Real Estate Appraiser',
      'Cresci Appraisal & Consulting Company',
    ].join('\n'),
  }),

  /**
   * MRED RESO Web API access request email.
   * Send to retssupport@mredllc.com to request API credentials.
   * params: none
   */
  mredApiRequest: () => ({
    to: 'retssupport@mredllc.com',
    subject: 'RESO Web API Access Request \u2014 Licensed Appraiser',
    body: [
      'Hi MRED Support Team,',
      '',
      'I am a licensed certified residential real estate appraiser in Illinois (License #556.005314) and I am requesting RESO Web API access for appraisal purposes \u2014 specifically to query comparable sales data for use in appraisal reports.',
      '',
      'My redirect URI is: http://localhost:5178/api/mred/callback',
      '',
      'Please send my Client ID and Client Secret when ready.',
      '',
      'Thank you,',
      'Charles P. Cresci',
      'Cresci Appraisal & Consulting Company',
      '811 S Fell Ave, Normal, IL 61761',
    ].join('\n'),
  }),

  /**
   * Follow-up on an outstanding appraisal order.
   * params: [clientName, address, orderDate]
   */
  orderFollowUp: (clientName, address, orderDate) => ({
    subject: `Follow-Up: Appraisal Order - ${address}`,
    body: [
      `Dear ${clientName},`,
      '',
      `I am following up on the appraisal order received on ${orderDate} for the property at ${address}.`,
      '',
      'I wanted to confirm receipt and provide a status update. Please let me know if you have any questions or need additional information.',
      '',
      'Best regards,',
      'Charles P. Cresci',
      'Certified Residential Real Estate Appraiser',
      'Cresci Appraisal & Consulting Company',
      '(309) 826-5285',
    ].join('\n'),
  }),

  /**
   * Request additional information or documents from client.
   * params: [clientName, address, itemsNeeded]
   */
  infoRequest: (clientName, address, itemsNeeded) => ({
    subject: `Additional Information Needed - ${address}`,
    body: [
      `Dear ${clientName},`,
      '',
      `Regarding the appraisal assignment for ${address}, I need the following additional information to complete the report:`,
      '',
      itemsNeeded,
      '',
      'Please provide this information at your earliest convenience.',
      '',
      'Thank you,',
      'Charles P. Cresci',
      'Cresci Appraisal & Consulting Company',
      '(309) 826-5285',
    ].join('\n'),
  }),
};

/**
 * Render a named template with positional params.
 * @param {string} templateName - Key in TEMPLATES
 * @param {Array}  params       - Positional arguments for the template function
 * @returns {{ to?: string, subject: string, body: string }}
 */
export function renderTemplate(templateName, params = []) {
  const fn = TEMPLATES[templateName];
  if (!fn) throw new Error(`Unknown email template: ${templateName}`);
  return fn(...params);
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
