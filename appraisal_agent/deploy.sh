#!/bin/bash
# CACC Appraiser v3.1.0 — Pod Deployment Script
# Run this on the RunPod pod to install dependencies and start the dashboard

set -e

echo "============================================"
echo "  CACC Appraiser v3.1.0 — Deployment"
echo "============================================"

# Install Python dependencies
echo "[1/4] Installing Python dependencies..."
pip install fastapi uvicorn[standard] websockets python-multipart networkx reportlab --break-system-packages -q

# Create directories
echo "[2/4] Creating directories..."
mkdir -p /workspace/reports
mkdir -p /workspace/chroma_db

# Set environment variables
export VLLM_BASE_URL="${VLLM_BASE_URL:-http://localhost:8000/v1}"
export VLLM_MODEL="${VLLM_MODEL:-cacc-appraiser}"
export GRAPH_PERSIST="${GRAPH_PERSIST:-/workspace/knowledge_graph.json}"

# Verify vLLM is running
echo "[3/4] Checking vLLM server..."
if curl -s http://localhost:8000/v1/models > /dev/null 2>&1; then
    echo "  ✓ vLLM server is running"
else
    echo "  ✗ vLLM server not detected at localhost:8000"
    echo "    Start it first, or the chat feature won't work"
fi

# Launch the dashboard
echo "[4/4] Starting CACC Appraiser Dashboard on port 8080..."
echo "  Dashboard URL: https://$(hostname)-8080.proxy.runpod.net"
echo ""

cd /workspace/appraisal_agent
python launch.py --host 0.0.0.0 --port 8080
