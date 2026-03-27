"""
Configuration module for CACC Appraiser system.
Handles environment variables, API clients, and shared functions.
"""

import os
import json
import logging
from typing import Optional, List, Dict, Any
from openai import OpenAI

try:
    import chromadb
    from chromadb.config import Settings
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False
    chromadb = None

logger = logging.getLogger(__name__)

# Environment configuration
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "cacc-appraiser")
GRAPH_PERSIST_PATH = os.getenv("GRAPH_PERSIST_PATH", "/workspace/knowledge_graph.json")

# OpenAI client for vLLM
openai_client = OpenAI(
    api_key="not-needed",
    base_url=VLLM_BASE_URL
)

# ChromaDB client (lazy initialized)
_chroma_client = None
_chroma_collections: Dict[str, Any] = {}


def get_chroma_client():
    """Get or create ChromaDB client."""
    global _chroma_client
    if not HAS_CHROMADB:
        logger.warning("ChromaDB not installed. Vector search disabled.")
        return None
    if _chroma_client is None:
        try:
            chroma_path = os.path.join(
                os.path.dirname(GRAPH_PERSIST_PATH),
                ".chroma"
            )
            os.makedirs(chroma_path, exist_ok=True)
            settings = Settings(
                is_persistent=True,
                persist_directory=chroma_path,
                anonymized_telemetry=False
            )
            _chroma_client = chromadb.Client(settings)
        except Exception as e:
            logger.warning(f"Failed to create persistent ChromaDB: {e}. Using ephemeral.")
            _chroma_client = chromadb.Client()
    return _chroma_client


def get_or_create_collection(name: str):
    """Get or create a ChromaDB collection."""
    if not HAS_CHROMADB:
        logger.warning("ChromaDB not installed. Returning None for collection.")
        return None
    if name not in _chroma_collections:
        try:
            client = get_chroma_client()
            if client is None:
                return None
            _chroma_collections[name] = client.get_or_create_collection(
                name=name,
                metadata={"hnsw:space": "cosine"}
            )
        except Exception as e:
            logger.error(f"Failed to create collection {name}: {e}")
            return None
    return _chroma_collections[name]


def query_model(
    messages: List[Dict[str, str]],
    max_tokens: int = 2048,
    temperature: float = 0.7
) -> str:
    """
    Query the vLLM model with the given messages.

    Args:
        messages: List of message dicts with 'role' and 'content'
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature (0.0-1.0)

    Returns:
        The model's response text
    """
    try:
        response = openai_client.chat.completions.create(
            model=VLLM_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"Model query failed: {e}")
        raise


def web_search(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    Perform web search using DuckDuckGo.

    Args:
        query: Search query string
        max_results: Maximum number of results to return

    Returns:
        List of search result dicts with 'title', 'link', 'snippet'
    """
    try:
        from duckduckgo_search import DDGS

        results = []
        with DDGS() as ddgs:
            for result in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": result.get("title", ""),
                    "link": result.get("href", ""),
                    "snippet": result.get("body", "")
                })
        return results
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return []


def load_knowledge_graph() -> Dict[str, Any]:
    """Load persisted knowledge graph from disk."""
    if os.path.exists(GRAPH_PERSIST_PATH):
        try:
            with open(GRAPH_PERSIST_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load knowledge graph: {e}")
    return {"nodes": [], "edges": [], "metadata": {}}


def save_knowledge_graph(graph: Dict[str, Any]) -> None:
    """Save knowledge graph to disk."""
    try:
        os.makedirs(os.path.dirname(GRAPH_PERSIST_PATH), exist_ok=True)
        with open(GRAPH_PERSIST_PATH, 'w') as f:
            json.dump(graph, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save knowledge graph: {e}")


# Graph node types for visualization
NODE_TYPES = {
    "concept": {"color": "#FF6B6B", "label": "Concept"},
    "property": {"color": "#4ECDC4", "label": "Property"},
    "comparable": {"color": "#45B7D1", "label": "Comparable"},
    "market_area": {"color": "#FFA07A", "label": "Market Area"},
    "standard": {"color": "#98D8C8", "label": "Standard"},
    "data_source": {"color": "#F7DC6F", "label": "Data Source"},
    "user_knowledge": {"color": "#BB8FCE", "label": "User Knowledge"},
}

# Appraisal workflow states
APPRAISAL_STATES = [
    "start",
    "property_intake",
    "neighborhood_analysis",
    "market_research",
    "comparable_gathering",
    "comp_analysis",
    "adjustment_analysis",
    "value_reconciliation",
    "report_generation",
    "complete"
]
