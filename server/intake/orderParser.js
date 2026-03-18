/**
 * server/intake/orderParser.js
 * -----------------------------
 * Extracts structured order data from assignment sheet / order form PDF text.
 *
 * Handles multiple PDF extraction outputs:
 *
 *   pdfjs-dist (Stage 2): Items are joined with single spaces inside groups,
 *     double-spaces separate fields. Output is one long line:
 *     "Street Number:  14  No Appointment Scheduled  Street Name:  Maple Pl  ..."
 *
 *   pdfplumber / pdf-parse (Stage 1): Newline-separated lines, closer to visual layout.
 *     "Street Number: 14\nStreet Name: Maple Pl\n..."
 *
 * Form layouts supported:
 *   1. "Appraisal Assignment Sheet" (First State Mortgage / MSI Loans style)
 *   2. "Residential Appraisal Request Form" (generic)
 *   3. "Appraisal Order Form" (commercial / multi-field form)
 *   4. Email-style informal requests (Gmail print-to-PDF)
 */

/**
 * Normalize raw PDF text to a consistent line-per-field format.
 *
 * pdfjs outputs double-space delimited tokens; we convert those to newlines
 * so downstream code can treat all layouts the same way.
 */
function normalizeText(raw) {
  if (!raw) return '';
  // If the text has very few newlines but lots of double-spaces, it's pdfjs format.
  const newlineCount = (raw.match(/\n/g) || []).length;
  const doubleSpaceCount = (raw.match(/  +/g) || []).length;

  if (doubleSpaceCount > newlineCount * 2) {
    // pdfjs mode: split on 2+ spaces
    return raw.split(/  +/).map(s => s.trim()).filter(Boolean).join('\n');
  }
  return raw;
}

/**
 * Extract the value following a label in the token list.
 * Labels end with ':', values are the next non-empty token(s).
 *
 * For simple single-token values (e.g. a street number, state code),
 * returns just the first token. For multi-word values (e.g. street name),
 * returns up to maxTokens words until hitting another "Label:" pattern.
 *
 * @param {string[]} tokens   Normalized line array
 * @param {RegExp}   labelRe  Regex that matches the label line
 * @param {number}   maxWords Max number of words to collect from value token
 * @returns {string|null}
 */
function extractField(tokens, labelRe, { firstWordOnly = false, stopBefore = null } = {}) {
  const idx = tokens.findIndex(t => labelRe.test(t));
  if (idx < 0) return null;

  // The label token itself may contain the value: "Street Number:  14"
  // After splitting on 2+ spaces, the label becomes its own token "Street Number:"
  // and the value is the next token.
  const labelToken = tokens[idx];
  // Value may be inline: "Street Number: 14" (single space) — extract it
  const inlineMatch = labelToken.replace(labelRe, '').trim();
  if (inlineMatch) {
    const candidate = firstWordOnly ? inlineMatch.split(/\s+/)[0] : inlineMatch;
    // Reject if candidate looks like a label for another field or is just a form marker (*)
    if (!/:\s*$/.test(candidate) && candidate.length > 0 && candidate !== '*') return candidate;
  }

  // Otherwise get the next token
  if (idx + 1 >= tokens.length) return null;
  const nextToken = tokens[idx + 1].trim();
  if (!nextToken || /^[A-Za-z\s]+:/.test(nextToken)) return null; // next is another label

  if (stopBefore && stopBefore.test(nextToken)) return null;
  return firstWordOnly ? nextToken.split(/\s+/)[0] : nextToken;
}

/**
 * parseOrderText(text)
 * Parse raw extracted PDF text into a structured order object.
 *
 * @param {string} text
 * @returns {Object} extracted fields
 */
export function parseOrderText(text) {
  if (!text || typeof text !== 'string') return {};

  const normalized = normalizeText(text);
  const tokens = normalized.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const fullText = tokens.join('\n');

  const extracted = {};

  // ── Detect form layout ────────────────────────────────────────────────────
  const isAssignmentSheet = /Appraisal\s+Assignment\s+Sheet/i.test(fullText);
  const isRequestForm     = /(?:Residential\s+)?Appraisal\s+Request\s+Form/i.test(fullText);
  const isOrderForm       = /Appraisal\s+Order\s+Form/i.test(fullText);
  const isEmailRequest    = /Gmail\s*-\s*Appraisal\s+Request/i.test(fullText) ||
                            (!isAssignmentSheet && !isRequestForm && !isOrderForm &&
                             /appraisal request/i.test(fullText));

  // ── Order ID ──────────────────────────────────────────────────────────────
  const orderIdMatch = fullText.match(/Order\s*(?:ID)?\s*#?\s*:?\s*(\d{4,10})/i);
  if (orderIdMatch) extracted.orderID = orderIdMatch[1];

  // ── Delivery / Due Date ───────────────────────────────────────────────────
  // Assignment sheet has "Expected  Delivery Date:  January 21, 2026" or
  //                        "Expected  January 21, 2026\nDelivery Date:"
  const deliveryMatch =
    fullText.match(/Expected\s*\n?\s*Delivery\s+Date\s*:?\s*\n?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i) ||
    fullText.match(/Delivery\s+Date\s*:?\s*\n?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
    // pdfjs layout: "Expected  Delivery Date:  January 21, 2026" collapsed to separate tokens
    fullText.match(/Delivery\s+Date\s*:\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i);

  if (!deliveryMatch) {
    // "Expected" token followed 1-2 lines later by a date
    const expIdx = tokens.findIndex(t => /^Expected$/i.test(t));
    if (expIdx >= 0) {
      for (let i = expIdx + 1; i < Math.min(expIdx + 4, tokens.length); i++) {
        const dateM = tokens[i].match(/^([A-Za-z]+\s+\d{1,2},?\s*\d{4})$/);
        if (dateM) { extracted.deliveryDate = dateM[1]; break; }
      }
    }
  } else {
    extracted.deliveryDate = deliveryMatch[1].trim();
  }

  // ── Property Address ──────────────────────────────────────────────────────

  if (isAssignmentSheet) {
    // Street Number — extract the first numeric token following the label
    // pdfjs: "Street Number:  14  No Appointment Scheduled" splits to: ["Street Number:", "14  No Appt..."]
    // We want just the numeric part at the start
    const snToken = extractField(tokens, /^Street\s+Number\s*:/i);
    if (snToken) {
      const snNum = snToken.match(/^(\d+\S*)/);
      if (snNum) extracted.streetNumber = snNum[1];
    }

    // Street Name — clean multi-word value
    const snameToken = extractField(tokens, /^Street\s+Name\s*:/i);
    if (snameToken) extracted.streetName = snameToken.trim();

    // Unit # — must not be empty and must not look like the next field label
    const unitToken = extractField(tokens, /^Unit\s*#\s*:/i);
    if (unitToken && !/^(City|State|County|Zip|Street|Borrower)\s*:?$/i.test(unitToken.trim())) {
      extracted.unit = unitToken.trim();
    }

    // City — stop at next label
    const cityToken = extractField(tokens, /^City\s*:/i);
    if (cityToken) {
      // Remove any contamination from merged-column junk
      extracted.city = cityToken
        .replace(/\s+(?:State|Zip|County|Subject|Contact|Phone|Tax)(?:\s+\w+)*\s*:.*/i, '')
        .trim();
    }

    // County
    const countyToken = extractField(tokens, /^County\s*:/i);
    if (countyToken) extracted.county = countyToken.replace(/\s+(Zip|State)\s*:.*/i, '').trim();

    // Zipcode
    const zipToken = extractField(tokens, /^Zip(?:code)?\s*:/i);
    if (zipToken) {
      const zipNum = zipToken.match(/^(\d{5}(?:-\d{4})?)/);
      if (zipNum) extracted.zip = zipNum[1];
    }

    // State — must be a standalone 2-letter code, NOT part of "First State Mortgage" etc.
    const stateToken = extractField(tokens, /^State\s*:/i, { firstWordOnly: true });
    if (stateToken && /^[A-Z]{2}$/.test(stateToken.trim())) {
      extracted.state = stateToken.trim();
    } else {
      const stateMatch = fullText.match(/\bState\s*:\s+([A-Z]{2})\b/);
      if (stateMatch) extracted.state = stateMatch[1];
    }

    // Lat/Long
    const latLongToken = extractField(tokens, /^Lat\s*\/\s*Long\s*:/i);
    if (latLongToken) {
      const llMatch = latLongToken.match(/^([-+]?\d+\.?\d*)\s*\/?\s*([-+]?\d+\.?\d*)/);
      if (llMatch) {
        extracted.lat = parseFloat(llMatch[1]);
        extracted.lng = parseFloat(llMatch[2]);
        extracted.latLong = `${llMatch[1]}/${llMatch[2]}`;
      }
    }

  } else if (isOrderForm) {
    // "Property Address: 8 Lake Pointe Ct" is a single token
    const propAddrTok = tokens.find(t => /^Property\s+Address\s*:/i.test(t));
    if (propAddrTok) {
      const propVal = propAddrTok.replace(/^Property\s+Address\s*:\s*/i, '').trim();
      const parts = propVal.match(/^(\d+\S*)\s+(.+)$/);
      if (parts) { extracted.streetNumber = parts[1]; extracted.streetName = parts[2].trim(); }
      else extracted.streetName = propVal;
    }

    // City — may be:
    //   A) One token: "City: Bloomington Subject Property Contact:"
    //   B) Two tokens: ["City:", "Bloomington"]
    const cityTokIdx = tokens.findIndex(t => /^City\s*:/i.test(t));
    if (cityTokIdx >= 0) {
      const cityTokVal = tokens[cityTokIdx].replace(/^City\s*:\s*/i, '').trim();
      if (cityTokVal) {
        // Layout A: value is inline, strip noise
        extracted.city = cityTokVal
          .replace(/\s+(?:State|Zip|County|Subject|Contact|Phone|Tax|Owner)(?:\s+\w+)*\s*:.*/i, '')
          .trim();
      } else if (cityTokIdx + 1 < tokens.length) {
        // Layout B: value is next token
        const nextTok = tokens[cityTokIdx + 1].trim();
        if (nextTok && !/^[A-Z][a-z]+\s*:/.test(nextTok)) { // not another label
          extracted.city = nextTok;
        }
      }
    }

    // State — may be:
    //   A) One token: "State: IL Name: Patricia/Larry Hundman"
    //   B) Two tokens: ["State:", "IL"]
    const stateTokIdx = tokens.findIndex(t => /^State\s*:/i.test(t));
    if (stateTokIdx >= 0) {
      const stateTokVal = tokens[stateTokIdx].replace(/^State\s*:\s*/i, '').trim();
      const stateInline = stateTokVal.match(/^([A-Z]{2})\b/);
      if (stateInline) {
        extracted.state = stateInline[1];
      } else if (stateTokIdx + 1 < tokens.length) {
        // Layout B: next token may be the state code
        const nextTok = tokens[stateTokIdx + 1].trim();
        if (/^[A-Z]{2}$/.test(nextTok)) extracted.state = nextTok;
      }
    }

    // "Zip Code: 61704 Owner/Agent: Owner"
    const zipTok = tokens.find(t => /^Zip\s*(?:Code)?\s*:/i.test(t));
    if (zipTok) {
      const zipM = zipTok.match(/(?:Zip\s*(?:Code)?\s*:\s*)(\d{5}(?:-\d{4})?)/i);
      if (zipM) extracted.zip = zipM[1];
    }

    // "County: McLean Phone: ..."
    const countyTok = tokens.find(t => /^County\s*:/i.test(t));
    if (countyTok) {
      extracted.county = countyTok.replace(/^County\s*:\s*/i, '').trim()
        .replace(/\s+(?:Phone|Tax|Zip|State)\s*:.*/i, '').trim();
    }

  } else if (isRequestForm) {
    // Request forms from pdfjs may have two sub-layouts:
    //  A) Inline: "Property Address:* 1021 North Oak Street" — label+value in same token
    //  B) Column-separated: All labels first (tokens 0-30), then all values (tokens 31+)
    //     In this case, we can't use adjacent-token matching — must match by value pattern

    // Check: is the property address token inline or split?
    const inlinePropTok = tokens.find(t =>
      /^Property\s+Address\s*\*?\s*:\*?\s*\d+/i.test(t)
    );
    const inlineCszTok = tokens.find(t =>
      /^City\s*[\/,]?\s*State\s*[\/,]?\s*Zip\s*\*?\s*:\*?\s*\w/i.test(t) &&
      /[A-Z]{2}\s+\d{5}/i.test(t)
    );

    if (inlinePropTok) {
      // Layout A: value is inline
      const propVal = inlinePropTok.replace(/^Property\s+Address\s*\*?\s*:\*?\s*/i, '').replace(/^\*\s*/, '').trim();
      const addrParts = propVal.match(/^(\d+\S*)\s+(.+)$/);
      if (addrParts) { extracted.streetNumber = addrParts[1]; extracted.streetName = addrParts[2].trim(); }
      else extracted.streetName = propVal;
    } else {
      // Layout B: find a token that looks like a street address by value pattern
      // "1021 North Oak Street" — starts with number, followed by words
      const addrValTok = tokens.find(t =>
        /^\d+\s+[A-Za-z]/.test(t) &&
        /(?:St|Rd|Ave|Blvd|Dr|Ln|Way|Ct|Pl|Court|Lane|Street|Road|Drive|Place|Oak|Maple|Elm|Park|Main)\b/i.test(t) &&
        !/^(?:Phone|Email|Fax|Address|Street)/i.test(t)
      );
      if (addrValTok) {
        const parts = addrValTok.match(/^(\d+\S*)\s+(.+)$/);
        if (parts) { extracted.streetNumber = parts[1]; extracted.streetName = parts[2].trim(); }
      }
    }

    // City/State/Zip
    if (inlineCszTok) {
      // Layout A: value is inline
      const cszVal = inlineCszTok
        .replace(/^City\s*[\/,]?\s*State\s*[\/,]?\s*Zip\s*\*?\s*:\*?\s*/i, '')
        .replace(/^\*\s*/, '').trim();
      const m = cszVal.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { extracted.city = m[1].trim(); extracted.state = m[2]; extracted.zip = m[3]; }
    } else {
      // Layout B: find token matching "City ST ZIPCODE" pattern (property address location)
      // e.g. "Normal IL 61761" — not a lender address (which would be in a known city)
      // Strategy: find ALL tokens matching city/state/zip pattern, pick the one associated with property
      const cszCandidates = tokens.filter(t =>
        /^[A-Za-z][A-Za-z\s]+\s+[A-Z]{2}\s+\d{5}$/.test(t.trim())
      );
      // If there are two, the second "City/State/Zip:*" label's value is what we want (property, not lender)
      // Count the "City/State/Zip" label occurrences
      const cszLabels = tokens.filter(t => /^City\s*[\/,]?\s*State\s*[\/,]?\s*Zip\s*\*?/i.test(t));
      const propCszLabelIdx = tokens.findIndex(t => /^City\/State\/Zip:\*$|^City\/State\/Zip\*:/i.test(t));
      // Property CSZ is the one after the lender CSZ in the values section
      // Typically: lender's city/state/zip appears before property's in the value-dump
      if (cszCandidates.length >= 2) {
        // Second one is the property (lender CSZ comes first in the value block)
        const propCsz = cszCandidates[1];
        const m = propCsz.trim().match(/^([A-Za-z][A-Za-z\s]+)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (m) { extracted.city = m[1].trim(); extracted.state = m[2]; extracted.zip = m[3]; }
      } else if (cszCandidates.length === 1) {
        const m = cszCandidates[0].trim().match(/^([A-Za-z][A-Za-z\s]+)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (m) { extracted.city = m[1].trim(); extracted.state = m[2]; extracted.zip = m[3]; }
      }
      // Also try without zip (some forms just have "City ST")
      if (!extracted.city) {
        const citySt = tokens.find(t => /^[A-Za-z][A-Za-z\s]+\s+[A-Z]{2}$/.test(t.trim()));
        if (citySt) {
          const m = citySt.trim().match(/^([A-Za-z][A-Za-z\s]+)\s+([A-Z]{2})$/);
          if (m) { extracted.city = m[1].trim(); extracted.state = m[2]; }
        }
      }
    }

  } else if (isEmailRequest) {
    // Look for street address pattern in body text — use the first match in a clean line
    // Prefer short lines (not 80+ char legal disclaimers)
    const addrLineMatch = tokens
      .filter(t => t.length < 60)
      .find(t => /^\d+\s+\w/.test(t) && /(?:St|Rd|Ave|Blvd|Dr|Ln|LN|Way|Ct|Pl|Court|Lane|Street|Road|Drive|Place)/i.test(t));
    if (addrLineMatch) {
      const parts = addrLineMatch.match(/^(\d+\S*)\s+(.+)$/);
      if (parts) {
        extracted.streetNumber = parts[1];
        extracted.streetName   = parts[2].trim();
      }
    }
    // City/State/Zip — look for the clean "City, ST ZIPCODE" pattern on its own line
    const cszToken = tokens.find(t => /^[A-Za-z][A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}$/.test(t.trim()));
    if (cszToken) {
      const m = cszToken.trim().match(/^([A-Za-z][A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { extracted.city = m[1].trim(); extracted.state = m[2]; extracted.zip = m[3]; }
    } else {
      // Fallback: find it anywhere in text
      const cszMatch = fullText.match(/\b([A-Za-z][A-Za-z\s]{2,25}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
      if (cszMatch) {
        extracted.city  = cszMatch[1].trim();
        extracted.state = cszMatch[2];
        extracted.zip   = cszMatch[3];
      }
    }
  } else {
    // Generic fallback
    const snToken = extractField(tokens, /^Street\s+Number\s*:/i);
    if (snToken) { const m = snToken.match(/^(\d+\S*)/); if (m) extracted.streetNumber = m[1]; }
    const snameToken = extractField(tokens, /^Street\s+Name\s*:/i);
    if (snameToken) extracted.streetName = snameToken.trim();
    const stateMatch = fullText.match(/\bState\s*:\s+([A-Z]{2})\b/);
    if (stateMatch) extracted.state = stateMatch[1];
    const cityToken = extractField(tokens, /^City\s*:/i);
    if (cityToken) extracted.city = cityToken.replace(/\s+(County|Zip|State)\s*:.*/i, '').trim();
    const zipMatch = fullText.match(/Zip(?:code|\ Code)?\s*:?\s*(\d{5}(?:-\d{4})?)/i);
    if (zipMatch) extracted.zip = zipMatch[1];
  }

  // Build full address
  if (extracted.streetNumber && extracted.streetName) {
    let addr = `${extracted.streetNumber} ${extracted.streetName}`;
    if (extracted.unit) addr += ` Unit ${extracted.unit}`;
    if (extracted.city) addr += `, ${extracted.city}`;
    if (extracted.state) addr += `, ${extracted.state}`;
    if (extracted.zip) addr += ` ${extracted.zip}`;
    extracted.address = addr;
  }

  // ── Borrowers ─────────────────────────────────────────────────────────────
  // Borrower tokens may have "* Name" form (from Required Fields marker)
  let b1Token = extractField(tokens, /^Borrower\s*1\s*:/i) ||
                extractField(tokens, /^Borrower\s*\*?\s*:/i);

  // Request Form Layout B: "Borrower:*" is at position N, value is NOT the next token
  // (all labels come first, all values come after). Fall back to a label-offset match:
  // find the "Borrower" label index, then find corresponding value by counting label positions
  if (!b1Token && isRequestForm) {
    // Layout B: all labels come first, all values after. Can't use adjacent-token matching.
    // Find the boundary where label tokens end and value tokens begin.
    // A "label token" looks like "Word Word...:" (ends with colon). 
    // The value block starts at the first token that does NOT end with ':' and isn't a section marker.
    // Note: "e-mail:" passes /^[A-Za-z]/ but contains a hyphen — we use a broader "ends with :" check.
    const isLabelTok = t => /[:\u00a0]$/.test(t) || /^\(\*\)/.test(t);
    const valueStartIdx = tokens.findIndex(t => !isLabelTok(t));

    if (valueStartIdx >= 0) {
      // In the value block, find all "human name" tokens:
      //   - 2-4 words, all title-case (First Last)
      //   - Not an email, phone, address, org name, or section header
      const valueToks = tokens.slice(valueStartIdx).filter(t =>
        !/@/.test(t) &&
        !/^\(?\d{3}\)?/.test(t) &&
        !/^\d/.test(t) &&
        !/(?:Bank|Mortgage|Financial|Trust|Information|Form|Required|Denotes|Residential|Appraisal|Client|Property|Section)/i.test(t) &&
        /^[A-Z][a-z]/.test(t) &&
        t.split(/\s+/).length >= 2 &&
        t.split(/\s+/).length <= 4 &&
        t.split(/\s+/).every(w => /^[A-Z][a-z]+$/.test(w))
      );
      // The LAST such name is most likely the borrower
      // (contact/owner/agent names appear earlier in the value dump; borrower is at the end)
      if (valueToks.length > 0) b1Token = valueToks[valueToks.length - 1];
    }
  }

  if (b1Token) extracted.borrower1 = b1Token.replace(/^\*\s*/, '').trim();

  const b2Token = extractField(tokens, /^Borrower\s*2\s*:/i);
  if (b2Token && b2Token.trim()) extracted.borrower2 = b2Token.replace(/^\*\s*/, '').trim();

  // Order form may have "Borrower: Name1 & Name2"
  if (extracted.borrower1?.includes('&') && !extracted.borrower2) {
    const parts = extracted.borrower1.split('&');
    extracted.borrower1 = parts[0].trim();
    extracted.borrower2 = parts[1].trim();
  }

  if (extracted.borrower1) {
    extracted.borrowerName = extracted.borrower2
      ? `${extracted.borrower1} / ${extracted.borrower2}`
      : extracted.borrower1;
  }

  // ── Contact ───────────────────────────────────────────────────────────────
  const homeToken = extractField(tokens, /^Home\s*#\s*:/i);
  if (homeToken) extracted.contactPhone = homeToken.trim();

  const altToken = extractField(tokens, /^Alt\s+Contact\s*:/i);
  if (altToken) extracted.contactName = altToken.trim();

  // Email (anywhere in text)
  const emailMatch = fullText.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) extracted.email = emailMatch[1].trim();

  // Loan Number
  const loanNumMatch = fullText.match(/Loan\s*Number\s*:?\s*(\d+)/i);
  if (loanNumMatch) extracted.loanNumber = loanNumMatch[1];

  // ── Lender ────────────────────────────────────────────────────────────────

  if (isAssignmentSheet) {
    // "Company Information  First State Mortgage  502 N Hershey Rd  Bloomington, IL 61704"
    // In token list: ["Company Information", "First State Mortgage", "502 N Hershey Rd", "Bloomington, IL 61704", ...]
    const ciIdx = tokens.findIndex(t => /^Company\s+Information\s*$/i.test(t));
    if (ciIdx >= 0) {
      // Next token should be lender name
      if (ciIdx + 1 < tokens.length) extracted.lenderName = tokens[ciIdx + 1].trim();
      // Following tokens: street, city/state (may include zip)
      if (ciIdx + 2 < tokens.length) {
        const addrLine1 = tokens[ciIdx + 2].trim();
        const addrLine2 = tokens[ciIdx + 3]?.trim() || '';
        if (/^\d+/.test(addrLine1)) {
          // addrLine2 might be "Bloomington, IL 61704" or just "Bloomington, IL"
          if (addrLine2 && /^[A-Za-z]/.test(addrLine2)) {
            extracted.lenderAddress = `${addrLine1}, ${addrLine2}`;
          } else {
            extracted.lenderAddress = addrLine1;
          }
        }
      }
    }
    // Also check for lender info in the "Lender/Client Details" section (right column).
    // In pdfjs output this is interspersed with assignment details after "Assignment Details  Lender/Client Details".
    // The lender name appears after "First State Mortgage" in the right column block.
    // We've already captured it from Company Information — that's more reliable.

  } else if (isRequestForm) {
    // Request Form Layout A: "Name: Chelsea  Organization: First State Bank and Trust" (inline)
    // Request Form Layout B: "Organization:" is just a label; value is somewhere in the token block
    // For both layouts: find a token that looks like a financial institution name
    const orgInline = fullText.match(/Organization\s*:\s*([^\n]+)/i);
    const orgInlineVal = orgInline?.[1]?.trim();
    // If the inline value looks like an org name (not a label or email), use it
    if (orgInlineVal && /(?:Bank|Mortgage|Financial|Trust|Lending|Savings|Credit Union)/i.test(orgInlineVal)) {
      extracted.lenderName = orgInlineVal;
    } else {
      // Layout B fallback: scan all tokens for a financial institution name
      const bankTok = tokens.find(t =>
        /(?:Bank|Mortgage|Financial|Trust|Lending|Savings|Credit Union)/i.test(t) &&
        t.length < 80 &&
        !/^(Phone|Email|Fax|Web|Office|Address|City|Appraiser):/i.test(t) &&
        !/^\d/.test(t)
      );
      if (bankTok) extracted.lenderName = bankTok.trim();
    }

    // "Address: 201 West Main Street  City/State/Zip: Monticello, IL 61856"
    const addrToken = extractField(tokens, /^Address\s*:/i);
    if (addrToken) {
      // City/State/Zip may be in the same token or the next
      const cszLenderMatch = addrToken.match(/City\s*\/\s*State\s*\/\s*Zip\s*:\s*(.+)/i);
      if (cszLenderMatch) {
        extracted.lenderAddress = addrToken.replace(/\s*City\/State\/Zip\s*:.*/i, '').trim() +
                                  ', ' + cszLenderMatch[1].trim();
      } else {
        const cszLenderToken = extractField(tokens, /^City\s*\/?\s*State\s*\/?\s*Zip\s*:/i);
        if (cszLenderToken) {
          extracted.lenderAddress = `${addrToken}, ${cszLenderToken}`.trim();
        } else {
          extracted.lenderAddress = addrToken;
        }
      }
    }

  } else if (isOrderForm) {
    // "Appraisal Requested By:  Lender Information"
    // Followed by lines with contact name, then bank name, then address
    const lenderInfoIdx = tokens.findIndex(t => /Lender\s+Information/i.test(t));
    if (lenderInfoIdx >= 0) {
      for (let i = lenderInfoIdx + 1; i < Math.min(lenderInfoIdx + 15, tokens.length); i++) {
        const t = tokens[i];
        if (/(?:Bank|Mortgage|Financial|Savings|Credit Union|Trust|FSB)/i.test(t) &&
            !extracted.lenderName && !/^Phone|^Email|^Fax|^Loan|^Branch/.test(t)) {
          // Token may be bare "First State Bank" or "First State Bank Loan Processor: Wilson"
          // Extract just the company name portion
          const nameOnly = t.replace(/\s+(?:Loan\s+\w+|Branch\s+\w+|Phone|Email|Fax)\s*:.*/i, '').trim();
          extracted.lenderName = nameOnly;
        }
        // Address: starts with digits, e.g. "502 N. Hershey Road" or "502 N. Hershey Road Branch Location: ..."
        if (/^\d+/.test(t) && !extracted.lenderAddress) {
          const addrOnly = t.replace(/\s+(?:Branch\s+\w+|Phone|Email|Fax)\s*:.*/i, '').trim();
          // Next token might be city/state: "Bloomington, IL 61704" or "Branch Location: ..."
          let next = tokens[i + 1]?.trim() || '';
          // Skip tokens that are branch/contact labels
          if (/^(?:Branch|Phone|Email|Loan)\s/i.test(next)) {
            next = tokens[i + 2]?.trim() || '';
          }
          // Use next token if it looks like a city/state/zip
          if (next && /^[A-Za-z]/.test(next) && /[A-Z]{2}/.test(next)) {
            const cityOnly = next.replace(/\s+(?:Phone|Email|Fax)\s*:.*/i, '').trim();
            extracted.lenderAddress = `${addrOnly}, ${cityOnly}`;
          } else {
            extracted.lenderAddress = addrOnly;
          }
        }
      }
    }
    // Fallback: "Appraisal Requested By:" block
    if (!extracted.lenderName) {
      const reqIdx = tokens.findIndex(t => /Appraisal\s+Requested\s+By\s*:/i.test(t));
      if (reqIdx >= 0) {
        for (let i = reqIdx + 1; i < Math.min(reqIdx + 6, tokens.length); i++) {
          if (/(?:Bank|Mortgage|Financial|Savings|Credit Union|Trust)/i.test(tokens[i])) {
            extracted.lenderName = tokens[i].replace(/\s+(?:Loan\s+\w+|Branch\s+\w+)\s*:.*/i, '').trim();
            break;
          }
        }
      }
    }

  } else if (isEmailRequest) {
    // Find a token that IS a company name — short token containing Bank/Mortgage etc., not a person's name
    const bankToken = tokens.find(t =>
      /(?:Bank|Mortgage|Financial|Savings|Credit Union|Lending|Trust)/i.test(t) &&
      t.length < 60 && !/^(Phone|Email|Fax|Web|Office):/i.test(t)
    );
    if (bankToken) {
      extracted.lenderName = bankToken.trim();
    } else {
      const knownBankMatch = fullText.match(/(First\s+Security\s+Bank|First\s+State\s+(?:Bank|Mortgage)|[\w\s]+(?:Bank|Mortgage|Financial|Savings|Credit Union))/i);
      if (knownBankMatch) extracted.lenderName = knownBankMatch[1].trim();
    }
    const lenderAddrMatch = fullText.match(/(\d+\s+[^\n\r]+(?:Dr|St|Ave|Blvd|Rd|Ln|Way|Ct|Pl)[^\n\r]*)\n([A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5})/);
    if (lenderAddrMatch) extracted.lenderAddress = `${lenderAddrMatch[1].trim()}, ${lenderAddrMatch[2].trim()}`;

  } else {
    // Generic fallback
    const ciIdx = tokens.findIndex(t => /^Company\s+Information\s*$/i.test(t));
    if (ciIdx >= 0 && ciIdx + 1 < tokens.length) {
      extracted.lenderName = tokens[ciIdx + 1].trim();
    }
    if (!extracted.lenderName) {
      const m = fullText.match(/([\w\s&.]+(?:Mortgage|Bank|Savings|Financial|Lending|Credit Union|Home Loans)[^\n\r,]*)/i);
      if (m) extracted.lenderName = m[1].trim();
    }
  }

  // ── Loan / Transaction Type ───────────────────────────────────────────────
  const loanTypeToken = extractField(tokens, /^Loan\s+Type\s*:/i);
  if (loanTypeToken) extracted.loanType = loanTypeToken.trim();

  // Transaction type — may be split across tokens in pdfjs
  // pdfjs output: "Transaction  Type/Use:  Refinance" → tokens: ["Transaction", "Type/Use:", "Refinance"]
  let txType = extractField(tokens, /^Transaction\s+(?:Type(?:\/Use)?)?\s*:/i);
  if (!txType) {
    // "Transaction" token followed by "Type/Use:" then the value
    const txIdx = tokens.findIndex(t => /^Transaction$/i.test(t));
    if (txIdx >= 0) {
      for (let i = txIdx + 1; i < Math.min(txIdx + 4, tokens.length); i++) {
        if (/^Type/i.test(tokens[i])) continue; // skip "Type/Use:" label
        if (tokens[i].trim()) { txType = tokens[i].trim(); break; }
      }
    }
  }
  if (txType) extracted.transactionType = txType;

  // ── Form Type ─────────────────────────────────────────────────────────────
  // Look for a token matching "NNNN - <alphabetic description>"
  // Must start with a 3-4 digit number followed by space-dash-space and alpha text.
  // Phone numbers like "309-706-1014" should NOT match (no alpha after dash).
  const formToken = tokens.find(t =>
    /^\d{3,4}[A-Z]?\s*[-–]\s*[A-Za-z]/.test(t.trim())
  );
  if (formToken) {
    const m = formToken.trim().match(/^(\d{3,4}[A-Z]?\s*[-–]\s*[^$\n\r]+?)(?:\s+\$|\s*$)/);
    if (m) extracted.formType = m[1].trim();
  }

  // Normalize to form number code
  if (extracted.formType) {
    const m = extracted.formType.match(/^(\d{3,4}[A-Z]?)/);
    if (m) extracted.formTypeCode = m[1];
  }

  // ── Fee ───────────────────────────────────────────────────────────────────
  const feeMatch = fullText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (feeMatch) extracted.fee = feeMatch[1].replace(/,/g, '');

  // ── Lat/Long (generic fallback) ───────────────────────────────────────────
  if (!extracted.lat) {
    const llMatch = fullText.match(
      /Lat(?:itude)?\/Long(?:itude)?\s*:?\s*([-+]?\d+\.?\d*)\s*\/?\s*([-+]?\d+\.?\d*)/i
    );
    if (llMatch) {
      extracted.lat = parseFloat(llMatch[1]);
      extracted.lng = parseFloat(llMatch[2]);
      extracted.latLong = `${llMatch[1]}/${llMatch[2]}`;
    }
  }

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
