# Design System Strategy: The Golden Ratio Archive

## 1. Overview & Creative North Star: "The Digital Ledger"
This design system moves beyond the cold, utilitarian nature of traditional B2B SaaS to create **The Digital Ledger**. In the world of real estate appraisal, authority and precision are everything. We are moving away from "generic dashboard" layouts toward an editorial, high-density experience that mirrors a premium financial terminal.

**The Creative North Star** is characterized by:
*   **Asymmetric Precision:** Using the 16-point spacing scale to create intentional "breathing gaps" that draw the eye to critical valuation data.
*   **Deep-Layered Sophistication:** Moving away from flat surfaces to a world of stacked obsidian and gold.
*   **Tactile Authority:** High-contrast typography paired with "Ghost Borders" to make the interface feel like a custom-tooled physical instrument.

---

## 2. Colors: Obsidian & Gilded Light
We utilize a strict dark-mode palette where depth is communicated through luminance rather than lines.

### The "No-Line" Rule
Explicitly prohibit the use of 1px solid borders for structural sectioning. Boundaries between the sidebar, main content, and utility panels must be defined by shifts between `surface` (#10141a) and `surface-container-low` (#181c22). If two areas touch, their background tokens must be at least one tier apart.

### Surface Hierarchy & Nesting
*   **Base Layer:** `surface` (#10141a) - The canvas.
*   **Primary Containers:** `surface-container-low` (#181c22) - For main content areas.
*   **Actionable Cards:** `surface-container` (#1c2026) - For interactive elements.
*   **Popovers/Modals:** `surface-container-highest` (#31353c) - The peak of the z-index.

### The "Glass & Gradient" Rule
Floating elements (like Tooltips or Floating Action Buttons) must use a `backdrop-blur` of 12px combined with `surface-variant` at 60% opacity. For CTAs, we bypass flat gold for a signature **"Aureate Gradient"**: `linear-gradient(135deg, #e2b714 0%, #ffd341 100%)`. This provides a metallic "soul" that feels earned, not just colored.

---

## 3. Typography: The Editorial Scale
We use **Inter** as a variable font, leaning heavily into its ink-trap qualities for high-density data.

*   **Display (Display-LG to SM):** Reserved for high-level market trends or hero valuation numbers. Use `letter-spacing: -0.04em` and `font-weight: 700`.
*   **Headline (Headline-LG to SM):** Used for section titles. These should always be `on-surface` (#dfe2eb) to command attention.
*   **Body (Body-LG to SM):** Our workhorse. `body-md` (0.875rem) is the standard for appraisal notes. Use `on-secondary-container` (#b0b9c4) for better readability over long periods.
*   **Label (Label-MD to SM):** All-caps, `letter-spacing: 0.08em`, and `font-weight: 600`. Use these for metadata tags and table headers to create a "technical manual" aesthetic.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are forbidden. We use **Tonal Stacking** to create a three-dimensional environment.

*   **The Layering Principle:** Place a `surface-container-lowest` card inside a `surface-container-high` section. This creates a "recessed" look, perfect for data input fields.
*   **Ambient Shadows:** For floating modals, use a shadow with a 40px blur, 0px spread, and 6% opacity, using the `primary-fixed-variant` (#574500) as the shadow color. This creates a warm, golden "glow" rather than a dirty grey shadow.
*   **The Ghost Border:** For accessibility in cards, use a 1px border with `outline-variant` (#4d4633) at **20% opacity**. It should be felt, not seen.

---

## 5. Components: Precision Primitives

### Buttons (The Kinetic Pill)
*   **Primary:** Pill-shaped (999px). Aureate Gradient background. Text: #111. 
*   **Secondary:** Ghost style. Transparent background, `outline-variant` Ghost Border. 
*   **Interaction:** On hover, primary buttons should have a `box-shadow` of 0 0 20px `rgba(226, 183, 20, 0.3)`.

### Cards & Lists (The Divider-Free Rule)
Forbid the use of divider lines. To separate list items:
1.  Use `8px` of vertical whitespace.
2.  Apply a subtle background shift on hover to `surface-bright` (#353940).
3.  Use a `2px` left-accent bar in `primary` (#ffd341) for selected items.

### Appraisal Input Fields
Text inputs should not have a four-sided border. Use a "Bottom-Line Only" approach or a solid `surface-container-lowest` background with a 1px `primary` bottom border that illuminates (glows) only on focus.

### Data Chips
Use `secondary-container` (#414a53) for backgrounds with `label-sm` text. Radius must be `sm` (0.5rem) to maintain the "technical tool" look—avoid pill shapes for chips to differentiate them from buttons.

---

## 6. Do's and Don'ts

### Do
*   **DO** use whitespace as a separator. If you feel the need for a line, add 16px of space instead.
*   **DO** use `primary-fixed-dim` (#eec224) for secondary data points that need emphasis but aren't the primary action.
*   **DO** lean into asymmetry. Aligning a large Headline-LG to the left with a small Label-MD metadata point floating to the far right creates a premium "editorial" feel.

### Don't
*   **DON'T** use pure white (#ffffff). It causes eye strain in dark mode. Always use `on-surface` (#dfe2eb).
*   **DON'T** use standard 4px border radii. This system demands the "Soft-Pro" look of `1rem` (DEFAULT) or `1.5rem` (MD).
*   **DON'T** use 100% opaque borders. High-contrast lines "trap" the eye and make the software feel dated and boxed-in.