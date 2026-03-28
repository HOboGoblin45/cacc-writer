#!/usr/bin/env python3
"""
CACC Appraiser v3.1.0 — Launch Script

Starts the web dashboard server with all components:
- Knowledge graph (seeded with appraisal knowledge)
- Guided workflow agent
- MLS integration
- Report generation
- FastAPI web server with D3.js graph visualization

Usage:
    python launch.py [--host 0.0.0.0] [--port 8080] [--reload]

Environment Variables:
    VLLM_BASE_URL  — vLLM server URL (default: http://localhost:8000/v1)
    VLLM_MODEL     — Model name (default: cacc-appraiser)
    MLS_API_KEY    — MLS/MRED API key (optional, enables MLS integration)
    GRAPH_PERSIST  — Knowledge graph save path (default: /workspace/knowledge_graph.json)
"""

import argparse
import os
import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("cacc-launcher")


def main():
    parser = argparse.ArgumentParser(description="CACC Appraiser v3.1.0 — Web Dashboard")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Port (default: 8080)")
    parser.add_argument("--reload", action="store_true", help="Auto-reload on code changes")
    args = parser.parse_args()

    # Print banner
    print("""
╔══════════════════════════════════════════════════════════╗
║           CACC APPRAISER v3.1.0                         ║
║           Hybrid RAG Appraisal Agent Platform           ║
╠══════════════════════════════════════════════════════════╣
║  Components:                                            ║
║  ✓ Knowledge Graph (D3.js force-directed visualization) ║
║  ✓ Guided Workflow Agent (model-driven appraisals)      ║
║  ✓ MLS/MRED Integration (comps & market data)           ║
║  ✓ Report Generator (PDF preview + XML export)          ║
║  ✓ Web Dashboard (real-time chat + graph brain)         ║
╚══════════════════════════════════════════════════════════╝
    """)

    # Show configuration
    vllm_url = os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1")
    vllm_model = os.environ.get("VLLM_MODEL", "cacc-appraiser")
    mls_key = os.environ.get("MLS_API_KEY", "")
    graph_path = os.environ.get("GRAPH_PERSIST", "/workspace/knowledge_graph.json")

    logger.info(f"vLLM Server:    {vllm_url}")
    logger.info(f"Model:          {vllm_model}")
    logger.info(f"MLS API Key:    {'configured' if mls_key else 'not set (using web search fallback)'}")
    logger.info(f"Graph Storage:  {graph_path}")
    logger.info(f"Dashboard:      http://{args.host}:{args.port}")
    print()

    # Launch FastAPI via uvicorn
    try:
        import uvicorn
        uvicorn.run(
            "appraisal_agent.server:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
            log_level="info",
            access_log=True
        )
    except ImportError:
        logger.error("uvicorn not installed. Run: pip install uvicorn")
        sys.exit(1)


if __name__ == "__main__":
    main()
