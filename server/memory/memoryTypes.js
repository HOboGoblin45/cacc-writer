/**
 * server/memory/memoryTypes.js
 * ------------------------------
 * Phase 6 — Memory, Voice, and Proprietary Writing Engine
 *
 * JSDoc type definitions for all Phase 6 data shapes.
 * These are the canonical object shapes used across the memory system.
 *
 * No runtime code — pure type documentation.
 */

// ── Approved Memory ─────────────────────────────────────────────────────────

/**
 * @typedef {'approved_narrative'|'approved_edit'|'curated'|'imported'|'generated'|'voice_exemplar'|'phrase'|'comp_commentary'} MemorySourceType
 */

/**
 * @typedef {'narrative_section'|'section_fragment'|'phrase_bank'|'comp_commentary'|'certification_pattern'|'addendum_pattern'|'special_case'|'voice_exemplar'} MemoryBucketType
 */

/**
 * @typedef {'pending'|'approved'|'rejected'|'archived'} ApprovalStatus
 */

/**
 * @typedef {Object} ApprovedMemoryItem
 * @property {string}  id                    — UUID primary key
 * @property {MemoryBucketType} bucket       — memory bucket classification
 * @property {MemorySourceType} sourceType   — how this item entered the system
 * @property {string}  text                  — the approved narrative/phrase text
 * @property {string}  textHash              — SHA-256 hash for dedup (first 16 chars)
 *
 * @property {string|null}  sourceDocumentId — case_documents.id if from extraction
 * @property {string|null}  sourceRunId      — generation_runs.id if from generation
 * @property {string|null}  sourceSectionId  — section_id within a run
 * @property {string|null}  caseId           — originating case (null = global)
 *
 * @property {string|null}  reportFamily     — e.g. 'residential_1004', 'commercial'
 * @property {string|null}  formType         — e.g. '1004', 'commercial'
 * @property {string|null}  propertyType     — e.g. 'single_family', 'condo', 'office'
 * @property {string|null}  assignmentType   — e.g. 'purchase', 'refinance'
 * @property {string|null}  canonicalFieldId — e.g. 'neighborhood_description'
 * @property {string|null}  sectionGroup     — e.g. 'neighborhood', 'improvements'
 *
 * @property {string|null}  marketType       — 'urban'|'suburban'|'rural'
 * @property {string|null}  county           — geographic context
 * @property {string|null}  city             — geographic context
 * @property {string|null}  state            — geographic context
 * @property {string|null}  loanProgram      — 'conventional'|'fha'|'va'|'usda'
 * @property {string|null}  subjectCondition — UAD condition rating C1-C6
 *
 * @property {string[]}     styleTags        — e.g. ['concise', 'formal', 'rural_market']
 * @property {string[]}     issueTags        — e.g. ['flood_zone', 'mixed_use', 'no_comps']
 * @property {number}       qualityScore     — 0-100 quality/confidence rating
 * @property {ApprovalStatus} approvalStatus — approval workflow state
 * @property {string|null}  approvalTimestamp
 * @property {string|null}  approvedBy       — user identifier
 * @property {string|null}  provenanceNote   — free-text provenance description
 * @property {string|null}  notes            — user notes
 * @property {boolean}      active           — soft delete / deactivation flag
 * @property {boolean}      pinned           — user-pinned for priority retrieval
 *
 * @property {string}  createdAt
 * @property {string}  updatedAt
 */

// ── Voice Profile ───────────────────────────────────────────────────────────

/**
 * @typedef {'global'|'report_family'|'canonical_field'} VoiceProfileScope
 */

/**
 * @typedef {Object} VoiceProfile
 * @property {string}  id                    — UUID primary key
 * @property {string}  name                  — display name (e.g. 'Global Voice', '1004 Voice')
 * @property {VoiceProfileScope} scope       — scope level
 * @property {string|null}  reportFamily     — null for global scope
 * @property {string|null}  canonicalFieldId — null for global/report_family scope
 *
 * @property {string|null}  tone             — e.g. 'professional', 'formal', 'concise'
 * @property {string|null}  sentenceLength   — e.g. 'short', 'medium', 'long'
 * @property {string|null}  hedgingDegree    — e.g. 'minimal', 'moderate', 'heavy'
 * @property {string|null}  terminologyPreference — e.g. 'technical', 'plain', 'mixed'
 * @property {string|null}  reconciliationStyle   — e.g. 'bracket_range', 'point_value', 'weighted'
 * @property {string|null}  sectionOpeningStyle   — e.g. 'direct', 'contextual', 'formulaic'
 * @property {string|null}  sectionClosingStyle   — e.g. 'summary', 'transition', 'none'
 *
 * @property {string[]}     preferredPhrases      — phrases the appraiser likes to use
 * @property {string[]}     forbiddenPhrases      — generic AI phrases to avoid
 * @property {string[]}     phrasingPatterns       — recurring sentence patterns
 *
 * @property {Object}       customDimensions      — extensible key-value for future dimensions
 * @property {boolean}      active
 * @property {string}       createdAt
 * @property {string}       updatedAt
 */

/**
 * @typedef {Object} VoiceRule
 * @property {string}  id                    — UUID primary key
 * @property {string}  profileId             — voice_profiles.id
 * @property {string}  ruleType              — 'prefer'|'avoid'|'pattern'|'opening'|'closing'|'terminology'
 * @property {string}  ruleValue             — the actual rule text/pattern
 * @property {number}  priority              — ordering within same type (higher = more important)
 * @property {string|null}  canonicalFieldId — field-specific rule (null = applies to all)
 * @property {string|null}  notes
 * @property {boolean} active
 * @property {string}  createdAt
 */

// ── Comparable Commentary Memory ────────────────────────────────────────────

/**
 * @typedef {Object} CompCommentaryMemoryItem
 * @property {string}  id                    — UUID primary key
 * @property {string}  text                  — the approved commentary text
 * @property {string}  textHash              — SHA-256 hash for dedup
 * @property {string}  commentaryType        — 'comp_selection'|'location_adj'|'gla_adj'|'age_adj'|
 *                                              'condition_adj'|'reconciliation'|'comp_set_strength'|
 *                                              'no_perfect_comps'|'rural_market'|'mixed_use'|'general'
 *
 * @property {string|null}  subjectPropertyType  — e.g. 'single_family', 'zero_lot_line'
 * @property {string|null}  compPropertyType     — e.g. 'single_family'
 * @property {string|null}  marketDensity        — 'dense'|'moderate'|'sparse'
 * @property {string|null}  urbanSuburbanRural   — 'urban'|'suburban'|'rural'
 * @property {string|null}  reportFamily
 * @property {string|null}  formType
 * @property {string|null}  canonicalFieldId
 *
 * @property {string[]}     issueTags            — e.g. ['no_comps', 'large_adj', 'dated_sales']
 * @property {string[]}     adjustmentCategories — e.g. ['GLA', 'Age', 'Condition']
 * @property {number}       qualityScore         — 0-100
 * @property {ApprovalStatus} approvalStatus
 * @property {string|null}  approvedBy
 * @property {string|null}  sourceDocumentId
 * @property {string|null}  sourceRunId
 * @property {string|null}  caseId
 * @property {string|null}  provenanceNote
 * @property {boolean}      active
 * @property {boolean}      pinned
 * @property {string}       createdAt
 * @property {string}       updatedAt
 */

// ── Retrieval Types ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} RetrievalQuery
 * @property {string}       canonicalFieldId     — target section/field
 * @property {string|null}  reportFamily
 * @property {string|null}  formType
 * @property {string|null}  propertyType
 * @property {string|null}  assignmentType
 * @property {string|null}  loanProgram
 * @property {string|null}  marketType
 * @property {string|null}  county
 * @property {string|null}  city
 * @property {string|null}  subjectCondition
 * @property {string[]}     issueTags            — flags/issues from intelligence bundle
 * @property {string[]}     styleTags            — desired style characteristics
 * @property {string|null}  bucketFilter         — restrict to specific bucket type
 * @property {number}       maxResults           — max candidates to return
 */

/**
 * @typedef {Object} RetrievalScoreBreakdown
 * @property {number}  totalScore
 * @property {Object}  dimensionScores          — { reportFamily: 20, canonicalField: 30, ... }
 * @property {number}  sourceTrustBonus
 * @property {number}  qualityBonus
 * @property {number}  recencyBonus
 * @property {number}  pinnedBonus
 * @property {number}  tagOverlapScore
 * @property {number}  textSimilarityScore      — secondary signal (0 if not computed)
 * @property {string[]} matchReasons            — human-readable reasons for ranking
 */

/**
 * @typedef {Object} RetrievalCandidate
 * @property {string}  id                       — memory item ID
 * @property {string}  text                     — the memory text
 * @property {string}  bucket                   — memory bucket type
 * @property {string}  sourceType               — memory source type
 * @property {RetrievalScoreBreakdown} score    — full score breakdown
 * @property {Object}  metadata                 — relevant metadata from the memory item
 */

/**
 * @typedef {Object} RetrievalPack
 * @property {string}       canonicalFieldId
 * @property {string}       caseId
 * @property {string}       formType
 *
 * @property {Object}       assignmentContextSummary  — compact context for generation
 * @property {Object}       reportFamilyContext        — report family + canonical field info
 *
 * @property {RetrievalCandidate[]} approvedExamples   — ranked approved memory examples
 * @property {RetrievalCandidate[]} phraseBank         — relevant phrase bank items
 * @property {RetrievalCandidate[]} compCommentary     — relevant comp commentary (if applicable)
 *
 * @property {Object|null}  voiceProfileHints          — resolved voice profile for this section
 * @property {string[]}     disallowedPhrases          — phrases to avoid
 * @property {string[]}     preferredPhrases           — phrases to prefer
 *
 * @property {Object}       provenanceMetadata         — debug info about retrieval
 * @property {string[]}     selectionRationale         — why each item was selected
 *
 * @property {number}       totalCandidatesScanned
 * @property {number}       totalCandidatesSelected
 * @property {number}       retrievalMs
 * @property {string}       builtAt
 */

/**
 * @typedef {Object} RetrievalPackBundle
 * @property {string}       caseId
 * @property {string}       assignmentId
 * @property {string}       formType
 * @property {Object.<string, RetrievalPack>} sections  — keyed by canonicalFieldId
 * @property {Object}       globalVoiceProfile          — resolved global voice profile
 * @property {number}       totalMemoryScanned
 * @property {number}       totalSelected
 * @property {number}       retrievalMs
 * @property {boolean}      fromCache
 * @property {string}       builtAt
 */

// ── Memory Staging ──────────────────────────────────────────────────────────

/**
 * @typedef {'approve'|'reject'|'edit_approve'|'tag'|'assign_field'|'assign_family'|'promote'} MemoryCandidateAction
 */

/**
 * @typedef {Object} MemoryCandidateReviewAction
 * @property {string}  candidateId              — staged item ID
 * @property {MemoryCandidateAction} action
 * @property {string|null}  editedText          — for 'edit_approve' action
 * @property {string|null}  targetBucket        — for 'promote' action
 * @property {string|null}  canonicalFieldId    — for 'assign_field' action
 * @property {string|null}  reportFamily        — for 'assign_family' action
 * @property {string[]}     tags                — for 'tag' action
 * @property {string|null}  notes
 * @property {string|null}  reviewedBy
 */

/**
 * @typedef {Object} PhraseBankItem
 * @property {string}  id
 * @property {string}  text
 * @property {string}  tag                      — category tag
 * @property {string|null}  canonicalFieldId
 * @property {string|null}  formType
 * @property {number}  qualityScore
 * @property {boolean} active
 */

/**
 * @typedef {Object} VoiceExemplar
 * @property {string}  id
 * @property {string}  memoryItemId             — approved_memory.id
 * @property {string}  text
 * @property {string|null}  canonicalFieldId
 * @property {string|null}  reportFamily
 * @property {string[]}     voiceDimensions     — which voice dimensions this exemplifies
 * @property {number}  qualityScore
 * @property {boolean} active
 */

export default {};
