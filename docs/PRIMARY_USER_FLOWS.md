# CACC Writer — Primary User Flows

Last updated: 2026-03-13
Reference: `docs/DEFINITION_OF_DONE.md` for the operational standard these flows must meet.

---

## Case Lifecycle Diagram

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                        ASSIGNMENT ARRIVES                                │
 │                  (email, AMC portal, direct client)                      │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  1. INTAKE                                                               │
 │  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────────┐    │
 │  │ Create Case  │→ │ Link Engagement  │→ │ Set Form Type & Due Date │    │
 │  └─────────────┘  └──────────────────┘  └──────────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  2. DOCUMENT COLLECTION                                                  │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
 │  │ Upload Documents  │→ │ Auto-Classify    │→ │ Trigger Extraction   │   │
 │  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  3. FACT VERIFICATION                                                    │
 │  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────────────┐  │
 │  │ Review Extracted  │→ │ Resolve Conflicts│→ │ Approve / Correct     │  │
 │  │ Facts             │  │ (multi-source)   │  │ (pre-draft gate)      │  │
 │  └──────────────────┘  └─────────────────┘  └────────────────────────┘  │
 └────────────────────────────┬─────────────────────────────────────────────┘
 ┌────────────────────────────┤ (optional, parallel)
 │                            │
 │  3b. WEB RESEARCH          │
 │  ┌──────────────┐          │
 │  │ Crawl Sources │          │
 │  │ (assessor,    │          │
 │  │  MLS, FEMA,   │          │
 │  │  zoning)      │          │
 │  └──────┬───────┘          │
 │         ▼                  │
 │  ┌──────────────┐          │
 │  │ Review &     │          │
 │  │ Push to Facts│──────────┤
 │  └──────────────┘          │
 └────────────────────────────┤
                              │
 ┌────────────────────────────┤ (optional, parallel)
 │                            │
 │  3c. INSPECTION            │
 │  ┌──────────────┐          │
 │  │ Field Capture │          │
 │  │ (photos,      │          │
 │  │  measurements,│          │
 │  │  conditions)  │          │
 │  └──────┬───────┘          │
 │         ▼                  │
 │  ┌──────────────┐          │
 │  │ Sync to Case │──────────┤
 │  │ Facts        │          │
 │  └──────────────┘          │
 └────────────────────────────┤
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  4. INTELLIGENCE BUILD                                                   │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Section Req.      │→ │ Retrieve Knowledge│→ │ Build Prompt Context│    │
 │  │ Matrix Check      │  │ (voice + KB)      │  │                     │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  5. VALUATION ANALYSIS                                                   │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Select & Analyze  │→ │ Support           │→ │ Reconcile Approaches│    │
 │  │ Comps             │  │ Adjustments       │  │ (appraiser decides) │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  6. GENERATION                                                           │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Generate Sections │→ │ Review / Edit     │→ │ Approve Sections    │    │
 │  │ (voice-matched)   │  │ (appraiser review)│  │ (mark finalized)    │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  7. QC REVIEW                                                            │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Run QC Checks     │→ │ Resolve Blockers  │→ │ Clear Contradictions│    │
 │  │ (severity-graded)  │  │ & Findings        │  │ Gate                │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  8. INSERTION / EXPORT                                                   │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Insert into Form  │→ │ Verify / Readback │→ │ Replay if Failed    │    │
 │  │ Software          │  │                    │  │                     │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └────────────────────────────┬─────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  9. DELIVERY & ARCHIVE                                                   │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
 │  │ Final Review      │→ │ Deliver Report    │→ │ Archive Assignment  │    │
 │  │ in Form Software  │  │ (PDF / MISMO)     │  │ (feeds learning)    │    │
 │  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## Flow A: 1004 Single-Family Residential Case

**Form type:** `1004`
**Insertion target:** ACI (Windows desktop via pywinauto agent on port 5180)
**Priority sections:** 10 (neighborhood_description, market_conditions, site_description, improvements_description, condition_description, contract_analysis, concessions_analysis, highest_best_use, sales_comparison_summary, reconciliation)

### Step-by-Step

#### A1. Create Case
- **Tab:** Case
- **Action:** Click "New Case," enter property address, borrower/client info, lender, engagement terms, due date.
- **System:** Creates canonical case record. Links to engagement if quote/engagement already exists. Sets workflow state to `intake`.
- **Validation:** Case appears in case list with `1004` form badge. Business status shows engagement terms and due date.

#### A2. Upload Documents
- **Tab:** Docs
- **Action:** Upload engagement letter, purchase contract, MLS listing sheet, county assessor printout, prior appraisal (if available), flood map, zoning documentation, photos.
- **System:** Documents are classified by type. Extraction pipeline processes each document. Extracted facts are queued for review.
- **Validation:** Document slots show `uploaded` status. Extracted fact count is visible.

#### A3. Web Research (Optional)
- **Tab:** Pipeline
- **Action:** Run subject property crawl (assessor site, listing pages). Run comparable property crawls. Run market area research (flood, zoning, market reports).
- **System:** Cloudflare-backed crawl jobs execute. Extracted data is presented as fact cards with source URL, confidence, and conflict indicators.
- **Action:** Review extracted web facts. Approve, reject, or correct each. Push approved facts to case record.
- **Validation:** Pushed facts appear in Facts tab with provenance showing web source.

#### A4. Inspect Property
- **Tab:** (Inspection mode, if available)
- **Action:** Capture photos (tagged by room/component), measurements, condition observations (C1–C6 rating), quality observations, and voice notes.
- **System:** Inspection artifacts sync to case record as auditable facts.
- **Validation:** Case facts include inspection-sourced observations with audit trail.

#### A5. Review and Verify Facts
- **Tab:** Facts
- **Action:** Review all extracted and manually entered facts. Resolve conflicts where multiple sources disagree. Approve facts for draft readiness.
- **System:** Pre-draft gate checks that required facts are reviewed. Missing-facts dashboard shows what is still needed by section and severity.
- **Validation:** Pre-draft gate clears for all required sections. No unresolved `blocker` or `high` severity fact gaps for priority sections.

#### A6. Develop Valuation Support
- **Tab:** Intel (valuation desk)
- **Action:**
  - **Sales Comparison:** Select comparable candidates → accept/reject/hold with reasons → load accepted comps into grid → enter adjustments with support notes → review burden metrics and contradictions.
  - **Cost Approach:** Enter land value basis, replacement cost estimate, depreciation schedule with support.
  - **Income Approach (if applicable):** Enter rent comparables, GRM, expense estimates.
  - **Reconciliation:** Review approach strengths/weaknesses → assign weights → write reconciliation rationale.
- **System:** All valuation support persists in case record with provenance. Contradictions between comp data and subject facts are flagged.
- **Validation:** Comp grid is populated. Adjustment support is documented. Reconciliation notes exist. No unsupported adjustments flagged as blockers.

#### A7. Generate Narrative Sections
- **Tab:** Workspace / Generate
- **Action:** Select sections to generate (or generate all ready sections). Review each generated section. Edit as needed. Approve finalized sections.
- **System:** Generation uses verified facts, retrieved voice-matched examples, and prompt context. Section governance cards show prompt version, policy state, dependency snapshot, freshness, quality score. If facts change after generation, affected sections are marked stale.
- **Validation:** All 10 priority sections generated. Each shows governance metadata. Approved sections are locked for insertion.

#### A8. Run QC
- **Tab:** QC
- **Action:** Run QC check. Review findings by severity (blocker → advisory). Resolve or acknowledge each finding. Clear contradiction gate.
- **System:** QC engine checks fact completeness, section consistency, contradiction status, compliance rules. Readiness signal updates.
- **Validation:** Readiness signal shows `ready` or `review_recommended`. No unresolved blockers. Contradiction gate clears.

#### A9. Insert into ACI
- **Tab:** Workspace (insertion controls)
- **Action:** Trigger insertion of approved sections into ACI. Monitor insertion status. Review verification/readback results.
- **System:** ACI agent (port 5180) opens the 1004 form, navigates to each tab, writes field content, reads back for verification. Failed fields are flagged for replay.
- **Validation:** Insertion reliability summary shows pass/fail per field. Failed insertions can be replayed. All priority fields show successful readback.

#### A10. Finalize, Deliver, Archive
- **Action:** Complete remaining manual work in ACI (signature, addenda formatting, reviewer comments). Generate final PDF. Deliver to client/AMC.
- **Action:** Archive completed assignment in CACC Writer.
- **System:** Archive captures: original facts, all generated drafts, appraiser edits, final approved text, QC dispositions, valuation support, insertion records. Learning system ingests revision diffs.
- **Validation:** Case status shows `archived`. Learning system confirms archival. Case is available for future retrieval influence.

---

## Flow B: Commercial Case

**Form type:** `commercial`
**Insertion target:** Real Quantum (browser automation via Playwright agent on port 5181)
**Priority sections:** 5 (neighborhood, market_overview, improvements_description, highest_best_use, reconciliation)

### Step-by-Step

#### B1. Create Case
- **Tab:** Case
- **Action:** Click "New Case," select `commercial` form type. Enter property address, property type (multifamily / mixed-use / retail / office / industrial / land), client info, engagement terms, intended use, scope of work, due date.
- **System:** Creates case record with commercial workspace definition. Links to engagement.
- **Validation:** Case appears with `commercial` form badge. Property type is recorded and influences workspace layout.

#### B2. Upload Documents
- **Tab:** Docs
- **Action:** Upload engagement letter, rent rolls, operating statements (current + historical), lease abstracts, purchase/sale agreements, tax records, zoning documentation, environmental reports, market studies, photos, floor plans, site plans.
- **System:** Document classification handles commercial document types. Extraction pipeline processes financial documents (rent rolls, P&L, expense statements) into structured data.
- **Validation:** Document slots show uploaded status. Financial data extracted into structured format (not just raw text).

#### B3. Web Research
- **Tab:** Pipeline
- **Action:** Crawl county assessor for commercial parcel data. Crawl municipal zoning for use/density/setback info. Research market area for commercial rental/vacancy/cap rate data.
- **System:** Crawl jobs return commercial-relevant data. Fact cards distinguish between residential and commercial data fields.
- **Validation:** Extracted commercial data (NOI, cap rates, vacancy rates, rental rates, expense ratios) appears as reviewable fact cards.

#### B4. Inspect Property
- **Tab:** (Inspection mode)
- **Action:** Capture exterior/common area photos, unit mix verification, building system observations (HVAC, roof, structure, electrical, plumbing), parking count, site measurements, ADA compliance notes, environmental observations.
- **System:** Commercial inspection checklist accommodates property-type-specific items. Observations flow to case facts.
- **Validation:** Inspection facts reflect commercial property characteristics. Condition observations are property-type-appropriate.

#### B5. Review and Verify Facts
- **Tab:** Facts
- **Action:** Review all extracted facts including financial data. Verify rent roll accuracy, expense amounts, vacancy figures. Resolve conflicts between reported and market data. Approve facts.
- **System:** Pre-draft gate enforces commercial fact requirements. Missing-facts dashboard reflects commercial section needs (income data, expense data, market cap rates, etc.).
- **Validation:** Commercial-specific required facts are verified. Pre-draft gate clears for priority sections.

#### B6. Develop Valuation Support
- **Tab:** Intel (valuation desk)
- **Action:**
  - **Sales Comparison:** Select and analyze commercial comparable sales → adjust for property rights, financing, conditions of sale, market conditions, location, physical characteristics → document support for each adjustment.
  - **Income Approach:** Build reconstructed operating statement → select and support cap rate from market data and comparable sales → calculate value indication → document methodology (direct cap, GRM, DCF as appropriate).
  - **Cost Approach:** Estimate land value (comparable land sales) → estimate replacement/reproduction cost → deduct depreciation (physical, functional, external) → document support.
  - **Reconciliation:** Weight approaches based on data quality and applicability → document reasoning for weighting → state final value opinion.
- **System:** Income approach workspace handles rent comp analysis, expense comparisons, cap rate extraction from comps. All support persists with provenance.
- **Validation:** All applicable approaches developed with support. Reconciliation rationale documented. No unsupported adjustment blockers.

#### B7. Generate Narrative Sections
- **Tab:** Workspace / Generate
- **Action:** Generate all 5 priority commercial sections. Review each. Edit for property-type-specific accuracy. Approve.
- **System:** Commercial generation uses property-type context (multifamily vs. retail vs. office etc.). Narrative plan templates guide section structure for the specific property type.
- **Validation:** All 5 priority sections generated. Governance metadata visible. Approved sections ready for insertion.

#### B8. Run QC
- **Tab:** QC
- **Action:** Run QC. Review commercial-specific findings (income consistency, cap rate support, expense ratio reasonableness). Resolve blockers.
- **System:** QC rules include commercial-specific checks. Contradiction engine covers income/expense/valuation conflicts.
- **Validation:** QC clears. No unresolved blockers or contradictions.

#### B9. Insert into Real Quantum
- **Tab:** Workspace (insertion controls)
- **Action:** Trigger insertion into Real Quantum. Monitor insertion status. Review verification results.
- **System:** Real Quantum agent (port 5181) opens the commercial form in browser, navigates to sections, inserts content, verifies. Failed sections are flagged for replay.
- **Validation:** Insertion summary shows pass/fail per section. All priority sections successfully inserted and verified.

#### B10. Package Exhibits and Appendices
- **Action:** Assemble supporting exhibits: rent comp grid, expense comparison, cap rate support, comparable sale sheets, maps, photos, certifications.
- **System:** Exhibit/appendix packaging flow organizes supporting materials into the correct order for the report.
- **Validation:** Exhibits are organized and attached to the report package.

#### B11. Finalize, Deliver, Archive
- **Action:** Complete remaining work in Real Quantum. Generate final report. Deliver.
- **Action:** Archive in CACC Writer.
- **System:** Same archival and learning flow as 1004. Commercial-specific patterns feed the learning system separately.
- **Validation:** Case archived. Learning system confirms ingestion.

---

## Common Sub-Flows

### Voice Training
- **Tab:** Voice
- **Action:** Upload completed appraisal PDFs → system extracts sections → assigns to form type and section ID → stores as approved examples in knowledge base.
- **Result:** Future generation retrieves these approved examples for voice matching.

### Memory Management
- **Tab:** Memory
- **Action:** Review stored examples. Check retrieval health. Prune stale or weak examples.
- **Result:** Knowledge base quality improves. Retrieval returns more relevant examples.

### Business Operations
- **Tab:** Case (business section)
- **Action:** Create quote → convert to engagement → track pipeline stage → generate invoice → send communication.
- **Result:** Assignment lifecycle is managed without external tracking tools.

### Backup / Restore
- **Action:** Schedule or trigger backup. Verify backup integrity. Test restore on clean machine.
- **Result:** All case data, knowledge base, and settings can be recovered from backup.

---

## Flow Completion Standard

A flow is considered **complete** when:

1. A real or realistic assignment can be processed from step 1 through the final step without leaving CACC Writer for any core operation.
2. Every failure produces a visible, actionable status message — not a silent state.
3. The appraiser retains final judgment on all valuation decisions throughout.
4. The final archived case includes full provenance for every fact, section, and valuation element.
5. The assignment can be completed with less friction than the appraiser's current outside-the-system workflow.
