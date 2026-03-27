/**
 * normalizedDataModel.js
 * ----------------------
 * Personal Appraiser Voice Engine — Normalized Internal Fact Schema
 *
 * Defines the unified internal data model that all external data sources
 * must normalize into before being consumed by the AI and agents.
 *
 * ARCHITECTURE PRINCIPLE:
 *   The AI and agents consume NORMALIZED FACTS, not raw vendor payloads.
 *   Every external data source (public records, MLS, Zillow/Bridge, CoStar)
 *   must be normalized through this model before use.
 *
 * SUPPORTED SOURCE TYPES (current + future):
 *   publicRecord    — county assessor, recorder, PTAX data (Illinois priority)
 *   mlsRecord       — MLS listing data (provider-controlled, config-driven)
 *   zillowRecord    — Zillow/Bridge public records + listing data (optional)
 *   manualCompNote  — human-reviewed comp notes (appraiser-entered)
 *   costarNote      — limited CoStar excerpts (human-reviewed, licensed only)
 *
 * EXTERNAL DATA POLICY:
 *   - Public records: first external category to integrate deeply
 *   - MLS: provider-controlled access, configuration-driven (no RESO assumptions)
 *   - Zillow/Bridge: optional supplement, not sole source of truth
 *   - CoStar: restricted — manual note capture + limited licensed excerpts only
 *             Do NOT bulk-ingest CoStar without explicit licensed permission.
 *
 * ILLINOIS COVERAGE:
 *   Public records model is designed for Illinois statewide coverage:
 *   - PTAX-203 transfer declarations
 *   - County assessor parcel data
 *   - Recorder of deeds transfer history
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 */

// ── NormalizedFact shape ──────────────────────────────────────────────────────
// All normalizer functions return objects conforming to this shape.
// Fields marked REQUIRED must always be present (may be null if unknown).
// Fields marked OPTIONAL are omitted if not available from the source.

/**
 * @typedef {object} NormalizedFact
 * @property {string}      sourceType      REQUIRED — 'publicRecord'|'mlsRecord'|'zillowRecord'|'manualCompNote'|'costarNote'
 * @property {string}      sourceId        REQUIRED — unique identifier from the source system
 * @property {string}      fetchedAt       REQUIRED — ISO timestamp when data was retrieved
 * @property {string|null} parcelId        OPTIONAL — APN / parcel number
 * @property {string|null} address         OPTIONAL — full street address
 * @property {string|null} city            OPTIONAL
 * @property {string|null} county          OPTIONAL
 * @property {string|null} state           OPTIONAL
 * @property {string|null} zip             OPTIONAL
 * @property {number|null} saleAmount      OPTIONAL — most recent sale price
 * @property {string|null} saleDate        OPTIONAL — ISO date string
 * @property {string|null} transferDate    OPTIONAL — deed recording date
 * @property {string|null} grantor         OPTIONAL — seller name
 * @property {string|null} grantee         OPTIONAL — buyer name
 * @property {string|null} propertyUse     OPTIONAL — use code / property class
 * @property {number|null} assessedValue   OPTIONAL — most recent assessed value
 * @property {number|null} taxYear         OPTIONAL
 * @property {number|null} gla             OPTIONAL — gross living area (sq ft)
 * @property {number|null} lotSize         OPTIONAL — lot size (sq ft or acres)
 * @property {number|null} yearBuilt       OPTIONAL
 * @property {number|null} bedrooms        OPTIONAL
 * @property {number|null} bathrooms       OPTIONAL
 * @property {string|null} zoning          OPTIONAL
 * @property {string|null} floodZone       OPTIONAL — FEMA flood zone designation
 * @property {string|null} listingStatus   OPTIONAL — 'Active'|'Pending'|'Sold'|'Expired'
 * @property {number|null} listPrice       OPTIONAL
 * @property {string|null} listDate        OPTIONAL
 * @property {number|null} daysOnMarket    OPTIONAL
 * @property {string|null} mlsNumber       OPTIONAL
 * @property {string|null} notes           OPTIONAL — free-text notes (manualCompNote / costarNote)
 * @property {object}      rawSource       OPTIONAL — original vendor payload (for debugging only)
 * @property {object}      customFields    OPTIONAL — source-specific fields not in core schema
 */

import log from '../logger.js';

// ── Normalizer functions ──────────────────────────────────────────────────────

/**
 * normalizePublicRecord(raw, sourceId)
 *
 * Normalizes a public records payload (county assessor, recorder, PTAX)
 * into the unified NormalizedFact schema.
 *
 * Illinois priority fields: parcelId, saleAmount, saleDate, transferDate,
 * grantor, grantee, propertyUse, assessedValue, taxYear.
 *
 * @param {object} raw       Raw payload from the public records source
 * @param {string} sourceId  Unique identifier (e.g. parcel number, record ID)
 * @returns {NormalizedFact}
 */
export function normalizePublicRecord(raw = {}, sourceId = '') {
  return {
    sourceType:    'publicRecord',
    sourceId:      String(sourceId || raw.parcelId || raw.apn || raw.pin || ''),
    fetchedAt:     new Date().toISOString(),
    parcelId:      _str(raw.parcelId   || raw.apn    || raw.pin),
    address:       _str(raw.address    || raw.siteAddress || raw.propertyAddress),
    city:          _str(raw.city       || raw.siteCity),
    county:        _str(raw.county),
    state:         _str(raw.state      || 'IL'),
    zip:           _str(raw.zip        || raw.zipCode || raw.postalCode),
    saleAmount:    _num(raw.saleAmount  || raw.salePrice || raw.transferAmount),
    saleDate:      _str(raw.saleDate    || raw.transferDate),
    transferDate:  _str(raw.transferDate || raw.recordingDate),
    grantor:       _str(raw.grantor     || raw.seller),
    grantee:       _str(raw.grantee     || raw.buyer),
    propertyUse:   _str(raw.propertyUse || raw.useCode || raw.propertyClass),
    assessedValue: _num(raw.assessedValue || raw.assessedTotal),
    taxYear:       _num(raw.taxYear),
    gla:           _num(raw.gla         || raw.livingArea || raw.squareFeet),
    lotSize:       _num(raw.lotSize     || raw.lotSizeSqFt),
    yearBuilt:     _num(raw.yearBuilt   || raw.yearConstructed),
    bedrooms:      _num(raw.bedrooms    || raw.beds),
    bathrooms:     _num(raw.bathrooms   || raw.baths),
    zoning:        _str(raw.zoning      || raw.zoningCode),
    floodZone:     _str(raw.floodZone   || raw.femaFloodZone),
    rawSource:     raw,
    customFields:  {},
  };
}

/**
 * normalizeMlsRecord(raw, sourceId)
 *
 * Normalizes an MLS listing record into the unified schema.
 * MLS access is provider-controlled and configuration-driven.
 * Do NOT hardcode assumptions about RESO credentials or data structure.
 *
 * @param {object} raw
 * @param {string} sourceId  MLS number or listing ID
 * @returns {NormalizedFact}
 */
export function normalizeMlsRecord(raw = {}, sourceId = '') {
  return {
    sourceType:    'mlsRecord',
    sourceId:      String(sourceId || raw.ListingId || raw.mlsNumber || raw.MlsNumber || ''),
    fetchedAt:     new Date().toISOString(),
    parcelId:      _str(raw.ParcelNumber || raw.parcelId),
    address:       _str(raw.UnparsedAddress || raw.StreetAddress || raw.address),
    city:          _str(raw.City           || raw.city),
    county:        _str(raw.CountyOrParish || raw.county),
    state:         _str(raw.StateOrProvince || raw.state),
    zip:           _str(raw.PostalCode      || raw.zip),
    saleAmount:    _num(raw.ClosePrice      || raw.SoldPrice || raw.saleAmount),
    saleDate:      _str(raw.CloseDate       || raw.SoldDate  || raw.saleDate),
    transferDate:  null,
    grantor:       null,
    grantee:       null,
    propertyUse:   _str(raw.PropertyType    || raw.propertyUse),
    assessedValue: null,
    taxYear:       null,
    gla:           _num(raw.LivingArea      || raw.AboveGradeFinishedArea || raw.gla),
    lotSize:       _num(raw.LotSizeSquareFeet || raw.lotSize),
    yearBuilt:     _num(raw.YearBuilt       || raw.yearBuilt),
    bedrooms:      _num(raw.BedroomsTotal   || raw.bedrooms),
    bathrooms:     _num(raw.BathroomsTotalInteger || raw.BathroomsTotal || raw.bathrooms),
    zoning:        _str(raw.Zoning          || raw.zoning),
    floodZone:     null,
    listingStatus: _str(raw.StandardStatus  || raw.MlsStatus || raw.listingStatus),
    listPrice:     _num(raw.ListPrice       || raw.listPrice),
    listDate:      _str(raw.ListingContractDate || raw.listDate),
    daysOnMarket:  _num(raw.DaysOnMarket    || raw.CumulativeDaysOnMarket || raw.daysOnMarket),
    mlsNumber:     _str(raw.ListingId       || raw.mlsNumber || raw.MlsNumber),
    rawSource:     raw,
    customFields:  {},
  };
}

/**
 * normalizeZillowRecord(raw, sourceId)
 *
 * Normalizes a Zillow/Bridge API response into the unified schema.
 * Zillow is an optional supplement — not the sole source of truth.
 *
 * @param {object} raw
 * @param {string} sourceId  Zillow zpid or Bridge listing ID
 * @returns {NormalizedFact}
 */
export function normalizeZillowRecord(raw = {}, sourceId = '') {
  return {
    sourceType:    'zillowRecord',
    sourceId:      String(sourceId || raw.zpid || raw.id || ''),
    fetchedAt:     new Date().toISOString(),
    parcelId:      _str(raw.parcelId),
    address:       _str(raw.address?.streetAddress || raw.streetAddress || raw.address),
    city:          _str(raw.address?.city          || raw.city),
    county:        _str(raw.address?.county        || raw.county),
    state:         _str(raw.address?.state         || raw.state),
    zip:           _str(raw.address?.zipcode       || raw.zipCode || raw.zip),
    saleAmount:    _num(raw.lastSoldPrice           || raw.price),
    saleDate:      _str(raw.lastSoldDate),
    transferDate:  null,
    grantor:       null,
    grantee:       null,
    propertyUse:   _str(raw.homeType               || raw.propertyType),
    assessedValue: _num(raw.taxAssessedValue),
    taxYear:       _num(raw.taxAssessmentYear),
    gla:           _num(raw.livingArea             || raw.finishedSqFt),
    lotSize:       _num(raw.lotAreaValue),
    yearBuilt:     _num(raw.yearBuilt),
    bedrooms:      _num(raw.bedrooms),
    bathrooms:     _num(raw.bathrooms),
    zoning:        _str(raw.zoning),
    floodZone:     null,
    listingStatus: _str(raw.homeStatus),
    listPrice:     _num(raw.price                  || raw.listingPrice),
    listDate:      _str(raw.listingDateFormatted    || raw.listingDate),
    daysOnMarket:  _num(raw.daysOnZillow),
    mlsNumber:     null,
    rawSource:     raw,
    customFields:  {},
  };
}

/**
 * normalizeManualCompNote(raw, sourceId)
 *
 * Normalizes a human-entered comparable sale note into the unified schema.
 * Used when the appraiser manually enters comp data not available from APIs.
 *
 * @param {object} raw
 * @param {string} sourceId
 * @returns {NormalizedFact}
 */
export function normalizeManualCompNote(raw = {}, sourceId = '') {
  return {
    sourceType:    'manualCompNote',
    sourceId:      String(sourceId || raw.id || `manual_${Date.now()}`),
    fetchedAt:     new Date().toISOString(),
    parcelId:      _str(raw.parcelId),
    address:       _str(raw.address),
    city:          _str(raw.city),
    county:        _str(raw.county),
    state:         _str(raw.state),
    zip:           _str(raw.zip),
    saleAmount:    _num(raw.saleAmount  || raw.salePrice),
    saleDate:      _str(raw.saleDate),
    transferDate:  _str(raw.transferDate),
    grantor:       _str(raw.grantor     || raw.seller),
    grantee:       _str(raw.grantee     || raw.buyer),
    propertyUse:   _str(raw.propertyUse || raw.propertyType),
    assessedValue: null,
    taxYear:       null,
    gla:           _num(raw.gla         || raw.livingArea),
    lotSize:       _num(raw.lotSize),
    yearBuilt:     _num(raw.yearBuilt),
    bedrooms:      _num(raw.bedrooms),
    bathrooms:     _num(raw.bathrooms),
    zoning:        _str(raw.zoning),
    floodZone:     _str(raw.floodZone),
    listingStatus: _str(raw.listingStatus),
    listPrice:     _num(raw.listPrice),
    listDate:      _str(raw.listDate),
    daysOnMarket:  _num(raw.daysOnMarket),
    mlsNumber:     _str(raw.mlsNumber),
    notes:         _str(raw.notes       || raw.comments),
    rawSource:     raw,
    customFields:  raw.customFields || {},
  };
}

/**
 * normalizeCostarNote(raw, sourceId)
 *
 * Normalizes a human-reviewed CoStar excerpt into the unified schema.
 *
 * POLICY: CoStar is a restricted/controlled source.
 * - Do NOT bulk-ingest CoStar data without explicit licensed permission.
 * - Only manual note capture and limited licensed excerpts are supported.
 * - Human review is required before any CoStar-derived content is used.
 *
 * @param {object} raw
 * @param {string} sourceId
 * @returns {NormalizedFact}
 */
export function normalizeCostarNote(raw = {}, sourceId = '') {
  return {
    sourceType:    'costarNote',
    sourceId:      String(sourceId || raw.propertyId || raw.id || ''),
    fetchedAt:     new Date().toISOString(),
    parcelId:      _str(raw.parcelId),
    address:       _str(raw.address    || raw.propertyAddress),
    city:          _str(raw.city),
    county:        _str(raw.county),
    state:         _str(raw.state),
    zip:           _str(raw.zip        || raw.postalCode),
    saleAmount:    _num(raw.saleAmount  || raw.salePrice),
    saleDate:      _str(raw.saleDate),
    transferDate:  null,
    grantor:       null,
    grantee:       null,
    propertyUse:   _str(raw.propertyType || raw.buildingClass),
    assessedValue: null,
    taxYear:       null,
    gla:           _num(raw.rentableArea || raw.buildingSize || raw.gla),
    lotSize:       _num(raw.lotSize),
    yearBuilt:     _num(raw.yearBuilt),
    bedrooms:      null,
    bathrooms:     null,
    zoning:        _str(raw.zoning),
    floodZone:     null,
    listingStatus: _str(raw.status),
    listPrice:     _num(raw.askingPrice || raw.listPrice),
    listDate:      null,
    daysOnMarket:  null,
    mlsNumber:     null,
    // Human-reviewed notes — the primary value of CoStar entries
    notes:         _str(raw.notes || raw.comments || raw.excerpt),
    rawSource:     raw,
    customFields:  raw.customFields || {},
    // CoStar-specific: flag that this was human-reviewed
    _humanReviewed: Boolean(raw._humanReviewed),
    _licenseVerified: Boolean(raw._licenseVerified),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _str(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Source type registry ──────────────────────────────────────────────────────
// Used by ingestion pipelines to route raw payloads to the correct normalizer.

export const NORMALIZERS = {
  publicRecord:   normalizePublicRecord,
  mlsRecord:      normalizeMlsRecord,
  zillowRecord:   normalizeZillowRecord,
  manualCompNote: normalizeManualCompNote,
  costarNote:     normalizeCostarNote,
};

/**
 * normalizeExternalFact(sourceType, raw, sourceId)
 *
 * Generic entry point — routes to the correct normalizer by sourceType.
 *
 * @param {string} sourceType  One of the NORMALIZERS keys
 * @param {object} raw         Raw vendor payload
 * @param {string} [sourceId]  Optional source-specific ID
 * @returns {NormalizedFact|null}
 */
export function normalizeExternalFact(sourceType, raw, sourceId = '') {
  const normalizer = NORMALIZERS[sourceType];
  if (!normalizer) {
    log.warn('normalizedDataModel:unknown-source', { sourceType });
    return null;
  }
  return normalizer(raw, sourceId);
}
