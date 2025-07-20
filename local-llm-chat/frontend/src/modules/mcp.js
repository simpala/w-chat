import {
    Client
} from '@modelcontextprotocol/sdk/client/index.js';
import {
    StreamableHTTPClientTransport
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const clients = {};
const transports = {};
const connectionStates = {};

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

    const url = `http://${serverConfig.host || 'localhost'}:${serverConfig.port}/mcp`;
    transports[serverName] = new StreamableHTTPClientTransport(new URL(url));
    clients[serverName] = new Client({
        name: `local-llm-chat-client-${serverName}`,
        version: "1.0.0"
    });

    try {
        await clients[serverName].connect(transports[serverName]);
        connectionStates[serverName] = true;
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
        console.log(`MCP client for ${serverName} disconnected.`);
    }
}

export function getMcpConnectionState(serverName) {
    return connectionStates[serverName] || false;
}

export async function connectAllMcp() {
    const servers = await getMcpServers();
    for (const serverName in servers) {
        const serverConfig = servers[serverName];
        if (!connectionStates[serverName]) {
            await connectMcp(serverName, serverConfig);
        }
    }
}

export async function disconnectAllMcp() {
    for (const serverName in clients) {
        if (connectionStates[serverName]) {
            await disconnectMcp(serverName);
        }
    }
}
