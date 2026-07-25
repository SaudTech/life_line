module.exports = {
    apps: [
      {
        name: "LifeLineHospital_app",
  
        // Run the Next.js CLI directly
        script: "./node_modules/next/dist/bin/next",
        args: "start -p 3000",
  
        // Use Node to execute it
        interpreter: "node",
  
        // Restart policy
        autorestart: true,
        max_restarts: 5,
        restart_delay: 5000,
        min_uptime: "10s",
  
        // Environment
        env: {
          NODE_ENV: "production",
          PORT: 3000
        }
      },
  
      {
        name: "ngrok-tunnel",
  
        script: "ngrok",
        interpreter: "none",
        args: "http --domain=release-canteen-overprice.ngrok-free.dev 3000",
  
        autorestart: true,
        max_restarts: 5,
        restart_delay: 5000,
        min_uptime: "10s"
      }
    ]
  };