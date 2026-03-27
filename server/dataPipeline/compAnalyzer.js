/**
 * server/dataPipeline/compAnalyzer.js
 * Comparable sales analysis engine.
 * Computes adjustments, reconciliation ranges, and narrative-ready analytics.
 */

/** @typedef {{ address: string, pricePerSqft: number }} PricePerSqftEntry */
/** @typedef {{ feature: string, comp1: number, comp2: number, impliedAdjustment: number, confidence: number }} PairedSalesResult */
/** @typedef {{ compIndex: number, adjustments: object, netAdjPct: number, grossAdjPct: number, adjustedPrice: number }} AdjustmentGridRow */
/** @typedef {{ compIndex: number, reason: string, severity: 'warning'|'critical' }} OutlierFlag */

/**
 * Typical adjustment rates used when paired-sales data is insufficient.
 * All values in USD unless noted.
 * @private
 */
const DEFAULT_RATES = {
  glaPerSqft: null,           // derived from comps at runtime
  agePerYear: 750,            // midpoint of $500-1000
  conditionPerStep: 10000,    // midpoint of $5000-15000
  qualityPerStep: 15000,      // midpoint of $10000-20000
  basementFinishedPerSqft: 30,  // midpoint of $25-35
  basementUnfinishedPerSqft: 12, // midpoint of $10-15
  garagePerCar: 7500,         // midpoint of $5000-10000
  fullBathEach: 7500,         // midpoint of $5000-10000
  halfBathEach: 4000,         // midpoint of $3000-5000
};

/**
 * Map condition rating strings to numeric scale.
 * C1 = best (6), C6 = worst (1).
 * @param {string|number} rating
 * @returns {number}
 * @private
 */
function conditionToNumeric(rating) {
  if (typeof rating === 'number') return rating;
  const str = String(rating).toUpperCase().trim();
  const map = { C1: 6, C2: 5, C3: 4, C4: 3, C5: 2, C6: 1 };
  return map[str] ?? 3;
}

/**
 * Map quality rating strings to numeric scale.
 * Q1 = best (6), Q6 = worst (1).
 * @param {string|number} rating
 * @returns {number}
 * @private
 */
function qualityToNumeric(rating) {
  if (typeof rating === 'number') return rating;
  const str = String(rating).toUpperCase().trim();
  const map = { Q1: 6, Q2: 5, Q3: 4, Q4: 3, Q5: 2, Q6: 1 };
  return map[str] ?? 3;
}

/**
 * Calculate the median of a numeric array.
 * @param {number[]} arr
 * @returns {number}
 * @private
 */
function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Calculate arithmetic mean.
 * @param {number[]} arr
 * @returns {number}
 * @private
 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Safely read a nested numeric property, returning a fallback when missing.
 * @param {object} obj
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 * @private
 */
function num(obj, key, fallback = 0) {
  const val = obj?.[key];
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a date value into a Date object.
 * @param {string|number|Date} val
 * @returns {Date|null}
 * @private
 */
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a dollar amount for narrative text.
 * @param {number} amount
 * @returns {string}
 * @private
 */
function formatDollars(amount) {
  const rounded = Math.round(amount);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(rounded);
}

export class CompAnalyzer {
  /**
   * @param {object} subjectData - Subject property ADM data
   * @param {Array<object>} compsData - Array of comp ADM data objects
   */
  constructor(subjectData, compsData) {
    if (!subjectData || typeof subjectData !== 'object') {
      throw new Error('subjectData must be a non-null object');
    }
    if (!Array.isArray(compsData) || compsData.length === 0) {
      throw new Error('compsData must be a non-empty array');
    }
    /** @type {object} */
    this.subject = subjectData;
    /** @type {Array<object>} */
    this.comps = compsData;

    // Derive GLA $/sqft rate from comps for use in adjustments
    this._glaRate = this._deriveGlaRate();
  }

  /**
   * Derive a per-sqft rate from comp sale prices and GLA.
   * @returns {number}
   * @private
   */
  _deriveGlaRate() {
    const rates = this.comps
      .map((c) => {
        const price = num(c, 'salePrice') || num(c, 'closePrice') || num(c, 'listPrice');
        const gla = num(c, 'gla') || num(c, 'grossLivingArea') || num(c, 'sqft');
        return gla > 0 && price > 0 ? price / gla : null;
      })
      .filter((v) => v !== null);
    return rates.length > 0 ? median(rates) : 100; // fallback $100/sqft
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Calculate $/sqft for each comp and statistics.
   * @returns {{ comps: Array<PricePerSqftEntry>, min: number, max: number, median: number, mean: number }}
   */
  pricePerSqftAnalysis() {
    const entries = this.comps.map((c) => {
      const price = num(c, 'salePrice') || num(c, 'closePrice') || num(c, 'listPrice');
      const gla = num(c, 'gla') || num(c, 'grossLivingArea') || num(c, 'sqft');
      const address = c.address || c.streetAddress || 'Unknown';
      const pricePerSqft = gla > 0 ? Math.round((price / gla) * 100) / 100 : 0;
      return { address, pricePerSqft };
    });

    const values = entries.map((e) => e.pricePerSqft).filter((v) => v > 0);

    return {
      comps: entries,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      median: median(values),
      mean: Math.round(mean(values) * 100) / 100,
    };
  }

  /**
   * Paired sales analysis: identify comp pairs differing in one feature
   * to derive market-supported adjustments.
   * @returns {Array<PairedSalesResult>}
   */
  pairedSalesAnalysis() {
    const features = [
      'bedrooms', 'bathrooms', 'gla', 'grossLivingArea', 'sqft',
      'garageSpaces', 'garageCars', 'yearBuilt', 'condition', 'quality',
      'basementSqft', 'basementFinishedSqft', 'lotSize', 'lotSizeSqft',
    ];

    /** @type {Array<PairedSalesResult>} */
    const results = [];

    for (let i = 0; i < this.comps.length; i++) {
      for (let j = i + 1; j < this.comps.length; j++) {
        const a = this.comps[i];
        const b = this.comps[j];

        const priceA = num(a, 'salePrice') || num(a, 'closePrice') || num(a, 'listPrice');
        const priceB = num(b, 'salePrice') || num(b, 'closePrice') || num(b, 'listPrice');
        if (priceA <= 0 || priceB <= 0) continue;

        // For each feature, check if these two comps differ ONLY in that feature
        for (const feat of features) {
          const valA = num(a, feat);
          const valB = num(b, feat);
          if (valA === valB) continue; // no difference in this feature

          // Count how many OTHER features differ
          let otherDiffs = 0;
          for (const other of features) {
            if (other === feat) continue;
            if (num(a, other) !== num(b, other)) otherDiffs++;
          }

          // Accept pairs with at most 2 other differing features
          if (otherDiffs <= 2) {
            const diff = valA - valB;
            const priceDiff = priceA - priceB;
            const impliedAdjustment = diff !== 0 ? Math.round(priceDiff / diff) : 0;
            // Confidence: perfect pair = 1.0, one other diff = 0.7, two other diffs = 0.4
            const confidence = otherDiffs === 0 ? 1.0 : otherDiffs === 1 ? 0.7 : 0.4;

            results.push({
              feature: feat,
              comp1: i,
              comp2: j,
              impliedAdjustment,
              confidence,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Generate full adjustment grid with calculated adjustments.
   * Standard adjustment categories: location, site/view, design/style, quality,
   * age, condition, GLA, basement, garage, porch/patio/deck, etc.
   * @returns {{ grid: Array<AdjustmentGridRow> }}
   */
  generateAdjustmentGrid() {
    // Attempt to refine rates using paired sales
    const paired = this.pairedSalesAnalysis();
    const pairedRates = this._buildPairedRateMap(paired);

    const subjectGla = num(this.subject, 'gla') || num(this.subject, 'grossLivingArea') || num(this.subject, 'sqft');
    const subjectAge = this._effectiveAge(this.subject);
    const subjectCondition = conditionToNumeric(this.subject.condition);
    const subjectQuality = qualityToNumeric(this.subject.quality);
    const subjectBasementFinished = num(this.subject, 'basementFinishedSqft');
    const subjectBasementUnfinished = num(this.subject, 'basementSqft') - subjectBasementFinished;
    const subjectGarage = num(this.subject, 'garageSpaces') || num(this.subject, 'garageCars');
    const subjectFullBaths = num(this.subject, 'fullBathrooms') || num(this.subject, 'bathsFull');
    const subjectHalfBaths = num(this.subject, 'halfBathrooms') || num(this.subject, 'bathsHalf');
    const subjectPorchDeck = num(this.subject, 'porchSqft') || num(this.subject, 'deckSqft') || num(this.subject, 'patioSqft');
    const subjectBedrooms = num(this.subject, 'bedrooms');

    const grid = this.comps.map((comp, idx) => {
      const salePrice = num(comp, 'salePrice') || num(comp, 'closePrice') || num(comp, 'listPrice');

      // Feature values for this comp
      const compGla = num(comp, 'gla') || num(comp, 'grossLivingArea') || num(comp, 'sqft');
      const compAge = this._effectiveAge(comp);
      const compCondition = conditionToNumeric(comp.condition);
      const compQuality = qualityToNumeric(comp.quality);
      const compBasementFinished = num(comp, 'basementFinishedSqft');
      const compBasementUnfinished = num(comp, 'basementSqft') - compBasementFinished;
      const compGarage = num(comp, 'garageSpaces') || num(comp, 'garageCars');
      const compFullBaths = num(comp, 'fullBathrooms') || num(comp, 'bathsFull');
      const compHalfBaths = num(comp, 'halfBathrooms') || num(comp, 'bathsHalf');
      const compPorchDeck = num(comp, 'porchSqft') || num(comp, 'deckSqft') || num(comp, 'patioSqft');
      const compBedrooms = num(comp, 'bedrooms');

      // ---------- Calculate individual adjustments ----------
      // Convention: positive adjustment = comp is inferior, subject is superior
      //             negative adjustment = comp is superior, subject is inferior

      const adjustments = {};

      // GLA adjustment
      const glaRate = pairedRates.gla ?? pairedRates.grossLivingArea ?? pairedRates.sqft ?? this._glaRate;
      const glaDiff = subjectGla - compGla;
      adjustments.gla = Math.round(glaDiff * glaRate);

      // Age adjustment (newer = better, so positive diff means subject is newer)
      const ageRate = pairedRates.yearBuilt ?? DEFAULT_RATES.agePerYear;
      const ageDiff = compAge - subjectAge; // comp older -> positive adjustment
      adjustments.age = Math.round(ageDiff * ageRate);

      // Condition adjustment (higher numeric = better)
      const condRate = pairedRates.condition ?? DEFAULT_RATES.conditionPerStep;
      const condDiff = subjectCondition - compCondition;
      adjustments.condition = Math.round(condDiff * condRate);

      // Quality adjustment (higher numeric = better)
      const qualRate = pairedRates.quality ?? DEFAULT_RATES.qualityPerStep;
      const qualDiff = subjectQuality - compQuality;
      adjustments.quality = Math.round(qualDiff * qualRate);

      // Basement - finished area
      const bsmtFinDiff = subjectBasementFinished - compBasementFinished;
      adjustments.basementFinished = Math.round(
        bsmtFinDiff * (pairedRates.basementFinishedSqft ?? DEFAULT_RATES.basementFinishedPerSqft)
      );

      // Basement - unfinished area
      const bsmtUnfinDiff = Math.max(0, subjectBasementUnfinished) - Math.max(0, compBasementUnfinished);
      adjustments.basementUnfinished = Math.round(
        bsmtUnfinDiff * DEFAULT_RATES.basementUnfinishedPerSqft
      );

      // Garage
      const garageDiff = subjectGarage - compGarage;
      adjustments.garage = Math.round(
        garageDiff * (pairedRates.garageSpaces ?? pairedRates.garageCars ?? DEFAULT_RATES.garagePerCar)
      );

      // Bathrooms
      const fullBathDiff = subjectFullBaths - compFullBaths;
      adjustments.fullBathrooms = Math.round(fullBathDiff * DEFAULT_RATES.fullBathEach);

      const halfBathDiff = subjectHalfBaths - compHalfBaths;
      adjustments.halfBathrooms = Math.round(halfBathDiff * DEFAULT_RATES.halfBathEach);

      // Bedrooms (modest adjustment, typically $2000-5000)
      const bedDiff = subjectBedrooms - compBedrooms;
      adjustments.bedrooms = Math.round(bedDiff * 3000);

      // Porch / Patio / Deck
      const porchDiff = subjectPorchDeck - compPorchDeck;
      adjustments.porchPatioDeck = Math.round(porchDiff * 20); // ~$20/sqft typical

      // Location (placeholder - use paired sales if available, else 0)
      adjustments.location = 0;

      // Site / View (placeholder)
      adjustments.siteView = 0;

      // Design / Style (placeholder)
      adjustments.designStyle = 0;

      // ---------- Summary calculations ----------
      const adjValues = Object.values(adjustments);
      const netAdj = adjValues.reduce((s, v) => s + v, 0);
      const grossAdj = adjValues.reduce((s, v) => s + Math.abs(v), 0);
      const netAdjPct = salePrice > 0 ? Math.round((netAdj / salePrice) * 10000) / 100 : 0;
      const grossAdjPct = salePrice > 0 ? Math.round((grossAdj / salePrice) * 10000) / 100 : 0;
      const adjustedPrice = salePrice + netAdj;

      return {
        compIndex: idx,
        adjustments,
        netAdjPct,
        grossAdjPct,
        adjustedPrice,
      };
    });

    return { grid };
  }

  /**
   * Calculate adjusted sale prices and reconciliation range.
   * @returns {{ low: number, high: number, mean: number, median: number, indicated: number, reconciliationNarrative: string }}
   */
  reconciliationRange() {
    const { grid } = this.generateAdjustmentGrid();
    const adjustedPrices = grid.map((r) => r.adjustedPrice).filter((p) => p > 0);

    if (adjustedPrices.length === 0) {
      return {
        low: 0,
        high: 0,
        mean: 0,
        median: 0,
        indicated: 0,
        reconciliationNarrative: 'Insufficient data to derive a reconciliation range.',
      };
    }

    const low = Math.min(...adjustedPrices);
    const high = Math.max(...adjustedPrices);
    const meanVal = Math.round(mean(adjustedPrices));
    const medianVal = Math.round(median(adjustedPrices));

    // Weight comps by inverse of gross adjustment percentage (less adjusted = more reliable)
    const outliers = this.flagOutliers();
    const outlierIndices = new Set(outliers.filter((o) => o.severity === 'critical').map((o) => o.compIndex));

    let weightedSum = 0;
    let weightTotal = 0;

    for (const row of grid) {
      if (outlierIndices.has(row.compIndex)) continue; // skip critical outliers
      const weight = row.grossAdjPct > 0 ? 1 / (1 + row.grossAdjPct / 100) : 1;
      weightedSum += row.adjustedPrice * weight;
      weightTotal += weight;
    }

    const indicated = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : meanVal;

    // Build narrative
    const range = formatDollars(high - low);
    const narrative = [
      `The adjusted sale prices of the comparable sales range from ${formatDollars(low)} to ${formatDollars(high)}, a spread of ${range}.`,
      `The mean adjusted price is ${formatDollars(meanVal)} and the median is ${formatDollars(medianVal)}.`,
    ];

    if (outliers.length > 0) {
      const criticalCount = outliers.filter((o) => o.severity === 'critical').length;
      if (criticalCount > 0) {
        narrative.push(
          `${criticalCount} comparable sale(s) exhibited significant adjustment disparities and were given reduced weight in the reconciliation.`
        );
      }
    }

    narrative.push(
      `After weighting the comparables by overall adjustment magnitude, the indicated value via the Sales Comparison Approach is ${formatDollars(indicated)}.`
    );

    return {
      low,
      high,
      mean: meanVal,
      median: medianVal,
      indicated,
      reconciliationNarrative: narrative.join(' '),
    };
  }

  /**
   * Flag comps that may not be truly comparable (outliers).
   * Criteria: adjusted price >15% from mean, gross adj >25%, net adj >15%, etc.
   * @returns {Array<OutlierFlag>}
   */
  flagOutliers() {
    const { grid } = this.generateAdjustmentGrid();
    const adjustedPrices = grid.map((r) => r.adjustedPrice);
    const meanPrice = mean(adjustedPrices);

    /** @type {Array<OutlierFlag>} */
    const flags = [];

    for (const row of grid) {
      // Adjusted price deviates >15% from mean
      if (meanPrice > 0) {
        const deviation = Math.abs(row.adjustedPrice - meanPrice) / meanPrice;
        if (deviation > 0.15) {
          flags.push({
            compIndex: row.compIndex,
            reason: `Adjusted price deviates ${(deviation * 100).toFixed(1)}% from mean (${formatDollars(row.adjustedPrice)} vs ${formatDollars(meanPrice)})`,
            severity: deviation > 0.25 ? 'critical' : 'warning',
          });
        }
      }

      // Gross adjustment >25%
      if (Math.abs(row.grossAdjPct) > 25) {
        flags.push({
          compIndex: row.compIndex,
          reason: `Gross adjustment of ${row.grossAdjPct.toFixed(1)}% exceeds 25% threshold`,
          severity: Math.abs(row.grossAdjPct) > 35 ? 'critical' : 'warning',
        });
      }

      // Net adjustment >15%
      if (Math.abs(row.netAdjPct) > 15) {
        flags.push({
          compIndex: row.compIndex,
          reason: `Net adjustment of ${row.netAdjPct.toFixed(1)}% exceeds 15% threshold`,
          severity: Math.abs(row.netAdjPct) > 25 ? 'critical' : 'warning',
        });
      }

      // Sale price is zero or missing
      const salePrice = num(this.comps[row.compIndex], 'salePrice')
        || num(this.comps[row.compIndex], 'closePrice')
        || num(this.comps[row.compIndex], 'listPrice');
      if (salePrice <= 0) {
        flags.push({
          compIndex: row.compIndex,
          reason: 'No valid sale price found for this comparable',
          severity: 'critical',
        });
      }
    }

    return flags;
  }

  /**
   * Generate narrative text describing comp selection rationale.
   * @returns {string} Narrative suitable for the Sales Comparison Approach section
   */
  generateCompSelectionNarrative() {
    const subjectGla = num(this.subject, 'gla') || num(this.subject, 'grossLivingArea') || num(this.subject, 'sqft');
    const subjectCity = this.subject.city || this.subject.market || 'the subject area';
    const subjectAge = this._effectiveAge(this.subject);

    const parts = [];

    parts.push(
      `A search of the local MLS and public records was conducted to identify the most comparable recent sales to the subject property.`
    );

    parts.push(
      `${this.comps.length} comparable sale(s) were selected based on proximity, similarity in physical characteristics, and market conditions.`
    );

    // Proximity
    const distances = this.comps.map((c) => num(c, 'distanceMiles') || num(c, 'proximity')).filter((d) => d > 0);
    if (distances.length > 0) {
      const maxDist = Math.max(...distances);
      parts.push(
        `All comparables are located within ${maxDist.toFixed(1)} mile(s) of the subject in ${subjectCity}.`
      );
    }

    // GLA range
    const glas = this.comps.map((c) => num(c, 'gla') || num(c, 'grossLivingArea') || num(c, 'sqft')).filter((g) => g > 0);
    if (glas.length > 0 && subjectGla > 0) {
      const minGla = Math.min(...glas);
      const maxGla = Math.max(...glas);
      parts.push(
        `The comparables range in gross living area from ${minGla.toLocaleString()} to ${maxGla.toLocaleString()} square feet, bracketing the subject's ${subjectGla.toLocaleString()} square feet.`
      );
    }

    // Age range
    const ages = this.comps.map((c) => this._effectiveAge(c)).filter((a) => a > 0);
    if (ages.length > 0 && subjectAge > 0) {
      const minAge = Math.min(...ages);
      const maxAge = Math.max(...ages);
      parts.push(
        `Effective ages range from ${minAge} to ${maxAge} years, compared to the subject's effective age of ${subjectAge} years.`
      );
    }

    // Sale date range
    const saleDates = this.comps.map((c) => parseDate(c.saleDate) || parseDate(c.closeDate)).filter(Boolean);
    if (saleDates.length > 0) {
      saleDates.sort((a, b) => a.getTime() - b.getTime());
      const oldest = saleDates[0];
      const newest = saleDates[saleDates.length - 1];
      const monthsSpan = Math.round((newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24 * 30));
      parts.push(
        `Sale dates span a ${monthsSpan}-month period, with the most recent closing on ${newest.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`
      );
    }

    // Outlier notes
    const outliers = this.flagOutliers();
    if (outliers.length === 0) {
      parts.push(
        `All selected comparables required adjustments within acceptable ranges, supporting the reliability of the analysis.`
      );
    } else {
      const warningCount = outliers.filter((o) => o.severity === 'warning').length;
      const criticalCount = outliers.filter((o) => o.severity === 'critical').length;
      if (criticalCount > 0) {
        parts.push(
          `${criticalCount} comparable(s) required significant adjustments and were given less weight in the final reconciliation.`
        );
      }
      if (warningCount > 0) {
        parts.push(
          `${warningCount} comparable(s) required moderate adjustments but remain supportive of the value conclusion.`
        );
      }
    }

    return parts.join(' ');
  }

  /**
   * Market trend analysis from sale dates and prices.
   * @returns {{ trend: 'Increasing'|'Stable'|'Declining', annualChangePct: number, avgDOM: number, saleToListRatio: number }}
   */
  marketTrendAnalysis() {
    // Collect data points: { date, pricePerSqft, dom, saleToList }
    const dataPoints = this.comps.map((c) => {
      const salePrice = num(c, 'salePrice') || num(c, 'closePrice');
      const listPrice = num(c, 'listPrice');
      const gla = num(c, 'gla') || num(c, 'grossLivingArea') || num(c, 'sqft');
      const date = parseDate(c.saleDate) || parseDate(c.closeDate);
      const dom = num(c, 'daysOnMarket') || num(c, 'dom');

      return {
        date,
        pricePerSqft: gla > 0 && salePrice > 0 ? salePrice / gla : null,
        dom: dom > 0 ? dom : null,
        saleToList: salePrice > 0 && listPrice > 0 ? salePrice / listPrice : null,
      };
    });

    // Average DOM
    const doms = dataPoints.map((d) => d.dom).filter((v) => v !== null);
    const avgDOM = doms.length > 0 ? Math.round(mean(doms)) : 0;

    // Sale-to-list ratio
    const ratios = dataPoints.map((d) => d.saleToList).filter((v) => v !== null);
    const saleToListRatio = ratios.length > 0 ? Math.round(mean(ratios) * 10000) / 10000 : 0;

    // Trend via simple linear regression of $/sqft over time
    const dated = dataPoints.filter((d) => d.date && d.pricePerSqft !== null);

    if (dated.length < 2) {
      return { trend: 'Stable', annualChangePct: 0, avgDOM, saleToListRatio };
    }

    // Normalize dates to days since earliest
    dated.sort((a, b) => a.date.getTime() - b.date.getTime());
    const t0 = dated[0].date.getTime();
    const xs = dated.map((d) => (d.date.getTime() - t0) / (1000 * 60 * 60 * 24)); // days
    const ys = dated.map((d) => d.pricePerSqft);

    // Simple least-squares regression
    const n = xs.length;
    const sumX = xs.reduce((s, v) => s + v, 0);
    const sumY = ys.reduce((s, v) => s + v, 0);
    const sumXY = xs.reduce((s, v, i) => s + v * ys[i], 0);
    const sumX2 = xs.reduce((s, v) => s + v * v, 0);

    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // Annual change: slope * 365 days, as percentage of intercept
    const annualChangePct =
      intercept > 0
        ? Math.round(((slope * 365) / intercept) * 10000) / 100
        : 0;

    let trend = 'Stable';
    if (annualChangePct > 2) trend = 'Increasing';
    else if (annualChangePct < -2) trend = 'Declining';

    return { trend, annualChangePct, avgDOM, saleToListRatio };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate effective age for a property.
   * @param {object} prop
   * @returns {number}
   * @private
   */
  _effectiveAge(prop) {
    const effectiveAge = num(prop, 'effectiveAge');
    if (effectiveAge > 0) return effectiveAge;
    const yearBuilt = num(prop, 'yearBuilt');
    if (yearBuilt > 0) {
      return new Date().getFullYear() - yearBuilt;
    }
    return 0;
  }

  /**
   * Build a map of feature -> adjustment rate from paired sales results.
   * Uses the highest-confidence result for each feature.
   * @param {Array<PairedSalesResult>} pairedResults
   * @returns {Record<string, number>}
   * @private
   */
  _buildPairedRateMap(pairedResults) {
    /** @type {Record<string, {rate: number, confidence: number}>} */
    const best = {};

    for (const pr of pairedResults) {
      if (pr.confidence < 0.4) continue; // skip low confidence
      if (pr.impliedAdjustment === 0) continue;

      const existing = best[pr.feature];
      if (!existing || pr.confidence > existing.confidence) {
        best[pr.feature] = { rate: pr.impliedAdjustment, confidence: pr.confidence };
      }
    }

    /** @type {Record<string, number>} */
    const map = {};
    for (const [feat, { rate }] of Object.entries(best)) {
      map[feat] = Math.abs(rate); // rates should be positive magnitude
    }
    return map;
  }
}
