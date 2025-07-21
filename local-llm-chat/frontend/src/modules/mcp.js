import {
    Client
} from '@modelcontextprotocol/sdk/client/index.js';
import {
    StreamableHTTPClientTransport
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    SaveSettings as GoSaveSettings,
    LoadSettings as GoLoadSettings
} from '../../wailsjs/go/main/App';

const clients = {};
const transports = {};
let connectionStates = {};

export async function getMcpServers() {
    try {
        const serversJson = await window.go.main.App.GetMcpServers();
        const mcpConfig = JSON.parse(serversJson);
        return mcpConfig.mcpServers || {};
    } catch (error) {
        console.error("ERROR: Frontend: Error loading MCP servers:", error);
        return {};
    }
}

export async function connectMcp(serverName, serverConfig) {
    if (connectionStates[serverName]) {
        console.log(`MCP client for ${serverName} is already connected.`);
        return;
    }

    await spawnMcpServer(serverName, serverConfig);

    const url = `http://${serverConfig.host || 'localhost'}:${serverConfig.port || 8080}/mcp`;
    transports[serverName] = new StreamableHTTPClientTransport(new URL(url));
    clients[serverName] = new Client({
        name: `local-llm-chat-client-${serverName}`,
        version: "1.0.0"
    });

    try {
        await clients[serverName].connect(transports[serverName]);
        connectionStates[serverName] = true;
        await saveMcpConnectionStates();
        console.log(`MCP client for ${serverName} connected successfully.`);
    } catch (error) {
        console.error(`ERROR: MCP client connection for ${serverName} failed:`, error);
        throw error;
    }
}

export async function disconnectMcp(serverName) {
    if (clients[serverName] && connectionStates[serverName]) {
        await clients[serverName].close();
        connectionStates[serverName] = false;
        await saveMcpConnectionStates();
        console.log(`MCP client for ${serverName} disconnected.`);
    }
}

export function getMcpConnectionState(serverName) {
    return connectionStates[serverName] || false;
}

export async function toggleMcpConnection(serverName, serverConfig) {
    if (getMcpConnectionState(serverName)) {
        await disconnectMcp(serverName);
    } else {
        await connectMcp(serverName, serverConfig);
    }
}

export async function connectAllMcp() {
    const servers = await getMcpServers();
    for (const serverName in servers) {
        if (!getMcpConnectionState(serverName)) {
            await connectMcp(serverName, servers[serverName]);
        }
    }
}

export async function disconnectAllMcp() {
    const servers = await getMcpServers();
    for (const serverName in servers) {
        if (getMcpConnectionState(serverName)) {
            await disconnectMcp(serverName);
        }
    }
}

async function spawnMcpServer(serverName, serverConfig) {
    try {
        const result = await window.go.main.App.SpawnMcpServer(serverName, serverConfig.command, serverConfig.args, serverConfig.env);
        console.log(result);
    } catch (error) {
        console.error(`Error spawning MCP server ${serverName}:`, error);
    }
}

async function saveMcpConnectionStates() {
    try {
        const settingsJson = await GoLoadSettings();
        const settings = JSON.parse(settingsJson);
        settings.mcp_connection_states = connectionStates;
        await GoSaveSettings(JSON.stringify(settings));
        console.log("DEBUG: Frontend: MCP connection states saved successfully.");
    } catch (error) {
        console.error("ERROR: Frontend: Error saving MCP connection states:", error);
    }
}

export async function loadMcpConnectionStates() {
    try {
        const settingsJson = await GoLoadSettings();
        const settings = JSON.parse(settingsJson);
        connectionStates = settings.mcp_connection_states || {};
        console.log("DEBUG: Frontend: MCP connection states loaded successfully.");
    } catch (error) {
        console.error("ERROR: Frontend: Error loading MCP connection states:", error);
    }
}
