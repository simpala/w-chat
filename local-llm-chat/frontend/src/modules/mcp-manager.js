import {
    ConnectMcpClient,
    DisconnectMcpClient,
    GetMcpServers,
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
        this.eventListeners = {
            'state-change': [],
        };
    }

    async initialize() {
        const serversJson = await GetMcpServers();
        const mcpConfig = JSON.parse(serversJson);
        const mcpServers = mcpConfig.mcpServers || {};
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
        if (this.connectionStates[serverName].status === MCP_CONNECTION_STATUS.CONNECTED) {
            console.log(`MCP client for ${serverName} is already connected.`);
            return;
        }

        this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.CONNECTING);

        try {
            // const serverConfig = this.servers[serverName];
            // await ConnectMcpClient(serverName, serverConfig.command, serverConfig.args);
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.CONNECTED);
        } catch (error) {
            console.error(`ERROR: MCP client connection for ${serverName} failed:`, error);
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.ERROR, error);
        }
    }

    async disconnect(serverName) {
        if (this.connectionStates[serverName].status !== MCP_CONNECTION_STATUS.DISCONNECTED) {
            await DisconnectMcpClient(serverName);
            this.updateConnectionState(serverName, MCP_CONNECTION_STATUS.DISCONNECTED);
        }
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
