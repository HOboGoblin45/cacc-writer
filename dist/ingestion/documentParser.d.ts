/**
 * server/ingestion/documentParser.ts
 * ------------------------------------
 * NEW ARCHITECTURE — Document ingestion pipeline for appraisal PDFs.
 *
 * Responsibilities:
 *   - Ingest completed appraisal report PDFs
 *   - Split into narrative sections by field
 *   - Clean and normalize text
 *   - Assign structured metadata
 *   - Insert parsed sections into Pinecone via the retrieval layer
 *
 * Metadata schema per parsed section:
 *   form_type:     '1004' | '1025' | '1073' | '1004c' | 'commercial'
 *   property_type: 'residential' | 'commercial' | 'condo' | 'manufactured'
 *   market_area:   e.g. 'Bloomington-Normal, IL'
 *   county:        e.g. 'McLean County'
 *   section_name:  e.g. 'Neighborhood Description'
 *   field_id:      e.g. 'neighborhood_description'
 *   quality_score: 70–90
 *   approved_flag: true (all ingested PDFs are treated as approved examples)
 *
 * This module is called by:
 *   - POST /api/workflow/ingest-pdf  (new workflow endpoint)
 *   - POST /api/voice/import-pdf     (legacy endpoint — also calls this)
 */
import 'dotenv/config';
export interface ParsedSection {
    sectionName: string;
    fieldId: string;
    text: string;
    wordCount: number;
}
export interface DocumentMetadata {
    form_type: string;
    property_type: string;
    market_area: string;
    county: string;
    section_name: string;
    field_id: string;
    quality_score: number;
    approved_flag: boolean;
}
export interface ParsedDocument {
    id: string;
    filename: string;
    formType: string;
    propertyType: string;
    marketArea: string;
    county: string;
    sections: ParsedSection[];
    metadata: DocumentMetadata;
    parsedAt: string;
}
export interface IngestResult {
    documentId: string;
    filename: string;
    formType: string;
    sectionsFound: number;
    sectionsStored: number;
    fieldIds: string[];
    errors: string[];
}
export declare const PRODUCTION_LANE_FIELDS: Record<string, string[]>;
/**
 * parseDocument — extracts narrative sections from a PDF text string.
 *
 * Uses the OpenAI API to intelligently split the report text into
 * named sections matching the form's field IDs.
 *
 * @param pdfText    Raw text extracted from the PDF
 * @param formType   Form type (e.g. '1004')
 * @param filename   Original filename (for metadata)
 * @param metadata   Optional additional metadata
 * @returns          ParsedDocument with sections array
 */
export declare function parseDocument(pdfText: string, formType: string, filename: string, metadata?: Partial<DocumentMetadata>): Promise<ParsedDocument>;
/**
 * ingestDocument — parses a PDF and stores all sections in Pinecone + local KB.
 *
 * This is the main entry point for the document ingestion pipeline.
 * Called by the workflow's parse_documents node and the voice import endpoints.
 */
export declare function ingestDocument(pdfText: string, formType: string, filename: string, metadata?: Partial<DocumentMetadata>): Promise<IngestResult>;
/**
 * cleanNarrativeText — normalizes extracted narrative text.
 * Removes excessive whitespace, page numbers, headers, and artifacts.
 */
export declare function cleanNarrativeText(text: string): string;
//# sourceMappingURL=documentParser.d.ts.map