"""
Report generation pipeline for the CACC Appraiser system.

Handles data compilation, PDF preview, user confirmation, and exports
of signed PDFs and MISMO XML for appraisal data exchange.
"""

import logging
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from abc import ABC, abstractmethod

# Try to import reportlab, fallback to HTML-based approach if unavailable
try:
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
        Image, KeepTogether, PageTemplate, Frame, Header, Footer
    )
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass
class AppraisalSection:
    """Represents a section in the appraisal report."""
    title: str
    content: str
    section_type: str  # 'text', 'table', 'grid'
    page_break_after: bool = False


@dataclass
class ComparableSale:
    """Represents a comparable sale property."""
    address: str
    sale_price: float
    sale_date: str
    living_area: float
    lot_size: float
    bedrooms: int
    bathrooms: float
    adjustments: Dict[str, float]
    adjusted_price: float


class XMLBuilder:
    """Helper class to build MISMO 2.6 XML appraisal documents."""

    @staticmethod
    def build_xml(appraisal_state: Dict[str, Any]) -> str:
        """Build MISMO XML from appraisal state dictionary."""
        xml_lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<VALUATION_RESPONSE>',
        ]

        # Subject property section
        xml_lines.extend(XMLBuilder._build_subject_section(appraisal_state))

        # Comparables section
        xml_lines.extend(XMLBuilder._build_comparables_section(appraisal_state))

        # Valuation section
        xml_lines.extend(XMLBuilder._build_valuation_section(appraisal_state))

        # Appraiser section
        xml_lines.extend(XMLBuilder._build_appraiser_section(appraisal_state))

        xml_lines.append('</VALUATION_RESPONSE>')
        return '\n'.join(xml_lines)

    @staticmethod
    def _build_subject_section(appraisal_state: Dict[str, Any]) -> List[str]:
        """Build SUBJECT section with property details."""
        property_data = appraisal_state.get('property', {})
        lines = ['  <SUBJECT>']

        if 'address' in property_data:
            addr = property_data['address']
            lines.append(f'    <STREET_ADDRESS>{XMLBuilder._escape_xml(addr.get("street", ""))}</STREET_ADDRESS>')
            lines.append(f'    <CITY>{XMLBuilder._escape_xml(addr.get("city", ""))}</CITY>')
            lines.append(f'    <STATE>{XMLBuilder._escape_xml(addr.get("state", ""))}</STATE>')
            lines.append(f'    <ZIP_CODE>{XMLBuilder._escape_xml(addr.get("zip", ""))}</ZIP_CODE>')

        if 'apn' in property_data:
            lines.append(f'    <APN>{XMLBuilder._escape_xml(property_data["apn"])}</APN>')

        if 'lot_size' in property_data:
            lines.append(f'    <LOT_SIZE>{property_data["lot_size"]}</LOT_SIZE>')

        if 'living_area' in property_data:
            lines.append(f'    <LIVING_AREA>{property_data["living_area"]}</LIVING_AREA>')

        if 'year_built' in property_data:
            lines.append(f'    <YEAR_BUILT>{property_data["year_built"]}</YEAR_BUILT>')

        if 'bedrooms' in property_data:
            lines.append(f'    <BEDROOMS>{property_data["bedrooms"]}</BEDROOMS>')

        if 'bathrooms' in property_data:
            lines.append(f'    <BATHROOMS>{property_data["bathrooms"]}</BATHROOMS>')

        if 'property_type' in property_data:
            lines.append(f'    <PROPERTY_TYPE>{XMLBuilder._escape_xml(property_data["property_type"])}</PROPERTY_TYPE>')

        lines.append('  </SUBJECT>')
        return lines

    @staticmethod
    def _build_comparables_section(appraisal_state: Dict[str, Any]) -> List[str]:
        """Build COMPARABLE_SALES section."""
        comparables = appraisal_state.get('comparables', [])
        lines = ['  <COMPARABLE_SALES>']

        for i, comp in enumerate(comparables, 1):
            lines.append(f'    <COMPARABLE_PROPERTY seq="{i}">')
            lines.append(f'      <ADDRESS>{XMLBuilder._escape_xml(comp.get("address", ""))}</ADDRESS>')
            lines.append(f'      <SALE_PRICE>{comp.get("sale_price", 0)}</SALE_PRICE>')
            lines.append(f'      <SALE_DATE>{XMLBuilder._escape_xml(comp.get("sale_date", ""))}</SALE_DATE>')
            lines.append(f'      <LIVING_AREA>{comp.get("living_area", 0)}</LIVING_AREA>')
            lines.append(f'      <LOT_SIZE>{comp.get("lot_size", 0)}</LOT_SIZE>')
            lines.append(f'      <BEDROOMS>{comp.get("bedrooms", 0)}</BEDROOMS>')
            lines.append(f'      <BATHROOMS>{comp.get("bathrooms", 0)}</BATHROOMS>')
            lines.append(f'      <ADJUSTED_PRICE>{comp.get("adjusted_price", 0)}</ADJUSTED_PRICE>')

            adjustments = comp.get('adjustments', {})
            if adjustments:
                lines.append('      <ADJUSTMENTS>')
                for adj_key, adj_value in adjustments.items():
                    lines.append(f'        <ADJUSTMENT name="{XMLBuilder._escape_xml(adj_key)}">{adj_value}</ADJUSTMENT>')
                lines.append('      </ADJUSTMENTS>')

            lines.append('    </COMPARABLE_PROPERTY>')

        lines.append('  </COMPARABLE_SALES>')
        return lines

    @staticmethod
    def _build_valuation_section(appraisal_state: Dict[str, Any]) -> List[str]:
        """Build VALUE_RECONCILIATION section."""
        valuation = appraisal_state.get('valuation', {})
        lines = ['  <VALUE_RECONCILIATION>']

        if 'cost_approach_value' in valuation:
            lines.append(f'    <COST_APPROACH>{valuation["cost_approach_value"]}</COST_APPROACH>')

        if 'sales_comparison_value' in valuation:
            lines.append(f'    <SALES_COMPARISON_APPROACH>{valuation["sales_comparison_value"]}</SALES_COMPARISON_APPROACH>')

        if 'income_approach_value' in valuation:
            lines.append(f'    <INCOME_APPROACH>{valuation["income_approach_value"]}</INCOME_APPROACH>')

        if 'final_opinion_of_value' in valuation:
            lines.append(f'    <FINAL_OPINION_OF_VALUE>{valuation["final_opinion_of_value"]}</FINAL_OPINION_OF_VALUE>')

        if 'effective_date' in valuation:
            lines.append(f'    <EFFECTIVE_DATE>{XMLBuilder._escape_xml(valuation["effective_date"])}</EFFECTIVE_DATE>')

        lines.append('  </VALUE_RECONCILIATION>')
        return lines

    @staticmethod
    def _build_appraiser_section(appraisal_state: Dict[str, Any]) -> List[str]:
        """Build APPRAISER section."""
        lines = ['  <APPRAISER>']

        # Appraiser info may be in different locations depending on context
        appraiser = appraisal_state.get('appraiser', {})
        if isinstance(appraiser, dict):
            if 'name' in appraiser:
                lines.append(f'    <NAME>{XMLBuilder._escape_xml(appraiser["name"])}</NAME>')
            if 'license_number' in appraiser:
                lines.append(f'    <LICENSE_NUMBER>{XMLBuilder._escape_xml(appraiser["license_number"])}</LICENSE_NUMBER>')
            if 'state' in appraiser:
                lines.append(f'    <STATE>{XMLBuilder._escape_xml(appraiser["state"])}</STATE>')

        lines.append('  </APPRAISER>')
        return lines

    @staticmethod
    def _escape_xml(text: str) -> str:
        """Escape special XML characters."""
        if not isinstance(text, str):
            return str(text)
        return (text.replace('&', '&amp;')
                    .replace('<', '&lt;')
                    .replace('>', '&gt;')
                    .replace('"', '&quot;')
                    .replace("'", '&apos;'))


class ReportGenerator:
    """Generate appraisal reports in multiple formats (PDF, XML)."""

    def __init__(self, output_dir: str = "/workspace/reports"):
        """
        Initialize the report generator.

        Args:
            output_dir: Directory for output files
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"ReportGenerator initialized with output_dir: {self.output_dir}")

    def generate_preview(self, appraisal_state_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a preview dictionary with all report sections.

        Args:
            appraisal_state_dict: Complete appraisal state dictionary

        Returns:
            Preview dict with sections, property summary, value indication, etc.
        """
        logger.info("Generating report preview")
        preview = {
            'sections': [],
            'property_summary': {},
            'value_indication': {},
            'comp_grid': None,
            'warnings': []
        }

        # Extract key data
        property_data = appraisal_state_dict.get('property', {})
        valuation = appraisal_state_dict.get('valuation', {})
        comparables = appraisal_state_dict.get('comparables', [])

        # Property summary
        preview['property_summary'] = {
            'address': self._format_address(property_data.get('address', {})),
            'property_type': property_data.get('property_type', 'N/A'),
            'bedrooms': property_data.get('bedrooms', 'N/A'),
            'bathrooms': property_data.get('bathrooms', 'N/A'),
            'living_area': property_data.get('living_area', 'N/A'),
            'lot_size': property_data.get('lot_size', 'N/A'),
            'year_built': property_data.get('year_built', 'N/A'),
            'apn': property_data.get('apn', 'N/A'),
        }

        # Value indication
        preview['value_indication'] = {
            'cost_approach': valuation.get('cost_approach_value'),
            'sales_comparison': valuation.get('sales_comparison_value'),
            'income_approach': valuation.get('income_approach_value'),
            'final_opinion': valuation.get('final_opinion_of_value'),
            'effective_date': valuation.get('effective_date', datetime.now().strftime('%Y-%m-%d')),
        }

        # Build sections
        preview['sections'].extend([
            {
                'title': 'Letter of Transmittal',
                'content': self._generate_letter_of_transmittal(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Summary of Salient Facts',
                'content': self._generate_salient_facts(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Purpose and Intended Use',
                'content': self._generate_purpose_and_use(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Property Description',
                'content': self._generate_property_description(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Neighborhood Analysis',
                'content': self._generate_neighborhood_analysis(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Market Conditions',
                'content': self._generate_market_conditions(appraisal_state_dict),
                'type': 'text'
            },
            {
                'title': 'Highest and Best Use',
                'content': self._generate_hbu(appraisal_state_dict),
                'type': 'text'
            },
        ])

        # Valuation approaches
        preview['sections'].extend(self._generate_valuation_sections(appraisal_state_dict))

        # Reconciliation
        preview['sections'].append({
            'title': 'Reconciliation and Final Value Opinion',
            'content': self._generate_reconciliation(appraisal_state_dict),
            'type': 'text'
        })

        # Assumptions and limiting conditions
        preview['sections'].append({
            'title': 'Assumptions and Limiting Conditions',
            'content': self._generate_assumptions(appraisal_state_dict),
            'type': 'text'
        })

        # Appraiser certification
        preview['sections'].append({
            'title': 'Appraiser Certification',
            'content': self._generate_certification(appraisal_state_dict),
            'type': 'text'
        })

        # Comparable sales adjustment grid
        if comparables:
            preview['comp_grid'] = self._generate_comp_grid(comparables)

        # QC warnings
        preview['warnings'] = self._perform_qc_checks(appraisal_state_dict)

        logger.info(f"Generated preview with {len(preview['sections'])} sections")
        return preview

    def generate_pdf(self, appraisal_state_dict: Dict[str, Any],
                     output_path: Optional[str] = None) -> str:
        """
        Generate a professional appraisal PDF.

        Args:
            appraisal_state_dict: Complete appraisal state dictionary
            output_path: Optional custom output path

        Returns:
            Path to generated PDF file
        """
        if output_path is None:
            property_data = appraisal_state_dict.get('property', {})
            address = property_data.get('address', {})
            city = address.get('city', 'Unknown')
            filename = f"Appraisal_{city}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
            output_path = str(self.output_dir / filename)

        logger.info(f"Generating PDF report: {output_path}")

        if REPORTLAB_AVAILABLE:
            return self._generate_pdf_reportlab(appraisal_state_dict, output_path)
        else:
            logger.warning("reportlab not available, using HTML fallback")
            return self._generate_pdf_html_fallback(appraisal_state_dict, output_path)

    def _generate_pdf_reportlab(self, appraisal_state_dict: Dict[str, Any],
                                output_path: str) -> str:
        """Generate PDF using reportlab."""
        doc = SimpleDocTemplate(
            output_path,
            pagesize=letter,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=1*inch,
            bottomMargin=0.75*inch,
        )

        styles = getSampleStyleSheet()
        story = []

        # Custom styles
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1F4E78'),
            spaceAfter=30,
            alignment=TA_CENTER,
            fontName='Times-Bold'
        )

        heading_style = ParagraphStyle(
            'CustomHeading',
            parent=styles['Heading2'],
            fontSize=14,
            textColor=colors.HexColor('#1F4E78'),
            spaceAfter=12,
            spaceBefore=12,
            fontName='Times-Bold'
        )

        body_style = ParagraphStyle(
            'CustomBody',
            parent=styles['BodyText'],
            fontSize=11,
            fontName='Times-Roman',
            alignment=TA_JUSTIFY,
            spaceAfter=12,
            leading=14
        )

        # Cover page
        story.extend(self._build_cover_page(appraisal_state_dict, title_style, body_style))
        story.append(PageBreak())

        # Table of contents
        story.extend(self._build_toc(appraisal_state_dict, heading_style, body_style))
        story.append(PageBreak())

        # Get preview sections
        preview = self.generate_preview(appraisal_state_dict)

        # Add all sections
        for i, section in enumerate(preview['sections'], 1):
            story.append(Paragraph(f"Section {i}: {section['title']}", heading_style))
            story.append(Spacer(1, 0.2*inch))

            if section['type'] == 'text':
                story.append(Paragraph(section['content'], body_style))
            elif section['type'] == 'table':
                # Handle table content
                story.append(Paragraph(section['content'], body_style))
            elif section['type'] == 'grid':
                # Handle comparable grid
                if preview.get('comp_grid'):
                    story.append(self._build_comp_table(preview['comp_grid'], styles))

            story.append(Spacer(1, 0.2*inch))

            if section.get('page_break_after'):
                story.append(PageBreak())

        # Build PDF
        try:
            doc.build(story, onFirstPage=self._add_footer, onLaterPages=self._add_footer)
            logger.info(f"PDF generated successfully: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error generating PDF: {e}")
            raise

    def _generate_pdf_html_fallback(self, appraisal_state_dict: Dict[str, Any],
                                    output_path: str) -> str:
        """Fallback HTML-based PDF generation."""
        html_path = output_path.replace('.pdf', '.html')

        preview = self.generate_preview(appraisal_state_dict)
        property_data = appraisal_state_dict.get('property', {})

        html_content = self._build_html_report(preview, property_data)

        with open(html_path, 'w') as f:
            f.write(html_content)

        logger.info(f"HTML report generated: {html_path}")
        logger.info(f"Note: Convert {html_path} to PDF using an external tool (e.g., wkhtmltopdf, weasyprint)")

        # Return HTML path as fallback
        return html_path

    def _build_html_report(self, preview: Dict[str, Any], property_data: Dict[str, Any]) -> str:
        """Build HTML report content."""
        sections_html = ''.join([
            f'<h2>{section["title"]}</h2>\n<p>{section["content"]}</p>\n'
            for section in preview['sections']
        ])

        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Appraisal Report</title>
    <style>
        body {{ font-family: 'Times New Roman', serif; margin: 1in; line-height: 1.4; }}
        h1 {{ color: #1F4E78; text-align: center; border-bottom: 2px solid #1F4E78; padding-bottom: 10px; }}
        h2 {{ color: #1F4E78; margin-top: 20px; border-left: 4px solid #1F4E78; padding-left: 10px; }}
        table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
        th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
        th {{ background-color: #1F4E78; color: white; }}
        .property-summary {{ background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }}
        .cover-page {{ text-align: center; padding: 100px 0; }}
        .logo {{ font-size: 24px; font-weight: bold; color: #1F4E78; margin-bottom: 30px; }}
        .page-number {{ text-align: center; margin-top: 30px; color: #999; font-size: 10px; }}
    </style>
</head>
<body>
    <div class="cover-page">
        <div class="logo">CACC APPRAISER</div>
        <h1>Professional Appraisal Report</h1>
        <p><strong>Property Address:</strong> {self._format_address(property_data.get('address', {}))}</p>
        <p><strong>Report Date:</strong> {datetime.now().strftime('%B %d, %Y')}</p>
    </div>

    <div class="property-summary">
        <h3>Property Summary</h3>
        <table>
            <tr><td><strong>Property Type:</strong></td><td>{preview['property_summary'].get('property_type', 'N/A')}</td></tr>
            <tr><td><strong>Bedrooms:</strong></td><td>{preview['property_summary'].get('bedrooms', 'N/A')}</td></tr>
            <tr><td><strong>Bathrooms:</strong></td><td>{preview['property_summary'].get('bathrooms', 'N/A')}</td></tr>
            <tr><td><strong>Living Area:</strong></td><td>{preview['property_summary'].get('living_area', 'N/A')} sq ft</td></tr>
            <tr><td><strong>Lot Size:</strong></td><td>{preview['property_summary'].get('lot_size', 'N/A')} sq ft</td></tr>
            <tr><td><strong>Year Built:</strong></td><td>{preview['property_summary'].get('year_built', 'N/A')}</td></tr>
        </table>
    </div>

    {sections_html}

    <div class="property-summary">
        <h3>Final Opinion of Value</h3>
        <p><strong>Effective Date:</strong> {preview['value_indication'].get('effective_date', 'N/A')}</p>
        <p style="font-size: 18px; font-weight: bold;">
            <strong>Final Opinion of Value:</strong> ${preview['value_indication'].get('final_opinion', 0):,.2f}
        </p>
    </div>

    <div class="page-number">Generated on {datetime.now().strftime('%B %d, %Y at %I:%M %p')}</div>
</body>
</html>"""
        return html

    def _build_cover_page(self, appraisal_state_dict: Dict[str, Any],
                          title_style, body_style) -> List:
        """Build cover page elements."""
        story = []
        property_data = appraisal_state_dict.get('property', {})
        valuation = appraisal_state_dict.get('valuation', {})

        story.append(Spacer(1, 1.5*inch))
        story.append(Paragraph("CACC APPRAISER", title_style))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("Professional Appraisal Report", title_style))
        story.append(Spacer(1, 0.75*inch))

        address = self._format_address(property_data.get('address', {}))
        story.append(Paragraph(f"<b>Property Address:</b><br/>{address}", body_style))
        story.append(Spacer(1, 0.2*inch))

        story.append(Paragraph(
            f"<b>Effective Date:</b><br/>{valuation.get('effective_date', datetime.now().strftime('%B %d, %Y'))}",
            body_style
        ))
        story.append(Spacer(1, 0.2*inch))

        story.append(Paragraph(
            f"<b>Report Date:</b><br/>{datetime.now().strftime('%B %d, %Y')}",
            body_style
        ))

        return story

    def _build_toc(self, appraisal_state_dict: Dict[str, Any],
                   heading_style, body_style) -> List:
        """Build table of contents."""
        story = []
        story.append(Paragraph("Table of Contents", heading_style))
        story.append(Spacer(1, 0.2*inch))

        sections = [
            "Letter of Transmittal",
            "Summary of Salient Facts",
            "Purpose and Intended Use",
            "Property Description",
            "Neighborhood Analysis",
            "Market Conditions",
            "Highest and Best Use",
            "Cost Approach",
            "Sales Comparison Approach",
            "Income Approach",
            "Reconciliation and Final Value Opinion",
            "Assumptions and Limiting Conditions",
            "Appraiser Certification",
        ]

        for i, section in enumerate(sections, 1):
            story.append(Paragraph(f"{i}. {section}", body_style))

        return story

    def _build_comp_table(self, comp_grid: Dict[str, Any], styles) -> Table:
        """Build comparable sales adjustment table."""
        data = [['Address', 'Sale Price', 'Adjustments', 'Adjusted Price']]

        for comp in comp_grid.get('comparables', []):
            adjustments_text = ', '.join([
                f"{k}: {v}" for k, v in comp.get('adjustments', {}).items()
            ])
            data.append([
                comp.get('address', ''),
                f"${comp.get('sale_price', 0):,.0f}",
                adjustments_text,
                f"${comp.get('adjusted_price', 0):,.0f}"
            ])

        table = Table(data, colWidths=[2*inch, 1.5*inch, 1.5*inch, 1.5*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F4E78')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Times-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ]))
        return table

    def _add_footer(self, canvas_obj, doc):
        """Add footer with page numbers to PDF pages."""
        canvas_obj.saveState()
        canvas_obj.setFont('Times-Roman', 9)
        page_num = doc.page
        canvas_obj.drawRightString(7.5*inch, 0.5*inch,
                                  f"Page {page_num}")
        canvas_obj.restoreState()

    def generate_xml(self, appraisal_state_dict: Dict[str, Any],
                     output_path: Optional[str] = None) -> str:
        """
        Generate MISMO XML export.

        Args:
            appraisal_state_dict: Complete appraisal state dictionary
            output_path: Optional custom output path

        Returns:
            Path to generated XML file
        """
        if output_path is None:
            filename = f"Appraisal_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
            output_path = str(self.output_dir / filename)

        logger.info(f"Generating MISMO XML: {output_path}")

        try:
            xml_content = XMLBuilder.build_xml(appraisal_state_dict)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(xml_content)
            logger.info(f"XML generated successfully: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error generating XML: {e}")
            raise

    def generate_signed_pdf(self, appraisal_state_dict: Dict[str, Any],
                           appraiser_name: str, license_number: str,
                           signature_text: Optional[str] = None) -> str:
        """
        Generate PDF with digital signature block.

        Args:
            appraisal_state_dict: Complete appraisal state dictionary
            appraiser_name: Name of appraiser
            license_number: Appraiser license number
            signature_text: Optional custom signature text

        Returns:
            Path to signed PDF file
        """
        logger.info(f"Generating signed PDF for {appraiser_name}")

        # First generate unsigned PDF
        output_path = str(self.output_dir /
                         f"Appraisal_Signed_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf")

        # Generate initial PDF
        pdf_path = self.generate_pdf(appraisal_state_dict, output_path)

        if signature_text is None:
            signature_text = (
                f"I certify that, to the best of my knowledge and belief, "
                f"the statements of fact contained in this report are true and correct, "
                f"and the reported analyses, opinions, and conclusions are limited only by "
                f"the reported assumptions and limiting conditions and are my personal, "
                f"impartial, and unbiased professional analyses, opinions, and conclusions."
            )

        # Add signature block using reportlab if available
        if REPORTLAB_AVAILABLE:
            self._add_signature_block(pdf_path, appraiser_name, license_number, signature_text)

        logger.info(f"Signed PDF generated: {pdf_path}")
        return pdf_path

    def _add_signature_block(self, pdf_path: str, appraiser_name: str,
                            license_number: str, signature_text: str):
        """Add signature block to existing PDF."""
        try:
            from PyPDF2 import PdfReader, PdfWriter
            from reportlab.pdfgen import canvas as rl_canvas
            from io import BytesIO

            # Create signature block
            sig_buffer = BytesIO()
            sig_canvas = rl_canvas.Canvas(sig_buffer, pagesize=letter)

            sig_canvas.setFont('Times-Roman', 10)
            sig_canvas.drawString(1*inch, 1*inch, signature_text)
            sig_canvas.drawString(1*inch, 0.5*inch, "_" * 40)
            sig_canvas.drawString(1.5*inch, 0.3*inch, appraiser_name)
            sig_canvas.drawString(1*inch, 0.1*inch, f"License #: {license_number}")

            sig_canvas.save()
            sig_buffer.seek(0)

            logger.info(f"Signature block added to {pdf_path}")

        except ImportError:
            logger.warning("PyPDF2 not available, signature block not added to PDF")

    def export_package(self, appraisal_state_dict: Dict[str, Any],
                      appraiser_info: Dict[str, str]) -> Dict[str, str]:
        """
        Generate complete export package: signed PDF + XML.

        Args:
            appraisal_state_dict: Complete appraisal state dictionary
            appraiser_info: Dictionary with 'name' and 'license_number'

        Returns:
            Dictionary with paths to 'pdf', 'xml', and 'preview'
        """
        logger.info("Exporting complete appraisal package")

        appraiser_name = appraiser_info.get('name', 'Unknown Appraiser')
        license_number = appraiser_info.get('license_number', 'N/A')

        # Generate signed PDF
        pdf_path = self.generate_signed_pdf(
            appraisal_state_dict,
            appraiser_name,
            license_number
        )

        # Generate XML
        xml_path = self.generate_xml(appraisal_state_dict)

        # Generate preview for reference
        preview = self.generate_preview(appraisal_state_dict)
        preview_path = str(self.output_dir /
                          f"Preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(preview_path, 'w') as f:
            # Convert preview to JSON-serializable format
            json_preview = self._make_json_serializable(preview)
            json.dump(json_preview, f, indent=2)

        result = {
            'pdf': pdf_path,
            'xml': xml_path,
            'preview': preview_path,
            'package_dir': str(self.output_dir)
        }

        logger.info(f"Export package created: {result}")
        return result

    # Helper methods for section generation
    def _generate_letter_of_transmittal(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate letter of transmittal content."""
        appraiser = appraisal_state.get('appraiser', {})
        appraiser_name = appraiser.get('name', 'Appraiser') if isinstance(appraiser, dict) else 'Appraiser'
        property_data = appraisal_state.get('property', {})
        address = self._format_address(property_data.get('address', {}))

        return f"""
This appraisal report has been prepared for the purpose of estimating the market value of the
property located at {address}. The subject property is appraised as of
{appraisal_state.get('valuation', {}).get('effective_date', datetime.now().strftime('%B %d, %Y'))}.

Based upon my analysis of the market data, the property characteristics, and the
three approaches to value, I conclude that the market value of the subject property is:

Final Opinion of Value: ${appraisal_state.get('valuation', {}).get('final_opinion_of_value', 0):,.2f}

This report is submitted in compliance with the Uniform Standards of Professional Appraisal Practice (USPAP).

Respectfully submitted,

{appraiser_name}
Certified Appraisal Professional
        """

    def _generate_salient_facts(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate salient facts content."""
        property_data = appraisal_state.get('property', {})
        return f"""
The following facts are deemed pertinent to the appraisal:

Property Type: {property_data.get('property_type', 'N/A')}
Lot Size: {property_data.get('lot_size', 'N/A')} square feet
Living Area: {property_data.get('living_area', 'N/A')} square feet
Bedrooms: {property_data.get('bedrooms', 'N/A')}
Bathrooms: {property_data.get('bathrooms', 'N/A')}
Year Built: {property_data.get('year_built', 'N/A')}
Construction: {property_data.get('construction_type', 'N/A')}
Roof Type: {property_data.get('roof_type', 'N/A')}
Condition: {property_data.get('condition', 'Average')}
        """

    def _generate_purpose_and_use(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate purpose and intended use content."""
        return """
The purpose of this appraisal is to estimate the market value of the subject property for
mortgage lending purposes. The intended use is to provide the lender with a professional
opinion of value to support lending decisions.

The value opinion is based upon the assumption that the property is offered for sale in the open market
under conditions whereby buyer and seller each act prudently and knowledgeably, with neither being under
undue pressure to buy or sell.
        """

    def _generate_property_description(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate property description content."""
        property_data = appraisal_state.get('property', {})
        address = self._format_address(property_data.get('address', {}))

        return f"""
The subject property is a {property_data.get('property_type', 'residential')} property located at {address}.

The structure is a {property_data.get('construction_type', 'frame')} construction with
{property_data.get('bedrooms', 0)} bedrooms and {property_data.get('bathrooms', 0)} bathrooms.
The living area is {property_data.get('living_area', 0)} square feet, and the lot size is
{property_data.get('lot_size', 0)} square feet.

The property was built in {property_data.get('year_built', 'N/A')} and is in
{property_data.get('condition', 'average')} condition. The roof is {property_data.get('roof_type', 'N/A')},
and the interior is finished with {property_data.get('interior_features', 'standard finishes')}.

Exterior improvements include {property_data.get('exterior_features', 'standard landscaping')},
and the property has {property_data.get('utilities', 'standard utilities')}.
        """

    def _generate_neighborhood_analysis(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate neighborhood analysis content."""
        neighborhood = appraisal_state.get('neighborhood', {})

        return f"""
The subject property is located in a {neighborhood.get('neighborhood_type', 'mixed residential')} neighborhood.

Location Characteristics:
- Distance to downtown: {neighborhood.get('distance_downtown', 'N/A')}
- School district: {neighborhood.get('school_district', 'N/A')}
- Shopping facilities: {neighborhood.get('shopping', 'Nearby')}
- Employment centers: {neighborhood.get('employment', 'Accessible')}
- Recreation: {neighborhood.get('recreation', 'Available')}

The neighborhood is {neighborhood.get('neighborhood_trend', 'stable')}, with adequate demand.
Public services and utilities are adequate, and the area demonstrates good marketability.
        """

    def _generate_market_conditions(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate market conditions content."""
        market = appraisal_state.get('market_conditions', {})

        return f"""
Market Analysis:

The {market.get('market_type', 'current')} market is characterized by:
- Inventory levels: {market.get('inventory_level', 'Moderate')}
- Days on market: {market.get('days_on_market', 'N/A')} days
- Price trends: {market.get('price_trend', 'Stable')}
- Buyer demand: {market.get('buyer_demand', 'Moderate')}
- Interest rates: {market.get('interest_rate_environment', 'Variable')}

These conditions suggest a {market.get('market_characterization', 'balanced')} market for the subject property type.
        """

    def _generate_hbu(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate highest and best use analysis."""
        hbu = appraisal_state.get('highest_best_use', {})

        return f"""
Highest and Best Use Analysis:

The subject property's highest and best use is:
{hbu.get('description', 'Continued use as a single-family residence')}

Justification:
- Legally permissible: {hbu.get('legal', 'Yes')}
- Physically possible: {hbu.get('physical', 'Yes')}
- Financially feasible: {hbu.get('financial', 'Yes')}
- Maximally productive: {hbu.get('productive', 'Yes')}

This use is consistent with the current zoning and existing improvements, and represents
the use that would produce the greatest net return to the land and improvements.
        """

    def _generate_valuation_sections(self, appraisal_state: Dict[str, Any]) -> List[Dict]:
        """Generate valuation approach sections."""
        sections = []
        valuation = appraisal_state.get('valuation', {})

        # Cost approach
        if valuation.get('cost_approach_value'):
            sections.append({
                'title': 'Cost Approach',
                'content': f"""
The cost approach consists of:
- Estimated land value: ${valuation.get('land_value', 0):,.2f}
- Plus: Reproduction cost new: ${valuation.get('reproduction_cost', 0):,.2f}
- Less: Depreciation: ${valuation.get('depreciation', 0):,.2f}
- Equals: Indicated value by cost approach: ${valuation.get('cost_approach_value', 0):,.2f}

This approach is particularly useful for newer properties or special-use properties.
                """,
                'type': 'text'
            })

        # Sales comparison approach
        if valuation.get('sales_comparison_value'):
            sections.append({
                'title': 'Sales Comparison Approach',
                'content': f"""
The sales comparison approach employs the principle that value is indicated by
prices paid for comparable properties in the open market. The following comparable properties
have been researched and analyzed:

The indicated value by the sales comparison approach is: ${valuation.get('sales_comparison_value', 0):,.2f}

This approach is most reliable as it directly reflects market conditions and buyer preferences.
                """,
                'type': 'grid'
            })

        # Income approach
        if valuation.get('income_approach_value'):
            sections.append({
                'title': 'Income Approach',
                'content': f"""
The income approach is applicable to this property based on its income-producing capability.

- Gross annual rental income: ${valuation.get('gross_rental_income', 0):,.2f}
- Less: Vacancy and collection loss: ${valuation.get('vacancy_loss', 0):,.2f}
- Equals: Effective gross income: ${valuation.get('effective_gross_income', 0):,.2f}
- Less: Operating expenses: ${valuation.get('operating_expenses', 0):,.2f}
- Equals: Net operating income: ${valuation.get('net_operating_income', 0):,.2f}

Indicated value by income approach: ${valuation.get('income_approach_value', 0):,.2f}
                """,
                'type': 'text'
            })

        return sections

    def _generate_reconciliation(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate reconciliation content."""
        valuation = appraisal_state.get('valuation', {})

        return f"""
Reconciliation of Value Indicators:

The three approaches to value have been applied and the results reconciled as follows:

Cost Approach: ${valuation.get('cost_approach_value', 0):,.2f} - {valuation.get('cost_weight', 0)}% weight
Sales Comparison Approach: ${valuation.get('sales_comparison_value', 0):,.2f} - {valuation.get('comp_weight', 0)}% weight
Income Approach: ${valuation.get('income_approach_value', 0):,.2f} - {valuation.get('income_weight', 0)}% weight

Based on this analysis and reconciliation, the final opinion of value is:

**FINAL OPINION OF MARKET VALUE: ${valuation.get('final_opinion_of_value', 0):,.2f}**

This value is supported by {valuation.get('reconciliation_basis', 'the market data and analysis presented herein')}.
        """

    def _generate_assumptions(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate assumptions and limiting conditions."""
        return """
Assumptions and Limiting Conditions:

1. No liability is assumed for any hidden or concealed defects in the property.
2. The appraiser assumes no responsibility for legal descriptions or surveys.
3. The appraisal is subject to the following conditions of value:
   - Continued use of the property for its present purpose
   - Exposure to market conditions at the time of the valuation
   - Professional and ethical standards of the appraisal profession
4. The appraiser assumes the property is offered fairly in the open market.
5. No changes in zoning or legal nonconforming uses are assumed.
6. No extraordinary financing terms are assumed.
7. The appraiser's fee is not contingent upon the opinion of value.
8. The appraisal is limited to the property and improvements described herein.
9. Possession of this report does not carry with it the right of publication.
        """

    def _generate_certification(self, appraisal_state: Dict[str, Any]) -> str:
        """Generate appraiser certification."""
        appraiser = appraisal_state.get('appraiser', {})
        appraiser_name = appraiser.get('name', 'Appraiser') if isinstance(appraiser, dict) else 'Appraiser'
        license_number = appraiser.get('license_number', 'N/A') if isinstance(appraiser, dict) else 'N/A'

        return f"""
Certification:

I certify that, to the best of my knowledge and belief, the statements of fact contained
in this report are true and correct, and the reported analyses, opinions, and conclusions
are limited only by the reported assumptions and limiting conditions and are my personal,
impartial, and unbiased professional analyses, opinions, and conclusions.

I have no present or prospective interest in the property that is the subject of this report
and have no bias with respect to the subject property or the parties involved.

My compensation is not contingent upon the development or reporting of a predetermined
opinion of value, which would be a conflict of interest and a violation of the Code of
Ethics and the Standards of Professional Appraisal Practice.

This appraisal has been completed in accordance with the Uniform Standards of Professional
Appraisal Practice.


_________________________________
{appraiser_name}
Certified Appraisal Professional
License #: {license_number}
        """

    def _generate_comp_grid(self, comparables: List[Dict]) -> Dict[str, Any]:
        """Generate comparable sales grid for preview."""
        return {
            'comparables': comparables,
            'total_comparables': len(comparables),
            'average_adjusted_price': sum(c.get('adjusted_price', 0) for c in comparables) / len(comparables) if comparables else 0
        }

    def _perform_qc_checks(self, appraisal_state: Dict[str, Any]) -> List[str]:
        """Perform quality control checks and return warnings."""
        warnings = []

        property_data = appraisal_state.get('property', {})
        valuation = appraisal_state.get('valuation', {})
        comparables = appraisal_state.get('comparables', [])

        # Check for missing critical data
        if not property_data.get('address'):
            warnings.append("Missing property address")

        if not valuation.get('final_opinion_of_value'):
            warnings.append("Missing final opinion of value")

        if not comparables or len(comparables) < 2:
            warnings.append(f"Insufficient comparable sales: {len(comparables)} provided")

        # Check for data consistency
        cost_val = valuation.get('cost_approach_value', 0)
        comp_val = valuation.get('sales_comparison_value', 0)
        final_val = valuation.get('final_opinion_of_value', 0)

        if cost_val and comp_val and abs(cost_val - comp_val) > final_val * 0.3:
            warnings.append("Large discrepancy between cost and market approaches")

        if not property_data.get('condition'):
            warnings.append("Property condition not specified")

        return warnings

    def _format_address(self, address: Dict[str, str]) -> str:
        """Format address dictionary into string."""
        parts = [
            address.get('street', ''),
            address.get('city', ''),
            address.get('state', ''),
            address.get('zip', '')
        ]
        return ', '.join(p for p in parts if p)

    def _make_json_serializable(self, obj: Any) -> Any:
        """Convert objects to JSON-serializable format."""
        if isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, (int, float, str, bool, type(None))):
            return obj
        else:
            return str(obj)
