module.exports = {
  apps: [{
    name: "appraisal-agent",
    script: "cacc-writer-server.js",
    cwd: "/opt/appraisal-agent",
    env: {
      NODE_ENV: "production",
      PORT: "5178",
      AI_PROVIDER: "openai",
      OPENAI_MODEL: "ft:gpt-4.1-mini-2025-04-14:personal:cacc-appraiser:DMMRMzpq",
      OLLAMA_MODEL: "cacc-appraiser",
      OLLAMA_BASE_URL: "http://localhost:11434",
      APP_URL: "https://appraisal-agent.com",
      CACC_AUTH_ENABLED: "false"
    }
  }]
};
