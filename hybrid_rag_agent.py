#!/usr/bin/env python3
"""
Hybrid RAG Agent for CACC Appraiser v3.1.0
Combines:
  1. Local vector DB (ChromaDB) for cached appraisal knowledge
  2. Live web search (DuckDuckGo) for current market data
  3. Your fine-tuned Llama 3.1 8B model via vLLM (OpenAI-compatible API)
"""

import os
import json
import re
import requests
from typing import List, Dict, Optional

# ── Configuration ──────────────────────────────────────────────────────────
VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "https://l1rb6jfw6lv7zv-8000.proxy.runpod.net/v1")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "cacc-appraiser")
CHROMA_PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", "/workspace/chroma_db")

# ── 1. Vector DB (ChromaDB) for cached appraisal knowledge ────────────────
import chromadb
from chromadb.utils import embedding_functions

def get_chroma_client():
    """Initialize ChromaDB with persistent storage."""
    return chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)

def get_or_create_collection(client, name="appraisal_knowledge"):
    """Get or create the appraisal knowledge collection with default embeddings."""
    ef = embedding_functions.DefaultEmbeddingFunction()  # all-MiniLM-L6-v2
    return client.get_or_create_collection(
        name=name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"}
    )

def seed_appraisal_knowledge(collection):
    """Seed the vector DB with core appraisal knowledge if empty."""
    if collection.count() > 0:
        print(f"  Collection already has {collection.count()} documents, skipping seed.")
        return

    knowledge = [
        {
            "id": "cost_approach",
            "text": "The Cost Approach estimates property value by calculating the cost to reproduce or replace the improvements, minus depreciation, plus land value. Formula: Value = Land Value + (Replacement Cost New - Depreciation). Three types of depreciation: physical deterioration, functional obsolescence, and external obsolescence. Best used for new or special-purpose properties.",
            "metadata": {"topic": "valuation_methods", "approach": "cost"}
        },
        {
            "id": "sales_comparison",
            "text": "The Sales Comparison Approach estimates value by comparing the subject property to recently sold comparable properties (comps). Adjustments are made for differences in location, size, condition, features, and sale date. Most reliable for residential properties with active markets. Requires at least 3-5 comparable sales within the past 6-12 months.",
            "metadata": {"topic": "valuation_methods", "approach": "sales_comparison"}
        },
        {
            "id": "income_approach",
            "text": "The Income Approach estimates value based on the property's ability to generate income. Two methods: Direct Capitalization (Value = NOI / Cap Rate) and Discounted Cash Flow (DCF). Used primarily for investment and commercial properties. Requires accurate rent rolls, operating expenses, vacancy rates, and market cap rates.",
            "metadata": {"topic": "valuation_methods", "approach": "income"}
        },
        {
            "id": "uspap_standards",
            "text": "USPAP (Uniform Standards of Professional Appraisal Practice) is the quality control standard for appraisals in the United States. Key standards: Standard 1 (Real Property Appraisal Development), Standard 2 (Real Property Appraisal Reporting). Requires competency, ethics, departure rules, and jurisdictional exceptions compliance. Updated biennially by The Appraisal Foundation.",
            "metadata": {"topic": "standards", "standard": "uspap"}
        },
        {
            "id": "highest_best_use",
            "text": "Highest and Best Use (HBU) analysis determines the most profitable, legally permissible, physically possible, and financially feasible use of a property. Must be analyzed both as vacant and as improved. HBU drives all three approaches to value. Four tests: legally permissible, physically possible, financially feasible, and maximally productive.",
            "metadata": {"topic": "concepts", "concept": "hbu"}
        },
        {
            "id": "market_conditions",
            "text": "Market conditions analysis examines supply and demand, absorption rates, days on market, price trends, inventory levels, and economic indicators. Appraisers must analyze trends over at least 12-36 months. Key metrics include median sale price changes, months of supply, list-to-sale price ratios, and foreclosure rates.",
            "metadata": {"topic": "market_analysis", "concept": "market_conditions"}
        },
        {
            "id": "depreciation_types",
            "text": "Three types of depreciation in appraisal: (1) Physical Deterioration - wear and tear from age and use, can be curable or incurable. (2) Functional Obsolescence - outdated design, layout, or features that reduce utility, such as outdated kitchens, poor floor plans. (3) External/Economic Obsolescence - value loss from factors outside the property like traffic, noise, environmental contamination, or adverse zoning changes. Always incurable.",
            "metadata": {"topic": "concepts", "concept": "depreciation"}
        },
        {
            "id": "gla_adjustments",
            "text": "Gross Living Area (GLA) adjustments are made on a per-square-foot basis using paired sales analysis or regression. Typical residential adjustments range from $20-$150/sqft depending on market. GLA is measured using ANSI Z765 standards - above-grade finished living area only. Below-grade finished space is reported separately and adjusted at a lower rate.",
            "metadata": {"topic": "adjustments", "concept": "gla"}
        },
        {
            "id": "cap_rate",
            "text": "Capitalization Rate (Cap Rate) = Net Operating Income (NOI) / Property Value. Used in the Income Approach for Direct Capitalization. Cap rates vary by property type, location, and market conditions. Lower cap rates indicate lower risk and higher prices. Derived from comparable sales of income properties. Current national averages: multifamily 5-7%, office 6-9%, retail 6-8%, industrial 5-7%.",
            "metadata": {"topic": "income_approach", "concept": "cap_rate"}
        },
        {
            "id": "site_valuation",
            "text": "Site valuation methods include: (1) Sales Comparison - comparing vacant land sales. (2) Allocation - extracting land value as percentage of total value. (3) Extraction - deducting improvement value from total sale price. (4) Land Residual - attributing income to land after building return. (5) Ground Rent Capitalization - capitalizing ground rent. (6) Subdivision Development - for raw land, discounted cash flow of lot sales minus development costs.",
            "metadata": {"topic": "valuation_methods", "concept": "site_valuation"}
        },
        {
            "id": "fannie_mae_guidelines",
            "text": "Fannie Mae appraisal guidelines require: comparable sales within 1 mile for urban/suburban (or justified further), sold within 12 months (6 months preferred), minimum 3 comparable sales, active and pending sales as support. Form 1004 for single-family, 1025 for 2-4 unit, 1073 for condos. Desktop appraisals allowed via Form 1004 Desktop. Hybrid appraisals permitted with third-party inspection.",
            "metadata": {"topic": "standards", "standard": "fannie_mae"}
        },
        {
            "id": "adjustment_grid",
            "text": "The adjustment grid is the core of the Sales Comparison Approach. Adjustments are made from comparable to subject (comp + adjustment = subject value indication). Sequence: transaction adjustments first (financing, conditions of sale, market conditions), then property adjustments (location, physical characteristics). Net adjustments should typically not exceed 15% and gross adjustments not exceed 25% of comp sale price.",
            "metadata": {"topic": "adjustments", "concept": "adjustment_grid"}
        },
    ]

    collection.add(
        ids=[k["id"] for k in knowledge],
        documents=[k["text"] for k in knowledge],
        metadatas=[k["metadata"] for k in knowledge]
    )
    print(f"  Seeded {len(knowledge)} appraisal knowledge documents into ChromaDB.")


# ── 2. Web Search (DuckDuckGo) for live market data ───────────────────────
def web_search(query: str, max_results: int = 5) -> List[Dict]:
    """Search the web using DuckDuckGo for current market data."""
    from duckduckgo_search import DDGS
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=max_results):
            results.append({
                "title": r.get("title", ""),
                "snippet": r.get("body", ""),
                "url": r.get("href", "")
            })
    return results


# ── 3. vLLM Model Client ──────────────────────────────────────────────────
def query_model(messages: List[Dict], max_tokens: int = 1024, temperature: float = 0.3) -> str:
    """Send a chat completion request to the vLLM server."""
    import openai
    client = openai.OpenAI(base_url=VLLM_BASE_URL, api_key="not-needed")
    response = client.chat.completions.create(
        model=VLLM_MODEL,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature
    )
    return response.choices[0].message.content


# ── 4. Hybrid RAG Agent ──────────────────────────────────────────────────
class AppraisalAgent:
    """
    Hybrid RAG agent that:
    1. Searches local vector DB for relevant cached knowledge
    2. Searches the web for current market data when needed
    3. Combines both context sources and sends to the fine-tuned model
    """

    SYSTEM_PROMPT = """You are CACC Appraiser v3.1.0, an expert AI real estate appraiser.
You have access to both cached appraisal knowledge and live market data from the internet.

When answering questions:
- Use the provided CACHED KNOWLEDGE for appraisal concepts, standards, and methods
- Use the provided WEB SEARCH RESULTS for current market data, prices, and trends
- Cite your sources when referencing specific data
- If information conflicts, prefer more recent web data for market conditions
- Always apply USPAP standards in your analysis
- Be specific with numbers, dates, and locations when available

You are replacing human appraisers for analysis tasks. Provide thorough, professional responses."""

    # Keywords that trigger web search for current data
    WEB_SEARCH_TRIGGERS = [
        "current", "today", "recent", "latest", "2024", "2025", "2026",
        "price", "market value", "median", "average price", "trend",
        "for sale", "sold", "listing", "mls", "zillow", "redfin",
        "interest rate", "mortgage rate", "cap rate current",
        "neighborhood", "area", "city", "county", "zip code",
        "comparable", "comp", "comps", "recently sold",
        "market condition", "supply", "demand", "inventory",
        "forecast", "prediction", "outlook",
    ]

    def __init__(self):
        print("Initializing CACC Appraiser Hybrid RAG Agent...")
        self.chroma_client = get_chroma_client()
        self.collection = get_or_create_collection(self.chroma_client)
        seed_appraisal_knowledge(self.collection)
        print("Agent ready.\n")

    def needs_web_search(self, query: str) -> bool:
        """Determine if the query needs live web data."""
        query_lower = query.lower()
        return any(trigger in query_lower for trigger in self.WEB_SEARCH_TRIGGERS)

    def search_knowledge_base(self, query: str, n_results: int = 3) -> List[str]:
        """Search the local vector DB for relevant cached knowledge."""
        results = self.collection.query(query_texts=[query], n_results=n_results)
        docs = results.get("documents", [[]])[0]
        return docs

    def search_web(self, query: str) -> List[Dict]:
        """Search the web for current market data."""
        # Enhance query for real estate context
        enhanced_query = f"real estate appraisal {query}"
        try:
            results = web_search(enhanced_query, max_results=5)
            return results
        except Exception as e:
            print(f"  Web search error: {e}")
            return []

    def build_context(self, query: str) -> str:
        """Build context from both knowledge base and web search."""
        context_parts = []

        # Always search local knowledge base
        print("  Searching cached knowledge base...")
        kb_results = self.search_knowledge_base(query)
        if kb_results:
            context_parts.append("=== CACHED APPRAISAL KNOWLEDGE ===")
            for i, doc in enumerate(kb_results, 1):
                context_parts.append(f"[Knowledge {i}]: {doc}")
            context_parts.append("")

        # Conditionally search the web
        if self.needs_web_search(query):
            print("  Query needs current data — searching the web...")
            web_results = self.search_web(query)
            if web_results:
                context_parts.append("=== LIVE WEB SEARCH RESULTS ===")
                for i, r in enumerate(web_results, 1):
                    context_parts.append(f"[Web {i}] {r['title']}")
                    context_parts.append(f"  {r['snippet']}")
                    context_parts.append(f"  Source: {r['url']}")
                context_parts.append("")
        else:
            print("  Using cached knowledge only (no web search needed).")

        return "\n".join(context_parts)

    def ask(self, query: str) -> str:
        """Process a query through the full hybrid RAG pipeline."""
        print(f"\n{'='*60}")
        print(f"Query: {query}")
        print(f"{'='*60}")

        # Build context
        context = self.build_context(query)

        # Build messages
        messages = [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {"role": "user", "content": f"""Based on the following context, please answer the question.

{context}

QUESTION: {query}

Provide a thorough, professional appraisal response:"""}
        ]

        # Query the model
        print("  Querying CACC Appraiser model...")
        response = query_model(messages, max_tokens=1024, temperature=0.3)
        print(f"{'='*60}\n")
        return response

    def add_knowledge(self, doc_id: str, text: str, metadata: dict = None):
        """Add new knowledge to the vector DB."""
        self.collection.add(
            ids=[doc_id],
            documents=[text],
            metadatas=[metadata or {}]
        )
        print(f"  Added document '{doc_id}' to knowledge base.")

    def add_knowledge_batch(self, documents: List[Dict]):
        """Add multiple documents to the knowledge base.
        Each dict should have: id, text, and optionally metadata.
        """
        self.collection.add(
            ids=[d["id"] for d in documents],
            documents=[d["text"] for d in documents],
            metadatas=[d.get("metadata", {}) for d in documents]
        )
        print(f"  Added {len(documents)} documents to knowledge base.")


# ── 5. CLI Interface ─────────────────────────────────────────────────────
def main():
    """Interactive CLI for the Appraisal Agent."""
    agent = AppraisalAgent()

    print("=" * 60)
    print("  CACC Appraiser v3.1.0 — Hybrid RAG Agent")
    print("  Type your appraisal questions, or 'quit' to exit.")
    print("  The agent uses cached knowledge + live web search.")
    print("=" * 60)

    while True:
        try:
            query = input("\n[You]: ").strip()
            if not query:
                continue
            if query.lower() in ("quit", "exit", "q"):
                print("Goodbye!")
                break

            response = agent.ask(query)
            print(f"\n[CACC Appraiser]: {response}")

        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"\nError: {e}")


if __name__ == "__main__":
    main()
