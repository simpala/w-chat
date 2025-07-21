import {
    Client
} from '@modelcontextprotocol/sdk/client/index.js';
import {
    StreamableHTTPClientTransport
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    getMcpServers
} from './mcp.js';
import {
    StartMcpServerProxy
} from '../../wailsjs/go/main/App';

const MCP_CONNECTION_STATUS = {
    DISCONNECTED: 'Disconnected',
    CONNECTING: 'Connecting...',
    CONNECTED: 'Connected',
    ERROR: 'Error',
};

class MCPConnectionManager {
    constructor() {
        this.servers = {};
        this.connectionStates = {};
        this.clients = {};
        this.transports = {};
        this.eventListeners = {
            'state-change': [],
        };
    }

    async initialize() {
        const mcpServers = await getMcpServers();
        for (const serverName in mcpServers) {
            this.servers[serverName] = mcpServers[serverName];
            this.connectionStates[serverName] = {
                status: MCP_CONNECTION_STATUS.DISCONNECTED,
                error: null,
            };
        }
    }

    addEventListener(event, listener) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].push(listener);
        }
    }

    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(listener => listener(data));
        }
    }

    getConnectionState(serverName) {
        return this.connectionStates[serverName];
    }

    async connect(serverName) {
        if (this.clients[serverName] && this.connectionStates[serverName].status === MCP_CONNECTION_STATUS.CONNECTED) {
            console.log(`MCP client for ${serverName} is already connected.`);
            return;
        }

        this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.CONNECTING);

        try {
            const serverConfig = this.servers[serverName];

            const isRemoteByArg = serverConfig.args.includes('mcp-remote');
            const isRemoteByHost = !!serverConfig.host;

            let url;
            if (isRemoteByArg) {
                const urlIndex = serverConfig.args.indexOf('mcp-remote') + 1;
                url = serverConfig.args[urlIndex];
            } else if (isRemoteByHost) {
                const host = serverConfig.host;
                const port = serverConfig.port || 8080;
                url = `http://${host}:${port}/mcp`;
            } else {
                const port = await StartMcpServerProxy(serverName, serverConfig.command, serverConfig.args, serverConfig.env);
                url = `ws://localhost:${port}`;
            }

            this.transports[serverName] = new StreamableHTTPClientTransport(new URL(url));

            this.clients[serverName] = new Client({
                name: `local-llm-chat-client-${serverName}`,
                version: "1.0.0"
            });

            await this.clients[serverName].connect(this.transports[serverName]);
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.CONNECTED);
            this.monitorConnection(serverName);
        } catch (error) {
            console.error(`ERROR: MCP client connection for ${serverName} failed:`, error);
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.ERROR, error);
        }
    }

    async disconnect(serverName) {
        if (this.clients[serverName]) {
            await this.clients[serverName].close();
            delete this.clients[serverName];
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.DISCONNECTED);
        }
    }

    monitorConnection(serverName) {
        const client = this.clients[serverName];
        if (!client) return;

        // For now, we'll rely on the SDK's internal connection state.
        // A more robust implementation would involve periodic pings.
    }

    updateConnectionState(serverName, status, error = null) {
        this.connectionStates[serverName] = {
            status,
            error
        };
        this.emit('state-change', {
            serverName,
            state: this.connectionStates[serverName]
        });
    }
}

export const mcpManager = new MCPConnectionManager();
export {
    MCP_CONNECTION_STATUS
};
