module.exports = {
  apps: [{
    name: "appraisal-agent",
    script: "cacc-writer-server.js",
    cwd: "/opt/appraisal-agent",
    env: {
      NODE_ENV: "production",
      PORT: "5178",
      AI_PROVIDER: "openai",
      OPENAI_MODEL: "gpt-4.1",
      OLLAMA_MODEL: "cacc-appraiser",
      OLLAMA_BASE_URL: "http://localhost:11434",
      APP_URL: "https://appraisal-agent.com",
      CACC_AUTH_ENABLED: "false"
    }
  }]
};
