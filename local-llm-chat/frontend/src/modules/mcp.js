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

let client;
let transport;

export async function getMcpSettings() {
    try {
        const settingsJson = await GoLoadSettings();
        const settings = JSON.parse(settingsJson);
        return settings.mcp_settings || {};
    } catch (error) {
        console.error("ERROR: Frontend: Error loading MCP settings:", error);
        return {};
    }
}

export async function saveMcpSettings(mcpSettings) {
    try {
        const settingsJson = await GoLoadSettings();
        const settings = JSON.parse(settingsJson);
        settings.mcp_settings = mcpSettings;
        await GoSaveSettings(JSON.stringify(settings));
        console.log("DEBUG: Frontend: MCP settings saved successfully.");
    } catch (error) {
        console.error("ERROR: Frontend: Error saving MCP settings:", error);
    }
}

export async function connectMcp(address, port) {
    if (client && client.isConnected()) {
        console.log("MCP client is already connected.");
        return;
    }

    const url = `http://${address}:${port}/mcp`;
    transport = new StreamableHTTPClientTransport(new URL(url));
    client = new Client({
        name: "local-llm-chat-client",
        version: "1.0.0"
    });

    try {
        await client.connect(transport);
        console.log("MCP client connected successfully.");
        await saveMcpSettings({
            address,
            port
        });
    } catch (error) {
        console.error("ERROR: MCP client connection failed:", error);
        throw error;
    }
}

export async function disconnectMcp() {
    if (client && client.isConnected()) {
        await client.close();
        console.log("MCP client disconnected.");
    }
}
