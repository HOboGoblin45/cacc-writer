/**
 * server/intake/orderParser.js
 * -----------------------------
 * Extracts structured order data from assignment sheet / order form PDF text.
 *
 * Handles two form layouts:
 *   1. "Appraisal Assignment Sheet" (First State Mortgage / MSI Loans style)
 *   2. "Residential Appraisal Request Form" (generic)
 */

/**
 * parseOrderText(text)
 * Parse raw extracted PDF text into a structured order object.
 *
 * @param {string} text
 * @returns {Object} extracted fields
 */
export function parseOrderText(text) {
  if (!text || typeof text !== 'string') return {};

  // Normalize whitespace / line breaks
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const fullText = lines.join('\n');

  const extracted = {};

  // ── Order ID ──────────────────────────────────────────────────────────────
  const orderIdMatch = fullText.match(/Order\s*ID\s*#?\s*:?\s*(\d{4,10})/i);
  if (orderIdMatch) extracted.orderID = orderIdMatch[1];

  // ── Delivery / Effective Date ─────────────────────────────────────────────
  const deliveryMatch = fullText.match(
    /(?:Expected\s*)?Delivery\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  if (deliveryMatch) extracted.deliveryDate = deliveryMatch[1].trim();

  // ── Property Address ──────────────────────────────────────────────────────
  // Try "Street Number: X  Street Name: Y  City: Z  State: S  Zipcode: N" pattern
  const streetNumMatch = fullText.match(/Street\s*Number\s*:?\s*(\d+\S*)/i);
  const streetNameMatch = fullText.match(/Street\s*Name\s*:?\s*([^\n\r]+?)(?:\s{2,}|Unit|City|$)/i);
  const unitMatch = fullText.match(/Unit\s*#\s*:?\s*([^\s\n\r]+)/i);
  const cityMatch = fullText.match(/City\s*:?\s*([A-Za-z\s]+?)(?:\s{2,}|County|Zip|State|$)/i);
  const countyMatch = fullText.match(/County\s*:?\s*([A-Za-z\s]+?)(?:\s{2,}|Zip|State|$)/i);
  const zipMatch = fullText.match(/Zip(?:code)?\s*:?\s*(\d{5}(?:-\d{4})?)/i);
  const stateMatch = fullText.match(/State\s*:?\s*([A-Z]{2})/i);

  if (streetNumMatch) extracted.streetNumber = streetNumMatch[1].trim();
  if (streetNameMatch) extracted.streetName = streetNameMatch[1].trim();
  if (unitMatch && unitMatch[1] && unitMatch[1] !== 'City') extracted.unit = unitMatch[1].trim();
  if (cityMatch) extracted.city = cityMatch[1].trim().replace(/\s+$/, '');
  if (countyMatch) extracted.county = countyMatch[1].trim().replace(/\s+$/, '');
  if (zipMatch) extracted.zip = zipMatch[1];
  if (stateMatch) extracted.state = stateMatch[1];

  // Build full address
  if (extracted.streetNumber && extracted.streetName) {
    let addr = `${extracted.streetNumber} ${extracted.streetName}`;
    if (extracted.unit) addr += ` Unit ${extracted.unit}`;
    if (extracted.city) addr += `, ${extracted.city}`;
    if (extracted.state) addr += `, ${extracted.state}`;
    if (extracted.zip) addr += ` ${extracted.zip}`;
    extracted.address = addr;
  } else {
    // Fallback: look for "Property: <address>" pattern
    const propMatch = fullText.match(/Property\s*:?\s*([^,\n]+(?:,\s*[^,\n]+){1,3})/i);
    if (propMatch) extracted.address = propMatch[1].trim();
  }

  // ── Borrowers ─────────────────────────────────────────────────────────────
  const borrower1Match = fullText.match(/Borrower\s*1\s*:?\s*([^\n\r/]+?)(?:\s*\/\s*Borrower\s*2|\s{2,}|$)/i);
  const borrower2Match = fullText.match(/Borrower\s*2\s*:?\s*([^\n\r]+?)(?:\s{2,}|Email|$)/i);
  if (borrower1Match) extracted.borrower1 = borrower1Match[1].trim();
  if (borrower2Match && borrower2Match[1].trim()) extracted.borrower2 = borrower2Match[1].trim();

  // Combined borrower name
  if (extracted.borrower1) {
    extracted.borrowerName = extracted.borrower2
      ? `${extracted.borrower1} / ${extracted.borrower2}`
      : extracted.borrower1;
  }

  // ── Contact ───────────────────────────────────────────────────────────────
  const contactMatch = fullText.match(/(?:Home\s*#|Contact\s*#1|Contact)\s*:?\s*(\d[\d\-\.\(\)\s]{7,15})/i);
  if (contactMatch) extracted.contactPhone = contactMatch[1].replace(/\s+/g, '').trim();

  const altContactMatch = fullText.match(/Alt\s*Contact\s*:?\s*([^\n\r]+?)(?:\s{2,}|Contact|$)/i);
  if (altContactMatch) extracted.contactName = altContactMatch[1].trim();

  // ── Lender ────────────────────────────────────────────────────────────────
  // Strategy 1: "Company Information" header followed by lender name (MSI/assignment sheet format)
  const companyInfoMatch = fullText.match(
    /Company\s+Information\s*\n?\s*([\w\s&.,]+(?:Mortgage|Bank|Loan|Credit|Financial|Savings|Federal|Credit Union|Trust)[^\n\r]*)/i
  );
  if (companyInfoMatch) {
    extracted.lenderName = companyInfoMatch[1].split(/\n/)[0].trim();
  }

  // Strategy 2: "Lender/Client Details" section
  if (!extracted.lenderName) {
    const lenderSectionMatch = fullText.match(
      /(?:Lender(?:\/Client)?(?:\s+Details)?)\s*\n?\s*([\w\s&.,]+(?:Mortgage|Bank|Loan|Credit|Financial|Savings|Federal|Credit Union|Trust)[^\n\r]*)/i
    );
    if (lenderSectionMatch) {
      extracted.lenderName = lenderSectionMatch[1].split(/\n/)[0].trim();
    }
  }

  // Strategy 3: Known lender names appearing in the document
  if (!extracted.lenderName) {
    const knownLenderMatch = fullText.match(
      /([\w\s&.]+(?:Mortgage|Bank|Savings|Financial|Lending|Credit Union|Home Loans)[^\n\r,]*)/i
    );
    if (knownLenderMatch) {
      extracted.lenderName = knownLenderMatch[1].trim();
    }
  }

  // Strategy 4: "Lender: Name, Address" single-line format
  if (!extracted.lenderName) {
    const lenderLineMatch = fullText.match(/Lender\s*:?\s*([^,\n]+),\s*([^,\n]+(?:,\s*[^,\n]+)?)/i);
    if (lenderLineMatch) {
      extracted.lenderName = lenderLineMatch[1].trim();
      extracted.lenderAddress = lenderLineMatch[2].trim();
    }
  }

  // Lender address (look for street address near lender name)
  if (!extracted.lenderAddress) {
    const lenderAddrMatch = fullText.match(
      /(?:First State Mortgage|Mortgage|Bank|Lender)[^\n\r]*\n?\s*(\d+\s+[^\n\r]+(?:Rd|St|Ave|Blvd|Dr|Ln|Way|Ct|Pl)[^\n\r]*)/i
    );
    if (lenderAddrMatch) {
      extracted.lenderAddress = lenderAddrMatch[1].trim();
    }
  }

  // ── Loan / Transaction Type ───────────────────────────────────────────────
  const loanTypeMatch = fullText.match(/Loan\s*Type\s*:?\s*([^\n\r/]+?)(?:\s*\/|\s{2,}|$)/i);
  if (loanTypeMatch) extracted.loanType = loanTypeMatch[1].trim();

  const transactionMatch = fullText.match(/Transaction\s*(?:Type(?:\/Use)?)?\s*:?\s*([^\n\r/]+?)(?:\s*\/|\s{2,}|$)/i);
  if (transactionMatch) extracted.transactionType = transactionMatch[1].trim();

  // ── Form Type ─────────────────────────────────────────────────────────────
  const formMatch = fullText.match(
    /(\d{3,4}[A-Z]?\s*[-–]\s*[^\n\r$]+?)(?:\s*\$|\s{3,}|$)/i
  );
  if (formMatch) extracted.formType = formMatch[1].trim();

  // Normalize to just form number for system use
  if (extracted.formType) {
    const formNumMatch = extracted.formType.match(/^(\d{3,4}[A-Z]?)/);
    if (formNumMatch) extracted.formTypeCode = formNumMatch[1];
  }

  // ── Fee ───────────────────────────────────────────────────────────────────
  const feeMatch = fullText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (feeMatch) extracted.fee = feeMatch[1].replace(/,/g, '');

  // ── Lat/Long ──────────────────────────────────────────────────────────────
  const latLongMatch = fullText.match(
    /Lat(?:itude)?\/Long(?:itude)?\s*:?\s*([-+]?\d+\.?\d*)\s*\/?\s*([-+]?\d+\.?\d*)/i
  );
  if (latLongMatch) {
    extracted.lat = parseFloat(latLongMatch[1]);
    extracted.lng = parseFloat(latLongMatch[2]);
    extracted.latLong = `${latLongMatch[1]}/${latLongMatch[2]}`;
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  const emailMatch = fullText.match(/Email\s*:?\s*([^\s\n\r]+@[^\s\n\r]+)/i);
  if (emailMatch) extracted.email = emailMatch[1].trim();

  // ── Loan Number ───────────────────────────────────────────────────────────
  const loanNumMatch = fullText.match(/Loan\s*Number\s*:?\s*(\d+)/i);
  if (loanNumMatch) extracted.loanNumber = loanNumMatch[1];

  return extracted;
}

/**
 * getMissingRequiredFields(extracted)
 * Returns an array of field names that are missing from the extracted object.
 *
 * @param {Object} extracted
 * @returns {string[]}
 */
export function getMissingRequiredFields(extracted) {
  const required = ['address', 'borrowerName', 'lenderName', 'formTypeCode'];
  return required.filter(f => !extracted[f]);
}

/**
 * buildFactsFromOrder(extracted)
 * Maps extracted order fields to cacc-writer facts schema.
 *
 * @param {Object} extracted
 * @returns {Object} facts object suitable for saveCaseProjection
 */
export function buildFactsFromOrder(extracted) {
  const facts = {};

  if (extracted.streetNumber && extracted.streetName) {
    facts.subject = facts.subject || {};
    facts.subject.address = { value: `${extracted.streetNumber} ${extracted.streetName}`, confidence: 'high' };
  } else if (extracted.address) {
    facts.subject = facts.subject || {};
    facts.subject.address = { value: extracted.address, confidence: 'high' };
  }

  if (extracted.city) {
    facts.subject = facts.subject || {};
    facts.subject.city = { value: extracted.city, confidence: 'high' };
  }
  if (extracted.state) {
    facts.subject = facts.subject || {};
    facts.subject.state = { value: extracted.state, confidence: 'high' };
  }
  if (extracted.zip) {
    facts.subject = facts.subject || {};
    facts.subject.zip = { value: extracted.zip, confidence: 'high' };
  }
  if (extracted.county) {
    facts.subject = facts.subject || {};
    facts.subject.county = { value: extracted.county, confidence: 'high' };
  }
  if (extracted.lat && extracted.lng) {
    facts.subject = facts.subject || {};
    facts.subject.lat = { value: extracted.lat, confidence: 'high' };
    facts.subject.lng = { value: extracted.lng, confidence: 'high' };
  }

  if (extracted.borrowerName) {
    facts.borrower = facts.borrower || {};
    facts.borrower.name = { value: extracted.borrowerName, confidence: 'high' };
  }

  if (extracted.lenderName) {
    facts.lender = facts.lender || {};
    facts.lender.name = { value: extracted.lenderName, confidence: 'high' };
  }
  if (extracted.lenderAddress) {
    facts.lender = facts.lender || {};
    facts.lender.address = { value: extracted.lenderAddress, confidence: 'high' };
  }

  if (extracted.loanType) {
    facts.assignment = facts.assignment || {};
    facts.assignment.loanType = { value: extracted.loanType, confidence: 'high' };
  }
  if (extracted.transactionType) {
    facts.assignment = facts.assignment || {};
    facts.assignment.transactionType = { value: extracted.transactionType, confidence: 'high' };
  }
  if (extracted.formType) {
    facts.assignment = facts.assignment || {};
    facts.assignment.formType = { value: extracted.formType, confidence: 'high' };
  }

  if (extracted.deliveryDate) {
    facts.assignment = facts.assignment || {};
    facts.assignment.effectiveDate = { value: extracted.deliveryDate, confidence: 'medium' };
  }

  if (extracted.fee) {
    facts.assignment = facts.assignment || {};
    facts.assignment.fee = { value: extracted.fee, confidence: 'high' };
  }

  if (extracted.orderID) {
    facts.assignment = facts.assignment || {};
    facts.assignment.orderID = { value: extracted.orderID, confidence: 'high' };
  }

  return facts;
}
