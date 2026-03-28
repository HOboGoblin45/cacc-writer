"""
Knowledge Graph for Real Estate Appraisal AI System

This module implements a persistent, queryable knowledge graph that serves as the
"brain" of the appraisal system. It visualizes how appraisal knowledge is connected,
including concepts, properties, comparables, market areas, standards, and data sources.
"""

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx
from difflib import SequenceMatcher

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Node type constants
CONCEPT = "CONCEPT"
PROPERTY = "PROPERTY"
COMP = "COMP"
MARKET_AREA = "MARKET_AREA"
STANDARD = "STANDARD"
DATA_SOURCE = "DATA_SOURCE"
USER_KNOWLEDGE = "USER_KNOWLEDGE"

NODE_TYPES = {CONCEPT, PROPERTY, COMP, MARKET_AREA, STANDARD, DATA_SOURCE, USER_KNOWLEDGE}

# Color mapping for visualization
NODE_COLORS = {
    CONCEPT: "#e74c3c",
    PROPERTY: "#3498db",
    COMP: "#2ecc71",
    MARKET_AREA: "#f1c40f",
    STANDARD: "#9b59b6",
    DATA_SOURCE: "#e67e22",
    USER_KNOWLEDGE: "#1abc9c",
}

# Relationship type constants
RELATED_TO = "RELATED_TO"
APPLIES_TO = "APPLIES_TO"
LOCATED_IN = "LOCATED_IN"
COMPARABLE_TO = "COMPARABLE_TO"
DERIVED_FROM = "DERIVED_FROM"
SUPPORTS = "SUPPORTS"
CONTRADICTS = "CONTRADICTS"
UPDATES = "UPDATES"
REQUIRES = "REQUIRES"

RELATIONSHIP_TYPES = {
    RELATED_TO,
    APPLIES_TO,
    LOCATED_IN,
    COMPARABLE_TO,
    DERIVED_FROM,
    SUPPORTS,
    CONTRADICTS,
    UPDATES,
    REQUIRES,
}


class KnowledgeGraph:
    """
    A persistent, queryable knowledge graph for real estate appraisal knowledge.

    Uses NetworkX as the graph engine with JSON-based persistence.
    """

    def __init__(self, persist_path: str = "appraisal_knowledge.json") -> None:
        """
        Initialize the knowledge graph.

        Args:
            persist_path: Path to JSON file for persistence (created if doesn't exist)
        """
        self.persist_path = Path(persist_path)
        self.graph: nx.DiGraph = nx.DiGraph()
        self._id_counter = 0

        # Load existing graph or create new
        if self.persist_path.exists():
            self.load()
            logger.info(f"Loaded knowledge graph from {self.persist_path}")
        else:
            logger.info(f"Creating new knowledge graph (will persist to {self.persist_path})")

    def _generate_id(self, prefix: str = "node") -> str:
        """Generate a unique node ID."""
        self._id_counter += 1
        return f"{prefix}_{self._id_counter}_{uuid.uuid4().hex[:8]}"

    def add_node(
        self,
        node_id: str,
        node_type: str,
        label: str,
        properties: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Add a node to the graph.

        Args:
            node_id: Unique identifier for the node
            node_type: Type of node (CONCEPT, PROPERTY, COMP, MARKET_AREA, STANDARD, DATA_SOURCE, USER_KNOWLEDGE)
            label: Human-readable label for the node
            properties: Optional dictionary of additional properties

        Returns:
            The node_id that was added

        Raises:
            ValueError: If node_type is invalid
        """
        if node_type not in NODE_TYPES:
            raise ValueError(f"Invalid node_type: {node_type}. Must be one of {NODE_TYPES}")

        properties = properties or {}
        self.graph.add_node(
            node_id,
            node_type=node_type,
            label=label,
            color=NODE_COLORS[node_type],
            created_at=datetime.utcnow().isoformat(),
            **properties,
        )
        logger.debug(f"Added {node_type} node: {node_id} ({label})")
        return node_id

    def add_edge(
        self,
        source: str,
        target: str,
        relationship: str,
        properties: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Add a directed edge between two nodes.

        Args:
            source: Source node ID
            target: Target node ID
            relationship: Type of relationship
            properties: Optional dictionary of additional properties

        Raises:
            ValueError: If nodes don't exist or relationship type is invalid
            ValueError: If relationship type is invalid
        """
        if source not in self.graph:
            raise ValueError(f"Source node {source} does not exist")
        if target not in self.graph:
            raise ValueError(f"Target node {target} does not exist")
        if relationship not in RELATIONSHIP_TYPES:
            raise ValueError(
                f"Invalid relationship: {relationship}. Must be one of {RELATIONSHIP_TYPES}"
            )

        properties = properties or {}
        self.graph.add_edge(
            source,
            target,
            relationship=relationship,
            created_at=datetime.utcnow().isoformat(),
            **properties,
        )
        logger.debug(f"Added edge: {source} --[{relationship}]--> {target}")

    def add_knowledge(
        self, text: str, node_type: str, metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Add knowledge as a new node with auto-generated ID.

        Args:
            text: The knowledge text (used as node label)
            node_type: Type of node
            metadata: Optional metadata to attach to the node

        Returns:
            The generated node_id
        """
        node_id = self._generate_id(prefix=node_type.lower())
        metadata = metadata or {}
        self.add_node(node_id, node_type, text, properties=metadata)
        return node_id

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single node with all its edges.

        Args:
            node_id: The node ID to retrieve

        Returns:
            Dictionary with node data and connected edges, or None if node doesn't exist
        """
        if node_id not in self.graph:
            return None

        node_data = dict(self.graph.nodes[node_id])
        node_data["id"] = node_id

        # Get incoming and outgoing edges
        incoming = []
        for source in self.graph.predecessors(node_id):
            edge_data = dict(self.graph.edges[source, node_id])
            incoming.append({"source": source, "data": edge_data})

        outgoing = []
        for target in self.graph.successors(node_id):
            edge_data = dict(self.graph.edges[node_id, target])
            outgoing.append({"target": target, "data": edge_data})

        return {
            "node": node_data,
            "incoming_edges": incoming,
            "outgoing_edges": outgoing,
        }

    def query_related(self, node_id: str, depth: int = 2) -> Dict[str, Any]:
        """
        Query for related nodes within N hops.

        Args:
            node_id: Starting node ID
            depth: Number of hops to traverse

        Returns:
            Dictionary containing subgraph nodes and edges
        """
        if node_id not in self.graph:
            logger.warning(f"Node {node_id} not found in graph")
            return {"nodes": [], "edges": []}

        # BFS to find all nodes within depth hops
        visited = set()
        queue = [(node_id, 0)]
        related_nodes = set()

        while queue:
            current, current_depth = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            related_nodes.add(current)

            if current_depth < depth:
                # Explore successors
                for successor in self.graph.successors(current):
                    if successor not in visited:
                        queue.append((successor, current_depth + 1))
                # Explore predecessors
                for predecessor in self.graph.predecessors(current):
                    if predecessor not in visited:
                        queue.append((predecessor, current_depth + 1))

        # Build result
        nodes = []
        for nid in related_nodes:
            node_data = dict(self.graph.nodes[nid])
            node_data["id"] = nid
            nodes.append(node_data)

        edges = []
        for source, target in self.graph.edges:
            if source in related_nodes and target in related_nodes:
                edge_data = dict(self.graph.edges[source, target])
                edges.append(
                    {
                        "source": source,
                        "target": target,
                        **edge_data,
                    }
                )

        return {"nodes": nodes, "edges": edges, "query_root": node_id, "depth": depth}

    def search_nodes(
        self, query: str, node_type: Optional[str] = None, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Fuzzy text search across node labels and properties.

        Args:
            query: Search query string
            node_type: Optional filter by node type
            limit: Maximum number of results

        Returns:
            List of matching nodes sorted by relevance
        """
        results = []

        for node_id, node_data in self.graph.nodes(data=True):
            # Filter by type if specified
            if node_type and node_data.get("node_type") != node_type:
                continue

            label = node_data.get("label", "").lower()
            query_lower = query.lower()

            # Exact match gets highest score
            if query_lower == label:
                score = 1.0
            # Substring match gets high score
            elif query_lower in label:
                score = 0.8
            # Fuzzy match
            else:
                score = SequenceMatcher(None, query_lower, label).ratio()

            if score > 0.3:  # Threshold for relevance
                result = dict(node_data)
                result["id"] = node_id
                result["match_score"] = score
                results.append(result)

        # Sort by relevance and limit
        results.sort(key=lambda x: x["match_score"], reverse=True)
        return results[:limit]

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about the graph.

        Returns:
            Dictionary with counts and metrics
        """
        node_counts = {}
        for node_type in NODE_TYPES:
            count = sum(
                1 for _, data in self.graph.nodes(data=True)
                if data.get("node_type") == node_type
            )
            node_counts[node_type] = count

        relationship_counts = {}
        for rel_type in RELATIONSHIP_TYPES:
            count = sum(
                1 for _, _, data in self.graph.edges(data=True)
                if data.get("relationship") == rel_type
            )
            relationship_counts[rel_type] = count

        return {
            "total_nodes": self.graph.number_of_nodes(),
            "total_edges": self.graph.number_of_edges(),
            "nodes_by_type": node_counts,
            "edges_by_type": relationship_counts,
            "density": nx.density(self.graph),
            "is_connected": nx.is_weakly_connected(self.graph),
        }

    def to_vis_json(self) -> Dict[str, Any]:
        """
        Export the full graph as JSON for D3.js force-directed visualization.

        Returns:
            Dictionary with 'nodes' and 'links' arrays for D3.js
        """
        # Calculate degree centrality for node sizing
        degree_centrality = nx.degree_centrality(self.graph)

        nodes = []
        for node_id, node_data in self.graph.nodes(data=True):
            # Size is proportional to degree centrality, scaled to 10-40
            size = 10 + (degree_centrality.get(node_id, 0) * 30)

            node = {
                "id": node_id,
                "label": node_data.get("label", node_id),
                "type": node_data.get("node_type", "UNKNOWN"),
                "color": node_data.get("color", "#95a5a6"),
                "size": size,
                "properties": {
                    k: v
                    for k, v in node_data.items()
                    if k not in {"label", "node_type", "color", "created_at"}
                },
            }
            nodes.append(node)

        links = []
        for source, target, edge_data in self.graph.edges(data=True):
            link = {
                "source": source,
                "target": target,
                "relationship": edge_data.get("relationship", "UNKNOWN"),
                "properties": {
                    k: v for k, v in edge_data.items() if k != "relationship"
                },
            }
            links.append(link)

        return {"nodes": nodes, "links": links}

    def to_subgraph_vis_json(self, node_ids: List[str]) -> Dict[str, Any]:
        """
        Export a subgraph as JSON for visualization.

        Args:
            node_ids: List of node IDs to include

        Returns:
            Dictionary with 'nodes' and 'links' arrays for D3.js
        """
        # Create subgraph
        subgraph = self.graph.subgraph(node_ids)

        # Calculate degree centrality for the subgraph
        degree_centrality = nx.degree_centrality(subgraph)

        nodes = []
        for node_id in subgraph.nodes():
            node_data = dict(self.graph.nodes[node_id])
            size = 10 + (degree_centrality.get(node_id, 0) * 30)

            node = {
                "id": node_id,
                "label": node_data.get("label", node_id),
                "type": node_data.get("node_type", "UNKNOWN"),
                "color": node_data.get("color", "#95a5a6"),
                "size": size,
                "properties": {
                    k: v
                    for k, v in node_data.items()
                    if k not in {"label", "node_type", "color", "created_at"}
                },
            }
            nodes.append(node)

        links = []
        for source, target in subgraph.edges():
            edge_data = dict(self.graph.edges[source, target])
            link = {
                "source": source,
                "target": target,
                "relationship": edge_data.get("relationship", "UNKNOWN"),
                "properties": {
                    k: v for k, v in edge_data.items() if k != "relationship"
                },
            }
            links.append(link)

        return {"nodes": nodes, "links": links}

    def merge_user_knowledge(self, documents: List[Dict[str, str]]) -> List[str]:
        """
        Bulk add user-provided documents, creating nodes and auto-detecting relationships.

        Args:
            documents: List of documents, each with 'title' and 'content' keys

        Returns:
            List of created node IDs
        """
        created_node_ids = []

        for doc in documents:
            title = doc.get("title", "Untitled")
            content = doc.get("content", "")

            # Create node for the document
            node_id = self.add_knowledge(
                text=title,
                node_type=USER_KNOWLEDGE,
                metadata={
                    "content_preview": content[:200],
                    "content_length": len(content),
                    "full_content": content,
                },
            )
            created_node_ids.append(node_id)

            # Auto-detect relationships with existing nodes
            # Simple heuristic: search for concept keywords in content
            keywords_to_search = [
                "cost approach",
                "sales comparison",
                "income approach",
                "depreciation",
                "adjustment",
                "comparable",
                "market",
                "property",
                "USPAP",
                "Fannie Mae",
                "FHA",
                "appraisal",
            ]

            for keyword in keywords_to_search:
                if keyword.lower() in content.lower():
                    # Find matching concept nodes
                    matches = self.search_nodes(keyword, node_type=CONCEPT, limit=3)
                    for match in matches:
                        try:
                            self.add_edge(
                                node_id,
                                match["id"],
                                DERIVED_FROM,
                                properties={"auto_detected": True},
                            )
                        except ValueError:
                            pass

        logger.info(f"Merged {len(created_node_ids)} user knowledge documents")
        return created_node_ids

    def save(self) -> None:
        """Persist the graph to JSON file."""
        data = {
            "nodes": {},
            "edges": [],
            "metadata": {
                "created_at": datetime.utcnow().isoformat(),
                "node_count": self.graph.number_of_nodes(),
                "edge_count": self.graph.number_of_edges(),
            },
        }

        # Serialize nodes
        for node_id, node_data in self.graph.nodes(data=True):
            data["nodes"][node_id] = dict(node_data)

        # Serialize edges
        for source, target, edge_data in self.graph.edges(data=True):
            data["edges"].append(
                {
                    "source": source,
                    "target": target,
                    **dict(edge_data),
                }
            )

        # Write to file
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.persist_path, "w") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved knowledge graph to {self.persist_path}")

    def load(self) -> None:
        """Load the graph from JSON file."""
        if not self.persist_path.exists():
            logger.warning(f"Persist file {self.persist_path} does not exist")
            return

        with open(self.persist_path, "r") as f:
            data = json.load(f)

        # Load nodes
        for node_id, node_data in data.get("nodes", {}).items():
            self.graph.add_node(node_id, **node_data)

        # Load edges
        for edge in data.get("edges", []):
            source = edge.pop("source")
            target = edge.pop("target")
            self.graph.add_edge(source, target, **edge)

        logger.info(
            f"Loaded knowledge graph: {self.graph.number_of_nodes()} nodes, "
            f"{self.graph.number_of_edges()} edges"
        )

    def seed_appraisal_knowledge(self) -> None:
        """
        Seed the graph with core appraisal knowledge and establish relationships.

        This creates 12+ foundational appraisal concepts and connects them
        with meaningful relationships.
        """
        # Define core concepts
        concepts = {
            "cost_approach": {
                "label": "Cost Approach",
                "description": "Valuation method based on replacement cost",
            },
            "sales_comparison": {
                "label": "Sales Comparison Approach",
                "description": "Valuation based on comparable recent sales",
            },
            "income_approach": {
                "label": "Income Approach",
                "description": "Valuation based on income-generating capacity",
            },
            "depreciation": {
                "label": "Depreciation",
                "description": "Decline in value due to physical, functional, or external factors",
            },
            "site_valuation": {
                "label": "Site Valuation",
                "description": "Valuation of land excluding improvements",
            },
            "hbu": {
                "label": "Highest and Best Use (HBU)",
                "description": "Most productive use of a property",
            },
            "gla_adjustment": {
                "label": "GLA Adjustments",
                "description": "Adjustments based on Gross Living Area differences",
            },
            "cap_rate": {
                "label": "Capitalization Rate",
                "description": "Rate of return on income-producing property",
            },
            "adjustment_grid": {
                "label": "Adjustment Grid",
                "description": "Grid for reconciling adjustments in sales comparison",
            },
            "market_conditions": {
                "label": "Market Conditions Analysis",
                "description": "Analysis of supply, demand, and market trends",
            },
        }

        # Define standards and guidelines
        standards = {
            "uspap": {
                "label": "USPAP Standards",
                "description": "Uniform Standards of Professional Appraisal Practice",
            },
            "fannie_mae": {
                "label": "Fannie Mae Guidelines",
                "description": "Fannie Mae appraisal and underwriting guidelines",
            },
            "fha_standards": {
                "label": "FHA Standards",
                "description": "Federal Housing Administration standards",
            },
        }

        # Add concept nodes
        concept_ids = {}
        for concept_key, concept_data in concepts.items():
            node_id = self.add_node(
                node_id=f"concept_{concept_key}",
                node_type=CONCEPT,
                label=concept_data["label"],
                properties={"description": concept_data["description"]},
            )
            concept_ids[concept_key] = node_id

        # Add standard nodes
        standard_ids = {}
        for standard_key, standard_data in standards.items():
            node_id = self.add_node(
                node_id=f"standard_{standard_key}",
                node_type=STANDARD,
                label=standard_data["label"],
                properties={"description": standard_data["description"]},
            )
            standard_ids[standard_key] = node_id

        # Define relationships between concepts
        relationships = [
            # Cost Approach relationships
            (
                "cost_approach",
                "site_valuation",
                REQUIRES,
                "Cost Approach requires land valuation",
            ),
            (
                "cost_approach",
                "depreciation",
                REQUIRES,
                "Cost Approach accounts for depreciation",
            ),
            (
                "depreciation",
                "cost_approach",
                RELATED_TO,
                "Depreciation is key component",
            ),
            # Sales Comparison relationships
            (
                "sales_comparison",
                "gla_adjustment",
                REQUIRES,
                "Sales Comparison uses GLA adjustments",
            ),
            ("sales_comparison", "adjustment_grid", REQUIRES, "Requires adjustment grid"),
            (
                "sales_comparison",
                "market_conditions",
                RELATED_TO,
                "Influenced by market conditions",
            ),
            # Income Approach relationships
            (
                "income_approach",
                "cap_rate",
                REQUIRES,
                "Income Approach applies cap rates",
            ),
            (
                "cap_rate",
                "income_approach",
                RELATED_TO,
                "Cap rate is core to income approach",
            ),
            # HBU relationships
            (
                "hbu",
                "site_valuation",
                APPLIES_TO,
                "HBU applies to site valuation",
            ),
            ("hbu", "cost_approach", APPLIES_TO, "HBU applies to cost approach"),
            ("hbu", "sales_comparison", APPLIES_TO, "HBU applies to sales comparison"),
            (
                "hbu",
                "income_approach",
                APPLIES_TO,
                "HBU applies to income approach",
            ),
            # Market conditions
            (
                "market_conditions",
                "sales_comparison",
                SUPPORTS,
                "Market conditions support adjustments",
            ),
        ]

        # Add edges for concept relationships
        for source_key, target_key, rel_type, description in relationships:
            source_id = concept_ids.get(source_key)
            target_id = concept_ids.get(target_key)
            if source_id and target_id:
                self.add_edge(
                    source_id,
                    target_id,
                    rel_type,
                    properties={"description": description},
                )

        # Connect approaches to USPAP
        for approach_key in ["cost_approach", "sales_comparison", "income_approach"]:
            self.add_edge(
                concept_ids[approach_key],
                standard_ids["uspap"],
                APPLIES_TO,
                properties={"description": "Must comply with USPAP standards"},
            )

        # Connect all approaches and concepts to Fannie Mae guidelines
        for concept_key in list(concepts.keys())[:5]:  # First 5 key concepts
            self.add_edge(
                concept_ids[concept_key],
                standard_ids["fannie_mae"],
                APPLIES_TO,
                properties={"description": "Subject to Fannie Mae guidelines"},
            )

        # Add data source examples
        data_sources = {
            "mls": {
                "label": "MLS Database",
                "description": "Multiple Listing Service for comparable sales",
            },
            "public_records": {
                "label": "Public Records",
                "description": "County assessor and deed records",
            },
            "census": {
                "label": "Census Data",
                "description": "Demographic and economic data",
            },
        }

        for source_key, source_data in data_sources.items():
            source_id = self.add_node(
                node_id=f"source_{source_key}",
                node_type=DATA_SOURCE,
                label=source_data["label"],
                properties={"description": source_data["description"]},
            )
            # Connect data sources to relevant concepts
            if source_key == "mls":
                self.add_edge(
                    source_id,
                    concept_ids["sales_comparison"],
                    SUPPORTS,
                    properties={"description": "Provides comparable sales data"},
                )

        logger.info("Seeded appraisal knowledge graph with core concepts and relationships")

    def clear(self) -> None:
        """Clear all nodes and edges from the graph."""
        self.graph.clear()
        self._id_counter = 0
        logger.info("Cleared knowledge graph")
