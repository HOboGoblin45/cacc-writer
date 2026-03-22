module.exports = {
  apps: [{
    name: "appraisal-agent",
    script: "cacc-writer-server.js",
    cwd: "/opt/appraisal-agent",
    env: {
      NODE_ENV: "production",
      PORT: "5178",
      AI_PROVIDER: "ollama",
      OLLAMA_MODEL: "cacc-appraiser",
      OLLAMA_BASE_URL: "http://localhost:11434"
    }
  }]
};
