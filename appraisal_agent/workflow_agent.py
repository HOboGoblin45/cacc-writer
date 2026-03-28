"""
Workflow Agent for CACC Appraiser v3.1.0

This module provides the core guided workflow agent for real estate appraisal,
proactively driving the appraisal process through multiple stages while tracking
state, identifying issues, and generating professional appraisal reports.
"""

import logging
import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from pathlib import Path

from .config import query_model, web_search
from .knowledge_graph.graph import KnowledgeGraph


logger = logging.getLogger(__name__)


class PropertyType(str, Enum):
    """Enumeration of property types."""
    SFR = "SFR"  # Single Family Residence
    CONDO = "Condo"
    MULTI_FAMILY = "Multi-Family"
    COMMERCIAL = "Commercial"


class WorkflowStage(str, Enum):
    """Enumeration of workflow stages in the appraisal process."""
    INTAKE = "intake"
    PROPERTY_ANALYSIS = "property_analysis"
    MARKET_RESEARCH = "market_research"
    COMP_SELECTION = "comp_selection"
    ADJUSTMENTS = "adjustments"
    RECONCILIATION = "reconciliation"
    REPORT_DRAFT = "report_draft"
    REVIEW = "review"


class ApproachType(str, Enum):
    """Enumeration of appraisal approaches."""
    COST = "cost"
    SALES_COMPARISON = "sales_comparison"
    INCOME = "income"


@dataclass
class ComparableProperty:
    """Represents a comparable property used in the appraisal."""
    mls_number: str
    address: str
    sale_price: float
    sale_date: str
    property_type: str
    bedrooms: int
    bathrooms: float
    sqft: int
    lot_size: int
    year_built: int
    condition: str
    distance_miles: float
    adjustments: Dict[str, float] = field(default_factory=dict)
    adjusted_value: Optional[float] = None
    source: str = "MLS"  # MLS, public_records, broker, etc.

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ComparableProperty":
        """Create from dictionary."""
        return cls(**data)


@dataclass
class AppraisalState:
    """
    Maintains the complete state of an appraisal throughout the workflow.
    """
    # Property Identification
    property_address: Optional[str] = None
    property_type: Optional[PropertyType] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    sqft: Optional[int] = None
    lot_size: Optional[int] = None
    year_built: Optional[int] = None
    condition: Optional[str] = None

    # Assignment Details
    intended_use: Optional[str] = None
    intended_user: Optional[str] = None
    effective_date: Optional[str] = None

    # Appraisal Methods
    approach_types: List[ApproachType] = field(default_factory=list)

    # Market Data
    comps: List[ComparableProperty] = field(default_factory=list)
    market_data: Dict[str, Any] = field(default_factory=dict)

    # Analysis Results
    adjustments: Dict[str, Dict[str, float]] = field(default_factory=dict)
    cost_approach_value: Optional[float] = None
    sales_comp_value: Optional[float] = None
    income_approach_value: Optional[float] = None
    final_value_opinion: Optional[float] = None

    # Quality Control
    issues: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    # Workflow Tracking
    workflow_stage: WorkflowStage = WorkflowStage.INTAKE
    completion_percentage: int = 0
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        """Convert state to dictionary for serialization."""
        data = asdict(self)
        # Convert enums to strings
        data['property_type'] = self.property_type.value if self.property_type else None
        data['workflow_stage'] = self.workflow_stage.value
        data['approach_types'] = [a.value for a in self.approach_types]
        # Convert comps
        data['comps'] = [c.to_dict() if isinstance(c, ComparableProperty) else c for c in self.comps]
        data['updated_at'] = datetime.utcnow().isoformat()
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AppraisalState":
        """Create state from dictionary."""
        # Convert string enums back to enum types
        if data.get('property_type'):
            data['property_type'] = PropertyType(data['property_type'])
        if data.get('workflow_stage'):
            data['workflow_stage'] = WorkflowStage(data['workflow_stage'])
        if data.get('approach_types'):
            data['approach_types'] = [ApproachType(a) for a in data['approach_types']]
        # Convert comps
        if data.get('comps'):
            data['comps'] = [ComparableProperty.from_dict(c) if isinstance(c, dict) else c
                           for c in data['comps']]
        return cls(**data)


class WorkflowAgent:
    """
    Guided workflow agent that drives the appraisal process, tracks state,
    identifies issues, and generates professional appraisal reports.
    """

    WORKFLOW_STAGES = [
        WorkflowStage.INTAKE,
        WorkflowStage.PROPERTY_ANALYSIS,
        WorkflowStage.MARKET_RESEARCH,
        WorkflowStage.COMP_SELECTION,
        WorkflowStage.ADJUSTMENTS,
        WorkflowStage.RECONCILIATION,
        WorkflowStage.REPORT_DRAFT,
        WorkflowStage.REVIEW,
    ]

    REQUIRED_FIELDS_BY_STAGE = {
        WorkflowStage.INTAKE: [
            'property_address', 'property_type', 'intended_use', 'effective_date'
        ],
        WorkflowStage.PROPERTY_ANALYSIS: [
            'bedrooms', 'bathrooms', 'sqft', 'lot_size', 'year_built', 'condition'
        ],
        WorkflowStage.MARKET_RESEARCH: [
            'approach_types', 'market_data'
        ],
        WorkflowStage.COMP_SELECTION: [
            'comps'
        ],
        WorkflowStage.ADJUSTMENTS: [
            'adjustments'
        ],
        WorkflowStage.RECONCILIATION: [
            'final_value_opinion'
        ],
    }

    def __init__(self, appraisal_id: str, knowledge_graph: Optional[KnowledgeGraph] = None):
        """
        Initialize the workflow agent.

        Args:
            appraisal_id: Unique identifier for this appraisal
            knowledge_graph: Optional KnowledgeGraph instance for storing/querying data
        """
        self.appraisal_id = appraisal_id
        self.state = AppraisalState()
        self.kg = knowledge_graph or KnowledgeGraph()
        self.conversation_history: List[Dict[str, str]] = []
        logger.info(f"Initialized WorkflowAgent for appraisal {appraisal_id}")

    def advance(self) -> Tuple[str, List[str]]:
        """
        Check what's missing in the current stage and generate prompts to advance.

        Returns:
            Tuple of (guidance_prompt, missing_fields_list)
        """
        current_stage = self.state.workflow_stage
        required_fields = self.REQUIRED_FIELDS_BY_STAGE.get(current_stage, [])

        missing_fields = []
        for field_name in required_fields:
            value = getattr(self.state, field_name, None)
            # Check if field is empty
            if value is None or (isinstance(value, (list, dict)) and len(value) == 0):
                missing_fields.append(field_name)

        if missing_fields:
            prompt = self._generate_field_prompt(current_stage, missing_fields)
        else:
            # All fields complete, check if we can advance
            if self._can_advance_stage():
                self._advance_to_next_stage()
                prompt = f"Completed {current_stage.value}. Moving to {self.state.workflow_stage.value}."
                missing_fields = []
            else:
                prompt = f"Stage {current_stage.value} complete. Ready to proceed when you are."
                missing_fields = []

        return prompt, missing_fields

    def process_input(self, user_input: str) -> Dict[str, Any]:
        """
        Use LLM to parse user natural language input and update state.

        Args:
            user_input: User's natural language response

        Returns:
            Dictionary with parsed fields, confidence scores, and any clarifications needed
        """
        self.conversation_history.append({"role": "user", "content": user_input})

        current_stage = self.state.workflow_stage
        required_fields = self.REQUIRED_FIELDS_BY_STAGE.get(current_stage, [])

        # Prepare context for the LLM
        context = {
            "appraisal_id": self.appraisal_id,
            "current_stage": current_stage.value,
            "required_fields": required_fields,
            "current_state": self.state.to_dict(),
        }

        # Build extraction prompt
        extraction_prompt = self._build_extraction_prompt(user_input, context)

        try:
            response = query_model(extraction_prompt)
            logger.debug(f"LLM response for input processing: {response}")

            # Parse the LLM response
            parsed_data = self._parse_extraction_response(response, required_fields)

            # Update state with parsed data
            self._update_state_from_parsed(parsed_data)

            # Add to conversation history
            self.conversation_history.append({"role": "assistant", "content": response})

            return {
                "success": True,
                "parsed_fields": parsed_data,
                "clarifications_needed": parsed_data.get("clarifications", []),
                "confidence": parsed_data.get("confidence", 0.0),
            }
        except Exception as e:
            logger.error(f"Error processing user input: {e}")
            return {
                "success": False,
                "error": str(e),
                "clarifications_needed": ["Could you please repeat that information?"],
            }

    def get_guidance(self) -> str:
        """
        Ask the model what to do next given current state.

        Returns:
            Guidance text describing the next recommended action
        """
        context = {
            "appraisal_id": self.appraisal_id,
            "current_stage": self.state.workflow_stage.value,
            "state_summary": self._summarize_state(),
            "issues": self.state.issues,
            "warnings": self.state.warnings,
        }

        guidance_prompt = f"""You are an expert real estate appraiser guiding an appraisal workflow.

Current Appraisal Status:
{json.dumps(context, indent=2)}

Based on the current state, what is the next recommended action? Be specific and professional.
Provide 2-3 actionable next steps."""

        try:
            guidance = query_model(guidance_prompt)
            logger.info(f"Generated guidance for appraisal {self.appraisal_id}")
            self.conversation_history.append({"role": "assistant", "content": guidance})
            return guidance
        except Exception as e:
            logger.error(f"Error generating guidance: {e}")
            return "Unable to generate guidance at this time. Please try again."

    def flag_issues(self) -> List[str]:
        """
        Check for problems in the appraisal data (e.g., comps too far away,
        age-adjusted comps needed, missing data).

        Returns:
            List of issue/warning messages
        """
        issues = []

        # Check comp distance
        if self.state.comps:
            for comp in self.state.comps:
                if comp.distance_miles > 1.0:
                    issues.append(
                        f"Comp at {comp.address} is {comp.distance_miles:.1f} miles away. "
                        "Consider additional comps within 1 mile."
                    )

        # Check comp age
        if self.state.comps and self.state.effective_date:
            try:
                effective_year = int(self.state.effective_date.split('-')[0])
                for comp in self.state.comps:
                    comp_year = int(comp.sale_date.split('-')[0])
                    if effective_year - comp_year > 2:
                        issues.append(
                            f"Comp at {comp.address} sold {effective_year - comp_year} years ago. "
                            "Consider more recent sales for market accuracy."
                        )
            except (ValueError, IndexError):
                logger.warning("Could not parse effective_date or comp sale_date")

        # Check for sufficient comps per approach
        if ApproachType.SALES_COMPARISON in self.state.approach_types:
            if len(self.state.comps) < 3:
                issues.append(
                    f"Sales Comparison Approach requires at least 3 comps; found {len(self.state.comps)}."
                )

        # Check subject property completeness
        if self.state.workflow_stage.value >= WorkflowStage.PROPERTY_ANALYSIS.value:
            required_property_fields = ['bedrooms', 'bathrooms', 'sqft', 'year_built', 'condition']
            for field in required_property_fields:
                if getattr(self.state, field, None) is None:
                    issues.append(f"Subject property {field} is missing.")

        # Check for missing market data when income approach is used
        if ApproachType.INCOME in self.state.approach_types:
            required_market_keys = ['cap_rate', 'noi']
            for key in required_market_keys:
                if key not in self.state.market_data:
                    issues.append(f"Market data missing '{key}' required for Income Approach.")

        # Update state and return
        self.state.issues = issues
        logger.info(f"Flagged {len(issues)} issues in appraisal {self.appraisal_id}")
        return issues

    def generate_report_data(self) -> Dict[str, Any]:
        """
        Compile all collected data into a report structure.

        Returns:
            Dictionary containing structured report data
        """
        self.flag_issues()  # Ensure issues are current

        report_data = {
            "appraisal_id": self.appraisal_id,
            "report_date": datetime.utcnow().isoformat(),
            "effective_date": self.state.effective_date,

            # Subject Property
            "subject_property": {
                "address": self.state.property_address,
                "property_type": self.state.property_type.value if self.state.property_type else None,
                "bedrooms": self.state.bedrooms,
                "bathrooms": self.state.bathrooms,
                "sqft": self.state.sqft,
                "lot_size": self.state.lot_size,
                "year_built": self.state.year_built,
                "condition": self.state.condition,
            },

            # Assignment Information
            "assignment": {
                "intended_use": self.state.intended_use,
                "intended_user": self.state.intended_user,
                "effective_date": self.state.effective_date,
            },

            # Approaches & Values
            "appraisal_approaches": {
                "methods_used": [a.value for a in self.state.approach_types],
                "cost_approach": {
                    "value": self.state.cost_approach_value,
                },
                "sales_comparison": {
                    "comparable_properties": [c.to_dict() for c in self.state.comps],
                    "value": self.state.sales_comp_value,
                },
                "income_approach": {
                    "value": self.state.income_approach_value,
                    "market_data": self.state.market_data,
                },
            },

            # Reconciliation
            "reconciliation": {
                "final_value_opinion": self.state.final_value_opinion,
                "approaches_used": len(self.state.approach_types),
            },

            # Quality Control
            "quality_control": {
                "issues": self.state.issues,
                "warnings": self.state.warnings,
                "completion_percentage": self.state.completion_percentage,
            },
        }

        logger.info(f"Generated report data for appraisal {self.appraisal_id}")
        return report_data

    # ===================== Private Methods =====================

    def _generate_field_prompt(self, stage: WorkflowStage, missing_fields: List[str]) -> str:
        """Generate a prompt asking for missing fields."""
        field_descriptions = {
            'property_address': "the subject property's street address",
            'property_type': "the property type (SFR, Condo, Multi-Family, or Commercial)",
            'intended_use': "the intended use of the appraisal (e.g., purchase, refinance, etc.)",
            'effective_date': "the effective date of the appraisal (YYYY-MM-DD)",
            'bedrooms': "the number of bedrooms",
            'bathrooms': "the number of bathrooms",
            'sqft': "the interior square footage",
            'lot_size': "the lot size in square feet",
            'year_built': "the year the property was built",
            'condition': "the property's condition (excellent, good, fair, poor)",
            'approach_types': "which appraisal approaches to use (cost, sales_comparison, income)",
            'market_data': "relevant market data (e.g., cap rates, NOI, market trends)",
            'comps': "comparable properties to use in the analysis",
            'adjustments': "adjustments for property differences",
            'final_value_opinion': "your final value opinion for the subject property",
        }

        descriptions = [field_descriptions.get(f, f) for f in missing_fields]
        prompt = f"Please provide {', '.join(descriptions)} to continue the {stage.value} stage."
        return prompt

    def _can_advance_stage(self) -> bool:
        """Check if current stage is complete and we can advance."""
        current_idx = self.WORKFLOW_STAGES.index(self.state.workflow_stage)
        return current_idx < len(self.WORKFLOW_STAGES) - 1

    def _advance_to_next_stage(self) -> None:
        """Move to the next workflow stage."""
        current_idx = self.WORKFLOW_STAGES.index(self.state.workflow_stage)
        if current_idx < len(self.WORKFLOW_STAGES) - 1:
            self.state.workflow_stage = self.WORKFLOW_STAGES[current_idx + 1]
            self._update_completion_percentage()
            logger.info(f"Advanced to {self.state.workflow_stage.value}")

    def _update_completion_percentage(self) -> None:
        """Calculate and update completion percentage."""
        current_idx = self.WORKFLOW_STAGES.index(self.state.workflow_stage)
        self.state.completion_percentage = int((current_idx / len(self.WORKFLOW_STAGES)) * 100)

    def _build_extraction_prompt(self, user_input: str, context: Dict[str, Any]) -> str:
        """Build the extraction prompt for the LLM."""
        field_list = context['required_fields']
        field_names = ', '.join(field_list)

        prompt = f"""You are parsing real estate appraisal data from user input.

Current stage: {context['current_stage']}
Required fields for this stage: {field_names}

User input: "{user_input}"

Extract and normalize the following information from the user input:
1. For each required field, extract the value if present
2. Rate your confidence (0.0-1.0) in the extraction
3. If any field is ambiguous or unclear, note it in "clarifications"
4. Normalize property types to: SFR, Condo, Multi-Family, or Commercial
5. Normalize condition to: Excellent, Good, Fair, or Poor
6. Return dates in YYYY-MM-DD format

Return a JSON object with:
{{
    "extracted_fields": {{"field_name": value, ...}},
    "confidence": 0.0-1.0,
    "clarifications": ["any ambiguous items"],
    "notes": "any additional context"
}}"""
        return prompt

    def _parse_extraction_response(self, response: str, required_fields: List[str]) -> Dict[str, Any]:
        """Parse the LLM's extraction response."""
        try:
            # Try to extract JSON from the response
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start != -1 and json_end > json_start:
                json_str = response[json_start:json_end]
                parsed = json.loads(json_str)
                return parsed
            else:
                logger.warning("No JSON found in extraction response")
                return {
                    "extracted_fields": {},
                    "confidence": 0.0,
                    "clarifications": ["Could not parse the response. Please try again."],
                }
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing extraction response: {e}")
            return {
                "extracted_fields": {},
                "confidence": 0.0,
                "clarifications": ["Error parsing response. Please try again."],
            }

    def _update_state_from_parsed(self, parsed_data: Dict[str, Any]) -> None:
        """Update AppraisalState from parsed LLM data."""
        extracted = parsed_data.get("extracted_fields", {})

        for field_name, value in extracted.items():
            if field_name == 'property_type' and value:
                try:
                    self.state.property_type = PropertyType(value)
                except ValueError:
                    logger.warning(f"Invalid property type: {value}")
            elif field_name == 'approach_types' and isinstance(value, list):
                self.state.approach_types = [ApproachType(a) for a in value if a]
            elif field_name == 'comps' and isinstance(value, list):
                self.state.comps = [
                    ComparableProperty.from_dict(c) if isinstance(c, dict) else c
                    for c in value
                ]
            elif field_name == 'market_data' and isinstance(value, dict):
                self.state.market_data.update(value)
            elif field_name == 'adjustments' and isinstance(value, dict):
                self.state.adjustments.update(value)
            elif hasattr(self.state, field_name):
                setattr(self.state, field_name, value)

        self.state.updated_at = datetime.utcnow().isoformat()

    def _summarize_state(self) -> str:
        """Create a human-readable summary of current state."""
        summary = f"""
Property: {self.state.property_address or 'Not specified'}
Type: {self.state.property_type.value if self.state.property_type else 'Not specified'}
Size: {self.state.sqft or 'Unknown'} sqft
Comparables: {len(self.state.comps)} selected
Approaches: {', '.join(a.value for a in self.state.approach_types) or 'None selected'}
Current Stage: {self.state.workflow_stage.value}
Completion: {self.state.completion_percentage}%
Issues: {len(self.state.issues)}
"""
        return summary.strip()

    def save_state(self, filepath: str) -> None:
        """
        Save the current appraisal state to a JSON file.

        Args:
            filepath: Path to save the state file
        """
        try:
            path = Path(filepath)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w') as f:
                json.dump(self.state.to_dict(), f, indent=2)
            logger.info(f"Saved appraisal state to {filepath}")
        except Exception as e:
            logger.error(f"Error saving state: {e}")
            raise

    def load_state(self, filepath: str) -> None:
        """
        Load appraisal state from a JSON file.

        Args:
            filepath: Path to load the state file from
        """
        try:
            path = Path(filepath)
            with open(path, 'r') as f:
                data = json.load(f)
            self.state = AppraisalState.from_dict(data)
            logger.info(f"Loaded appraisal state from {filepath}")
        except Exception as e:
            logger.error(f"Error loading state: {e}")
            raise

    def export_for_knowledge_graph(self) -> None:
        """Add appraisal data to the knowledge graph."""
        try:
            if not self.kg:
                logger.warning("Knowledge graph not initialized")
                return

            # Add subject property node
            self.kg.add_node(
                node_id=f"property_{self.appraisal_id}",
                node_type="property",
                attributes=self._extract_property_attributes(),
            )

            # Add comparable property nodes
            for i, comp in enumerate(self.state.comps):
                self.kg.add_node(
                    node_id=f"comp_{self.appraisal_id}_{i}",
                    node_type="comparable",
                    attributes=comp.to_dict(),
                )

            logger.info(f"Exported appraisal {self.appraisal_id} to knowledge graph")
        except Exception as e:
            logger.error(f"Error exporting to knowledge graph: {e}")

    def _extract_property_attributes(self) -> Dict[str, Any]:
        """Extract property attributes for knowledge graph."""
        return {
            "address": self.state.property_address,
            "property_type": self.state.property_type.value if self.state.property_type else None,
            "bedrooms": self.state.bedrooms,
            "bathrooms": self.state.bathrooms,
            "sqft": self.state.sqft,
            "lot_size": self.state.lot_size,
            "year_built": self.state.year_built,
            "condition": self.state.condition,
            "intended_use": self.state.intended_use,
            "effective_date": self.state.effective_date,
        }
