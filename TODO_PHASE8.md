# Phase 8: Professional Review Workspace and Workflow UX

## Implementation Progress

### Step 1: Design System Hardening (Deliverable 9)
- [ ] Extend `--gen-*` white editorial tokens to all tabs
- [ ] Standardize card, button, input, badge, chip styles globally
- [ ] Add consistent loading/empty/error state patterns
- [ ] Unify header/tab bar with editorial theme

### Step 2: Professional Workspace Shell (Deliverable 1)
- [ ] Redesign Facts tab with `--gen-*` theme
- [ ] Redesign Voice tab with `--gen-*` theme
- [ ] Redesign Intel tab with `--gen-*` theme
- [ ] Redesign Docs tab with `--gen-*` theme
- [ ] Redesign Memory tab with `--gen-*` theme
- [ ] Redesign QC tab with `--gen-*` theme

### Step 3: Section Review & Approval Workflow (Deliverable 4)
- [ ] Add section status lifecycle strip to output cards
- [ ] Add Approve/Review/Reject buttons to output cards
- [ ] Wire section status changes to backend PATCH endpoint
- [ ] Add batch Approve All / Insert All to command strip
- [ ] Add keyboard shortcuts for approve/reject

### Step 4: Generate/Review Workbench Enhancement (Deliverable 2)
- [ ] Enhance output card headers with status badges
- [ ] Add section-level action buttons (copy, approve, edit)
- [ ] Improve run progress visualization
- [ ] Add run history comparison view

### Step 5: QC Findings Triage Workspace (Deliverable 5)
- [ ] Redesign findings list with grouped views (severity/category/section)
- [ ] Add finding-to-section jump links
- [ ] Add batch dismiss/resolve actions
- [ ] Improve finding detail expansion with evidence display
- [ ] Add QC summary dashboard cards

### Step 6: Case Inspector / Assignment Intelligence Panel (Deliverable 3)
- [ ] Add collapsible intelligence sidecar to Case detail
- [ ] Show derived flags and compliance profile inline
- [ ] Show section plan summary
- [ ] Wire to intelligence build/get endpoints
- [ ] Show assignment completeness score

### Step 7: Document/Evidence/Provenance Sidecar (Deliverable 6)
- [ ] Add document provenance chips to facts display
- [ ] Add source document links in extracted facts
- [ ] Show extraction confidence inline

### Step 8: Memory/Retrieval Transparency Views (Deliverable 7)
- [ ] Improve retrieval pack visualization
- [ ] Show memory source attribution in output cards
- [ ] Add voice profile summary display

### Step 9: Review State Persistence & Session Continuity (Deliverable 8)
- [ ] Persist active tab in localStorage
- [ ] Persist filter states and scroll positions
- [ ] Track last-viewed case and auto-load on restart
- [ ] Restore session state on reload

### Step 10: Integration Testing
- [ ] Test all tabs render correctly with unified theme
- [ ] Test section approval workflow end-to-end
- [ ] Test QC findings triage
- [ ] Test session persistence across reloads
- [ ] Verify no regressions in existing functionality
