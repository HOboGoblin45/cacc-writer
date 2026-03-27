#!/bin/bash
# Setup script for CACC Appraiser Hybrid RAG Agent
# Run this on the RunPod pod after vLLM is serving

set -e

echo "=== Installing Hybrid RAG dependencies ==="
pip install chromadb duckduckgo-search openai --break-system-packages

echo ""
echo "=== Creating ChromaDB data directory ==="
mkdir -p /workspace/chroma_db

echo ""
echo "=== Copying agent script to workspace ==="
# The hybrid_rag_agent.py should already be uploaded
if [ ! -f /workspace/hybrid_rag_agent.py ]; then
    echo "NOTE: Please upload hybrid_rag_agent.py to /workspace/"
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To run the agent interactively:"
echo "  python3 /workspace/hybrid_rag_agent.py"
echo ""
echo "To use as a library:"
echo "  from hybrid_rag_agent import AppraisalAgent"
echo "  agent = AppraisalAgent()"
echo "  response = agent.ask('What is the cost approach for a 3BR home in Miami?')"
echo ""
