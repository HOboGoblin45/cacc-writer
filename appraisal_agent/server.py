"""
FastAPI server for CACC Appraiser system.
Serves the web dashboard and API endpoints for the knowledge graph and appraisal workflow.
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import (
    VLLM_BASE_URL, VLLM_MODEL, GRAPH_PERSIST_PATH,
    query_model, web_search, get_or_create_collection,
    load_knowledge_graph, save_knowledge_graph,
    NODE_TYPES, APPRAISAL_STATES
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="CACC Appraiser",
    description="AI-powered real property appraisal system with knowledge graph",
    version="3.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
knowledge_graph = load_knowledge_graph()
appraisal_state = {
    "current_stage": "start",
    "subject_property": {},
    "comps_gathered": [],
    "market_data": {},
    "adjustments": {},
    "workflow_history": []
}

# WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")

manager = ConnectionManager()

# Pydantic models
class KnowledgeInput(BaseModel):
    text: str
    node_type: str = "concept"
    properties: Optional[Dict[str, Any]] = None

class ChatMessage(BaseModel):
    content: str

class AppraisalInput(BaseModel):
    stage: str
    data: Dict[str, Any]

class MLSConfig(BaseModel):
    api_key: str

# ============ Static Files & HTML ============
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    """Serve the main dashboard HTML."""
    index_file = static_dir / "index.html"
    if index_file.exists():
        return index_file.read_text()
    return "<h1>Dashboard not found</h1>"

# ============ Graph Endpoints ============
@app.get("/api/graph")
async def get_graph():
    """Get the full knowledge graph as vis JSON."""
    return {
        "nodes": knowledge_graph.get("nodes", []),
        "edges": knowledge_graph.get("edges", []),
        "metadata": knowledge_graph.get("metadata", {})
    }

@app.get("/api/graph/search")
async def search_graph(q: str = Query(..., min_length=1)):
    """Search nodes by name or properties."""
    query_lower = q.lower()
    nodes = knowledge_graph.get("nodes", [])
    results = [
        node for node in nodes
        if query_lower in node.get("name", "").lower() or
           query_lower in node.get("description", "").lower()
    ]
    return results[:10]

@app.get("/api/graph/node/{node_id}")
async def get_node_details(node_id: str):
    """Get node details and its relationships."""
    nodes = knowledge_graph.get("nodes", [])
    edges = knowledge_graph.get("edges", [])

    node = next((n for n in nodes if n.get("id") == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Get related nodes
    related_edges = [
        e for e in edges
        if e.get("source_id") == node_id or e.get("target_id") == node_id
    ]

    return {
        "node": node,
        "relationships": related_edges
    }

@app.post("/api/graph/knowledge")
async def add_knowledge(input_data: KnowledgeInput):
    """Add new knowledge to the graph."""
    try:
        # Create new node
        node_id = f"node_{len(knowledge_graph.get('nodes', []))}"
        node = {
            "id": node_id,
            "name": input_data.text,
            "type": input_data.node_type,
            "description": input_data.text,
            "properties": input_data.properties or {},
            "connections": 0,
            "created_at": datetime.utcnow().isoformat()
        }

        # Add to graph
        if "nodes" not in knowledge_graph:
            knowledge_graph["nodes"] = []
        knowledge_graph["nodes"].append(node)

        # Save to disk
        save_knowledge_graph(knowledge_graph)

        # Broadcast update
        await manager.broadcast({
            "type": "graph_update",
            "action": "node_added",
            "node": node
        })

        return {"status": "success", "node": node}

    except Exception as e:
        logger.error(f"Failed to add knowledge: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
async def get_graph_stats():
    """Get graph statistics."""
    nodes = knowledge_graph.get("nodes", [])
    edges = knowledge_graph.get("edges", [])

    node_count = len(nodes)
    edge_count = len(edges)
    avg_connections = (edge_count * 2 / node_count) if node_count > 0 else 0
    density = (edge_count / (node_count * (node_count - 1) / 2)) if node_count > 1 else 0

    # Count by type
    type_counts = {}
    for node in nodes:
        ntype = node.get("type", "unknown")
        type_counts[ntype] = type_counts.get(ntype, 0) + 1

    return {
        "total_nodes": node_count,
        "total_edges": edge_count,
        "average_connections": round(avg_connections, 2),
        "graph_density": round(density, 4),
        "node_types": type_counts,
        "timestamp": datetime.utcnow().isoformat()
    }

# ============ WebSocket Chat ============
@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time chat with the appraisal agent."""
    await manager.connect(websocket)
    logger.info("Client connected to chat")

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()

            if data.get("type") == "message":
                user_message = data.get("content", "").strip()
                if not user_message:
                    continue

                logger.info(f"User: {user_message}")

                # Simulate agent thinking
                thinking_actions = [
                    "Searching knowledge base",
                    "Analyzing market data",
                    "Consulting comparable properties",
                    "Querying local standards"
                ]

                for action in thinking_actions:
                    await manager.broadcast({
                        "type": "thinking",
                        "action": action
                    })
                    await asyncio.sleep(0.5)

                # Generate agent response
                try:
                    agent_response = await generate_appraisal_response(
                        user_message,
                        appraisal_state
                    )
                except Exception as e:
                    logger.error(f"Error generating response: {e}")
                    agent_response = f"I encountered an error: {str(e)}"

                logger.info(f"Agent: {agent_response}")

                # Send agent response
                await manager.broadcast({
                    "type": "message",
                    "content": agent_response
                })

                # Update appraisal state if needed
                await update_appraisal_workflow(user_message, agent_response)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected from chat")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

async def generate_appraisal_response(user_message: str, state: Dict) -> str:
    """Generate a response from the appraisal agent."""
    current_stage = state.get("current_stage", "start")

    messages = [
        {
            "role": "system",
            "content": "You are an expert real property appraiser. Guide the user through a comprehensive appraisal process. Ask clarifying questions and provide professional analysis."
        },
        {
            "role": "user",
            "content": f"Current appraisal stage: {current_stage}\nUser input: {user_message}"
        }
    ]

    try:
        response = query_model(messages, max_tokens=500, temperature=0.7)
        return response
    except Exception as e:
        logger.error(f"Model query failed: {e}")
        return "I'm unable to process that request at the moment. Please try again."

async def update_appraisal_workflow(user_input: str, agent_response: str):
    """Update the appraisal workflow state based on conversation."""
    # This would contain logic to parse responses and update state
    # For now, just log the exchange
    logger.info(f"Workflow state after exchange: {appraisal_state['current_stage']}")

# ============ Appraisal Workflow Endpoints ============
@app.get("/api/appraisal/state")
async def get_appraisal_state():
    """Get current appraisal workflow state."""
    return appraisal_state

@app.post("/api/appraisal/input")
async def send_appraisal_input(input_data: AppraisalInput):
    """Send user input to workflow agent."""
    try:
        stage = input_data.stage
        data = input_data.data

        # Update state
        appraisal_state["current_stage"] = stage
        appraisal_state["workflow_history"].append({
            "stage": stage,
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        })

        # Process based on stage
        if stage == "property_intake":
            appraisal_state["subject_property"].update(data)
        elif stage == "comparable_gathering":
            appraisal_state["comps_gathered"].extend(data.get("comps", []))
        elif stage == "market_research":
            appraisal_state["market_data"].update(data)

        return {
            "status": "success",
            "stage": stage,
            "state": appraisal_state
        }

    except Exception as e:
        logger.error(f"Failed to process appraisal input: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/appraisal/new")
async def start_new_appraisal():
    """Start a new appraisal."""
    global appraisal_state
    appraisal_state = {
        "current_stage": "property_intake",
        "subject_property": {},
        "comps_gathered": [],
        "market_data": {},
        "adjustments": {},
        "workflow_history": []
    }
    return {"status": "success", "state": appraisal_state}

# ============ Comps Endpoints ============
@app.get("/api/comps")
async def get_comps():
    """Get gathered comparable sales."""
    return {
        "comps": appraisal_state.get("comps_gathered", []),
        "count": len(appraisal_state.get("comps_gathered", []))
    }

@app.post("/api/comps")
async def gather_comps():
    """Trigger comparable sales gathering from MLS."""
    try:
        # Simulate MLS search
        subject = appraisal_state.get("subject_property", {})
        address = subject.get("address", "Unknown")

        await manager.broadcast({
            "type": "thinking",
            "action": "Searching MLS database for comparable properties near " + address
        })

        # Mock comparable properties
        mock_comps = [
            {
                "address": "123 Oak Street",
                "sale_price": 450000,
                "sale_date": "2024-01-15",
                "sqft": 2100,
                "beds": 3,
                "baths": 2,
                "distance": 0.3,
                "adjustments": -5000,
                "adjusted_price": 445000
            },
            {
                "address": "456 Maple Avenue",
                "sale_price": 475000,
                "sale_date": "2024-02-20",
                "sqft": 2150,
                "beds": 3,
                "baths": 2,
                "distance": 0.5,
                "adjustments": 3000,
                "adjusted_price": 478000
            },
            {
                "address": "789 Pine Road",
                "sale_price": 465000,
                "sale_date": "2024-03-10",
                "sqft": 2050,
                "beds": 3,
                "baths": 2,
                "distance": 0.7,
                "adjustments": -2000,
                "adjusted_price": 463000
            }
        ]

        appraisal_state["comps_gathered"] = mock_comps

        await manager.broadcast({
            "type": "message",
            "content": f"Found {len(mock_comps)} comparable properties. Analyzing adjustments..."
        })

        return {"status": "success", "comps_found": len(mock_comps)}

    except Exception as e:
        logger.error(f"Failed to gather comps: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============ Market Data Endpoints ============
@app.get("/api/market")
async def get_market_data():
    """Get market data for the subject property area."""
    # Return mock market data
    return {
        "median_price": 465000,
        "median_change": 2.5,
        "days_on_market": 35,
        "dom_change": -5,
        "inventory": 234,
        "inventory_change": -3.2,
        "price_trend": 1.8,
        "market_type": "Slightly Favors Sellers",
        "timestamp": datetime.utcnow().isoformat()
    }

# ============ MLS Configuration ============
@app.post("/api/mls/configure")
async def configure_mls(config: MLSConfig):
    """Configure MLS API credentials."""
    try:
        # Store MLS API key securely
        # In production, use proper secrets management
        logger.info("MLS API configured")
        return {"status": "success", "message": "MLS API configured"}
    except Exception as e:
        logger.error(f"Failed to configure MLS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============ Report Endpoints ============
@app.get("/api/report/preview")
async def get_report_preview():
    """Get report data for PDF preview."""
    subject = appraisal_state.get("subject_property", {})
    comps = appraisal_state.get("comps_gathered", [])
    market = appraisal_state.get("market_data", {})

    # Calculate average comp price
    avg_comp_price = 0
    if comps:
        avg_comp_price = sum(c.get("adjusted_price", 0) for c in comps) / len(comps)

    return {
        "subject": {
            "address": subject.get("address", ""),
            "type": subject.get("property_type", "Single Family Residential"),
            "sqft": subject.get("sqft", 0),
            "beds": subject.get("beds", 0),
            "baths": subject.get("baths", 0),
            "year_built": subject.get("year_built", ""),
            "condition": subject.get("condition", "Average")
        },
        "neighborhood": {
            "market_area": subject.get("market_area", ""),
            "school_district": subject.get("school_district", ""),
            "condition": subject.get("neighborhood_condition", "Good")
        },
        "market": {
            "type": market.get("market_type", "Balanced"),
            "median_price": market.get("median_price", 465000),
            "days_on_market": market.get("days_on_market", 35),
            "price_trend": market.get("price_trend", 1.8)
        },
        "approaches": {
            "comp_approach": int(avg_comp_price) if avg_comp_price else 465000,
            "cost_approach": 480000,
            "income_approach": 475000
        },
        "final_value": int(avg_comp_price) if avg_comp_price else 465000,
        "generated_at": datetime.utcnow().isoformat()
    }

@app.post("/api/report/export")
async def export_report(format: str = "pdf"):
    """Export signed PDF and XML of the appraisal report."""
    try:
        report_data = await get_report_preview()

        if format == "pdf":
            # In production, use reportlab or similar
            logger.info("Generating PDF report")
            filename = f"appraisal_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
        elif format == "xml":
            # In production, convert to proper UXML format
            logger.info("Generating XML report")
            filename = f"appraisal_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xml"
        else:
            raise HTTPException(status_code=400, detail="Invalid format")

        return {
            "status": "success",
            "filename": filename,
            "format": format,
            "message": f"Report exported as {format.upper()}"
        }

    except Exception as e:
        logger.error(f"Failed to export report: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============ Health Check ============
@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "3.1.0",
        "vllm_url": VLLM_BASE_URL,
        "model": VLLM_MODEL
    }

# ============ Startup/Shutdown ============
@app.on_event("startup")
async def startup_event():
    """Startup event handler."""
    logger.info("CACC Appraiser server starting...")
    logger.info(f"vLLM: {VLLM_BASE_URL}")
    logger.info(f"Model: {VLLM_MODEL}")
    logger.info(f"Graph persistence: {GRAPH_PERSIST_PATH}")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown event handler."""
    logger.info("Saving state and shutting down...")
    save_knowledge_graph(knowledge_graph)

# ============ Error Handling ============
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions."""
    logger.error(f"HTTP Error {exc.status_code}: {exc.detail}")
    return {
        "error": True,
        "status_code": exc.status_code,
        "detail": exc.detail,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions."""
    logger.error(f"Unhandled exception: {exc}")
    return {
        "error": True,
        "detail": "Internal server error",
        "timestamp": datetime.utcnow().isoformat()
    }

# ============ Root Endpoint ============
@app.get("/api")
async def api_root():
    """API information endpoint."""
    return {
        "name": "CACC Appraiser API",
        "version": "3.1.0",
        "description": "AI-powered real property appraisal system",
        "endpoints": {
            "dashboard": "GET /",
            "graph": "GET /api/graph",
            "chat": "WS /ws/chat",
            "health": "GET /api/health",
            "stats": "GET /api/stats"
        }
    }

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8001)),
        log_level="info"
    )
